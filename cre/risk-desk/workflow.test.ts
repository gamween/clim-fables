import { describe, expect } from 'bun:test'
import { EvmMock, HttpActionsMock, newTestRuntime, REPORT_METADATA_HEADER_LENGTH, test } from '@chainlink/cre-sdk/test'
import { bytesToHex, encodeFunctionResult, type Hex, hexToBytes } from 'viem'
import { type Candle, estimate } from './estimator'
import binance from './fixtures/binance.json'
import coinbase from './fixtures/coinbase.json'
import hyperliquid from './fixtures/hyperliquid.json'
import kraken from './fixtures/kraken.json'
import { devPipsOf, poolMidFromSqrtPriceX96, STATE_VIEW_ABI } from './pool'
import { buildReport, decodeRiskReport, RISK_DESK_ABI, type RiskReport } from './report'
import { BINANCE_1S_REQUEST, parseBinance, parseVenue, tickerRequest, VENUE_QUOTE, VENUES, venueRequest } from './venues'
import { type Config, initWorkflow, onHttp, onTick } from './workflow'

const NOW = 1_791_282_309 // fixtures/now.txt
const RH_TESTNET = 2_032_988_798_112_970_440n // robinhood-testnet chain selector (@chainlink/cre-sdk 1.23.0)
const TX_HASH = `0x${'ab'.repeat(32)}` as Hex
const HL = 'https://api.hyperliquid.xyz/info'
const MAINNET_RPC = 'https://rpc.mainnet.chain.robinhood.com'
const FABLES_POOL = '0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551'
const STATE_SEL = '0xc19d93fb' // state()
const SLOT0_SEL = '0xc815641c' // getSlot0(bytes32)

const CONFIG: Config = {
	schedule: '*/30 * * * * *',
	deskAddress: '0x000000000000000000000000000000000000dEaD',
	chainSelectorName: 'robinhood-testnet',
	gasLimit: '1000000',
	venues: ['coinbase', 'kraken', 'binance', 'hyperliquid'],
	sigmaEstimator: 'median-close',
	kE4: 10_000,
	pool: {
		source: 'evm',
		rpcUrl: '',
		stateView: '0xF3334192D15450CdD385c8B70e03f9A6bD9E673b',
		poolId: `0x${'11'.repeat(32)}`,
		token0IsEth: true,
		decimals0: 18,
		decimals1: 6,
	},
	httpAuthorizedKeys: [],
}
const SHADOW: Config = { ...CONFIG, pool: { ...CONFIG.pool, source: 'http', rpcUrl: MAINNET_RPC, poolId: FABLES_POOL } }

// Trimmed real ticker responses (venues.test.ts) and the pool at 2,712.00 USD per ETH.
const TICKERS: Record<string, unknown> = {
	[tickerRequest('coinbase').url]: { price: '2713.33' },
	[tickerRequest('kraken').url]: {
		error: [],
		result: { XETHZUSD: { c: ['2713.25000', '0.004'] }, USDTZUSD: { c: ['0.99970000', '49.9'] } },
	},
	[tickerRequest('binance').url]: { symbol: 'ETHUSDT', price: '2713.86000000' },
	[`${HL} allMids`]: { ETH: '2712.75' },
}
const POOL_SQRT = BigInt(Math.floor(Math.sqrt(2712e-12) * 2 ** 96))
const FIXTURES: Record<string, unknown> = { coinbase, kraken, binance, hyperliquid }

// Binance 1 s klines ending one second before NOW (binance-1s estimator).
const ONES = Array.from({ length: 1000 }, (_, i) => {
	const t = NOW - 1000 + i
	const px = (2713 * Math.exp(0.0002 * Math.floor((t - (NOW - 1)) / 5))).toFixed(2)
	return [t * 1000, px, px, px, px, '1.0', t * 1000 + 999]
})

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64')
const jsonBody = (x: unknown): string => b64(new TextEncoder().encode(JSON.stringify(x)))
const bodyText = (b: unknown): string =>
	typeof b === 'string' ? Buffer.from(b, 'base64').toString() : new TextDecoder().decode((b as Uint8Array | undefined) ?? new Uint8Array())
const asHex = (b: unknown): string =>
	typeof b === 'string' ? `0x${Buffer.from(b, 'base64').toString('hex')}` : bytesToHex((b as Uint8Array | undefined) ?? new Uint8Array())

function mockHttp(opts: { failing?: string[]; rpc?: unknown } = {}): string[] {
	const seen: string[] = []
	const http = HttpActionsMock.testInstance()
	http.sendRequest = (req) => {
		const key = req.url === HL ? `${HL} ${JSON.parse(bodyText(req.body)).type}` : req.url
		seen.push(`${req.method} ${key}`)
		const routes = new Map<string, unknown>([
			[venueRequest('coinbase', NOW).url, coinbase],
			[venueRequest('kraken', NOW).url, kraken],
			[venueRequest('binance', NOW).url, binance],
			[`${HL} candleSnapshot`, hyperliquid],
			...Object.entries(TICKERS),
			[BINANCE_1S_REQUEST.url, ONES],
			[MAINNET_RPC, opts.rpc ?? {}],
		])
		const hit = routes.get(key)
		if (hit === undefined || (opts.failing ?? []).includes(key)) {
			return { statusCode: 503, headers: {}, body: jsonBody({ error: 'unavailable' }) }
		}
		return { statusCode: 200, headers: {}, body: jsonBody(hit) }
	}
	return seen
}

type State = [tObs: number, sigma15E9: number, sigma5E9: number, devPips: number, kE4: number, flags: number, seq: number]

interface EvmOpts {
	states: State[] // returned by successive state() reads; the last one repeats; [] means unreadable
	receiver?: 'SUCCESS' | 'REVERTED'
	txHash?: Hex | null // null: dry run (no hash)
	sqrtPriceX96?: bigint | null // pool D's slot0; null: the read fails
}

function mockEvm({ states, receiver = 'SUCCESS', txHash = TX_HASH, sqrtPriceX96 = POOL_SQRT }: EvmOpts): {
	written: RiskReport[]
	slot0Reads: () => number
} {
	const written: RiskReport[] = []
	let reads = 0
	let slot0 = 0
	const evm = EvmMock.testInstance(RH_TESTNET)
	evm.callContract = (req) => {
		const sel = asHex(req.call?.data).slice(0, 10)
		if (sel === SLOT0_SEL) {
			slot0++
			if (sqrtPriceX96 === null) throw new Error('pool read down')
			const data = encodeFunctionResult({ abi: STATE_VIEW_ABI, functionName: 'getSlot0', result: [sqrtPriceX96, -198_000, 0, 0] })
			return { data: b64(hexToBytes(data)) }
		}
		expect(sel).toBe(STATE_SEL)
		const s = states[Math.min(reads++, states.length - 1)]
		if (s === undefined) throw new Error('rpc down')
		return { data: b64(hexToBytes(encodeFunctionResult({ abi: RISK_DESK_ABI, functionName: 'state', result: s }))) }
	}
	evm.writeReport = (req) => {
		const raw = req.report?.rawReport ?? new Uint8Array()
		written.push(decodeRiskReport(bytesToHex(raw.slice(REPORT_METADATA_HEADER_LENGTH))))
		return {
			txStatus: 'TX_STATUS_SUCCESS',
			receiverContractExecutionStatus: `RECEIVER_CONTRACT_EXECUTION_STATUS_${receiver}`,
			...(txHash === null ? {} : { txHash: b64(hexToBytes(txHash)) }),
		}
	}
	return { written, slot0Reads: () => slot0 }
}

/** The report the workflow must write: the pure estimator on the same inputs, devPips against the pool. */
function expected(cfg: Config, poolMid: number | null, binance1s: Candle[] | null = null): RiskReport {
	const est = estimate({
		nowSec: NOW,
		usdtUsd: 0.9997,
		series: VENUES.map((v) => ({ venue: v, quote: VENUE_QUOTE[v], candles: parseVenue(v, FIXTURES[v]) })),
		tickers: [
			{ venue: 'coinbase', quote: 'USD', price: 2713.33 },
			{ venue: 'kraken', quote: 'USD', price: 2713.25 },
			{ venue: 'binance', quote: 'USDT', price: 2713.86 },
			{ venue: 'hyperliquid', quote: 'USD', price: 2712.75 },
		],
		binance1s,
		estimator: cfg.sigmaEstimator,
	})
	const dev = poolMid === null ? 0 : devPipsOf(est.venueMidE6 / 1e6, poolMid)
	return buildReport({ ...est, poolMidE6: 0 }, NOW, dev, cfg.kE4)
}
const POOL_MID = poolMidFromSqrtPriceX96(POOL_SQRT, CONFIG.pool)

const BEFORE: State = [NOW - 30, 50_000, 50_000, 0, 10_000, 0, 7]
const AFTER = (r: RiskReport): State => [NOW, r.sigma15E9, r.sigma5E9, r.devPips, 10_000, 0, 8]

function runtimeAt(nowSec: number, config: Config = CONFIG) {
	const runtime = newTestRuntime(null, { timeProvider: () => nowSec * 1000 })
	;(runtime as unknown as { config: Config }).config = config
	return runtime
}

describe('onTick (testnet desk, pool D read with the EVM capability)', () => {
	test('8 HTTP calls, consensus, devPips against pool D, the v2 report written and confirmed', () => {
		const want = expected(CONFIG, POOL_MID)
		const seen = mockHttp()
		const { written, slot0Reads } = mockEvm({ states: [BEFORE, AFTER(want)] })
		const runtime = runtimeAt(NOW)

		expect(onTick(runtime as never)).toBe(`OK ${TX_HASH}`)
		expect(seen).toHaveLength(8)
		expect(seen).toContain(`POST ${HL} candleSnapshot`)
		expect(seen).toContain(`POST ${HL} allMids`)
		expect(slot0Reads()).toBe(1)
		expect(written).toEqual([want])
		expect(want.devPips).not.toBe(0)
		const logs = runtime.getLogs().join('\n')
		expect(logs).toContain(`dev=${want.devPips}pips`)
		expect(logs).toContain('desk before: seq=7')
		expect(logs).toContain(`Write report transaction succeeded: ${TX_HASH}`) // parsed by bots/src/lib/simParse.ts
		expect(logs).toContain('REPORT applied seq=8')
	})

	test('venue-range estimator: same calls, the range sigma', () => {
		const cfg: Config = { ...CONFIG, sigmaEstimator: 'venue-range' }
		const want = expected(cfg, POOL_MID)
		const seen = mockHttp()
		const { written } = mockEvm({ states: [BEFORE, AFTER(want)] })
		expect(onTick(runtimeAt(NOW, cfg) as never)).toBe(`OK ${TX_HASH}`)
		expect(seen).toHaveLength(8)
		expect(written).toEqual([want])
	})

	test('binance-1s estimator: one more call, for the 1 s klines', () => {
		const cfg: Config = { ...CONFIG, sigmaEstimator: 'binance-1s' }
		const want = expected(cfg, POOL_MID, parseBinance(ONES))
		const seen = mockHttp()
		const { written } = mockEvm({ states: [BEFORE, AFTER(want)] })
		expect(onTick(runtimeAt(NOW, cfg) as never)).toBe(`OK ${TX_HASH}`)
		expect(seen).toHaveLength(9)
		expect(seen).toContain(`GET ${BINANCE_1S_REQUEST.url}`)
		expect(written).toEqual([want])
	})

	test('pool unreadable: devPips 0 (no directional premium), and the log says so', () => {
		const want = expected(CONFIG, null)
		mockHttp()
		const { written } = mockEvm({ states: [BEFORE, AFTER(want)], sqrtPriceX96: null })
		const runtime = runtimeAt(NOW)
		expect(onTick(runtime as never)).toBe(`OK ${TX_HASH}`)
		expect(written).toEqual([want])
		expect(written[0]?.devPips).toBe(0)
		expect(runtime.getLogs().join('\n')).toContain('pool mid unreadable')
	})

	test('dry run, rejected and not-applied outcomes', () => {
		mockHttp()
		mockEvm({ states: [BEFORE], txHash: null })
		expect(onTick(runtimeAt(NOW) as never)).toBe('DRY RUN')
		mockEvm({ states: [BEFORE], receiver: 'REVERTED' })
		expect(onTick(runtimeAt(NOW) as never)).toBe(`REJECTED ${TX_HASH}`)
		mockEvm({ states: [BEFORE, BEFORE] })
		expect(onTick(runtimeAt(NOW) as never)).toBe(`NOT_APPLIED ${TX_HASH}`)
	})

	test('skips when the last report is younger than MIN_GAP (20 s)', () => {
		mockHttp()
		const { written } = mockEvm({ states: [[NOW - 10, 50_000, 50_000, 0, 10_000, 0, 7]] })
		expect(onTick(runtimeAt(NOW) as never)).toBe('SKIP: min gap')
		expect(written).toHaveLength(0)
	})

	test('no report when fewer than 3 venues answer', () => {
		mockHttp({ failing: [venueRequest('coinbase', NOW).url, venueRequest('kraken', NOW).url] })
		const { written } = mockEvm({ states: [BEFORE] })
		const runtime = runtimeAt(NOW)
		expect(onTick(runtime as never)).toBe('SKIP: quorum 2/4 < 3')
		expect(written).toHaveLength(0)
		const logs = runtime.getLogs().join('\n')
		expect(logs).toContain('source dropped: coinbase: HTTP 503')
		expect(logs).toContain('clim: no report (quorum 2/4 < 3)') // parsed by bots/src/lib/simParse.ts
	})
})

describe("onTick (shadow: Fables' mainnet pool over JSON-RPC)", () => {
	test('the RPC read is one more HTTP call in node mode; no EVM slot0 read', () => {
		const rpc = {
			jsonrpc: '2.0',
			id: 1,
			result: encodeFunctionResult({ abi: STATE_VIEW_ABI, functionName: 'getSlot0', result: [3_967_422_558_559_756_050_525_311n, -198_050, 0, 0] }),
		}
		const fablesMid = poolMidFromSqrtPriceX96(3_967_422_558_559_756_050_525_311n, SHADOW.pool)
		const want = expected(SHADOW, Math.round(fablesMid * 1e6) / 1e6)
		const seen = mockHttp({ rpc })
		const { written, slot0Reads } = mockEvm({ states: [BEFORE], txHash: null })
		const runtime = runtimeAt(NOW, SHADOW)
		expect(onTick(runtime as never)).toBe('DRY RUN')
		expect(seen).toContain(`POST ${MAINNET_RPC}`)
		expect(seen).toHaveLength(9)
		expect(slot0Reads()).toBe(0)
		expect(written).toEqual([want])
		expect(runtime.getLogs().join('\n')).toContain('pool=2507.60')
	})
})

describe('initWorkflow', () => {
	test('[0] cron every 30 s, [1] HTTP trigger running the same tick', () => {
		const handlers = initWorkflow(CONFIG)
		expect(handlers).toHaveLength(2)
		expect((handlers[0].trigger as unknown as { config: { schedule: string } }).config.schedule).toBe('*/30 * * * * *')
		expect(handlers[1].fn).toBe(onHttp)
	})
})

// Pure risk-desk estimator: no SDK imports, no I/O, no clock. Every input is passed in.
// Units: times in unix seconds, prices in quote currency per ETH, sigma per sqrt(second).

export const DESK = {
	QUORUM: 3, // fewer fresh venues than this: no report
	MAX_AGE_SEC: 120, // a venue whose last closed 1m candle closed longer ago than this is dropped
	CLOSE_GRACE_SEC: 0, // a candle counts as closed once its minute has ended (the lab's convention: replay reports match it exactly)
	CANDLE_SEC: 60,
	WINDOW_MIN: 15, // RV15: 15 one-minute log returns (16 closes)
} as const

export const SECONDS_PER_YEAR = 31_536_000
export const MAX_TICK = 887_272
const LN_TICK_BASE = Math.log(1.0001)

export type Quote = 'USD' | 'USDT'

export interface Candle {
	t: number // candle open time, unix seconds
	close: number // close price in the venue's quote currency
	high?: number // high of the candle, same currency (venue-range estimator)
	low?: number // low of the candle, same currency
}

export interface VenueSeries {
	venue: string
	quote: Quote
	candles: Candle[]
}

export interface VenueTicker {
	venue: string
	quote: Quote
	price: number // last trade or mid in the venue's quote currency
}

export interface EstimatorInput {
	nowSec: number
	usdtUsd: number | null // null: USDT-quoted venues cannot be normalized and are dropped
	token0IsEth: boolean
	series: VenueSeries[]
}

export interface Estimate {
	sigmaE9: number // sigma used by the hook, per sqrt(second) * 1e9 (this version: sigma = RV15)
	rv15E9: number // raw RV15, per sqrt(second) * 1e9
	refTick: number // Uniswap tick of the median USD price at tEnd, for the pool's token order
	dispBp: number // farthest venue from the median at tEnd, in bp, rounded up
	nSources: number // fresh, USD-normalized venues
	priceE6: number // median USD price at tEnd * 1e6 (logs only)
	tEnd: number // open time of the last minute used
	sources: string[] // names of the fresh venues (logs only)
}

export class QuorumError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'QuorumError'
	}
}

export function median(xs: number[]): number {
	if (xs.length === 0) throw new Error('median of an empty list')
	const s = [...xs].sort((a, b) => a - b)
	const m = s.length >> 1
	return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function closedCandles(candles: Candle[], nowSec: number): Candle[] {
	return candles
		.filter((c) => c.t + DESK.CANDLE_SEC + DESK.CLOSE_GRACE_SEC <= nowSec)
		.sort((a, b) => a.t - b.t)
}

export function toUsd(series: VenueSeries, usdtUsd: number | null): VenueSeries | null {
	if (series.quote === 'USD') return series
	if (usdtUsd === null || !(usdtUsd > 0)) return null
	return {
		venue: series.venue,
		quote: 'USD',
		candles: series.candles.map((c) => ({ t: c.t, close: c.close * usdtUsd })),
	}
}

export function isFresh(closed: Candle[], nowSec: number): boolean {
	if (closed.length === 0) return false
	const last = closed[closed.length - 1]
	return nowSec - (last.t + DESK.CANDLE_SEC) <= DESK.MAX_AGE_SEC
}

// Latest minute that at least `quorum` venues have closed.
export function commonEnd(series: VenueSeries[], quorum: number): number | null {
	const counts = new Map<number, number>()
	for (const s of series) for (const c of s.candles) counts.set(c.t, (counts.get(c.t) ?? 0) + 1)
	const times = [...counts.keys()].filter((t) => (counts.get(t) ?? 0) >= quorum).sort((a, b) => b - a)
	return times.length > 0 ? times[0] : null
}

export function perMinuteMedians(series: VenueSeries[], tEnd: number, windowMin: number): number[] {
	const maps = series.map((s) => new Map(s.candles.map((c) => [c.t, c.close] as const)))
	const out: number[] = []
	for (let i = windowMin; i >= 0; i--) {
		const t = tEnd - i * DESK.CANDLE_SEC
		const xs: number[] = []
		for (const m of maps) {
			const x = m.get(t)
			if (x !== undefined) xs.push(x)
		}
		if (xs.length === 0) throw new QuorumError(`no venue has a close for minute ${t}`)
		out.push(median(xs))
	}
	return out
}

export function realizedVolPerSqrtSec(prices: number[]): number {
	if (prices.length < 2) throw new Error('need at least two prices')
	let ss = 0
	for (let i = 1; i < prices.length; i++) {
		const r = Math.log(prices[i] / prices[i - 1])
		ss += r * r
	}
	return Math.sqrt(ss / ((prices.length - 1) * DESK.CANDLE_SEC))
}

export function dispersionBp(closes: number[], mid: number): number {
	let worst = 0
	for (const p of closes) worst = Math.max(worst, Math.abs(p / mid - 1))
	return Math.max(0, Math.ceil(worst * 1e4 - 1e-9))
}

export function priceToTick(priceUsdPerEth: number, token0IsEth: boolean): number {
	const lnP = Math.log(priceUsdPerEth)
	const tick = Math.floor((token0IsEth ? lnP : -lnP) / LN_TICK_BASE)
	return Math.max(-MAX_TICK, Math.min(MAX_TICK, tick))
}

export function annualPctFromE9(sigmaE9: number): number {
	return (sigmaE9 / 1e9) * Math.sqrt(SECONDS_PER_YEAR) * 100
}

export function estimate(input: EstimatorInput): Estimate {
	const fresh: VenueSeries[] = []
	for (const raw of input.series) {
		const usd = toUsd(raw, input.usdtUsd)
		if (usd === null) continue
		const closed = closedCandles(usd.candles, input.nowSec)
		if (!isFresh(closed, input.nowSec)) continue
		fresh.push({ venue: usd.venue, quote: 'USD', candles: closed })
	}
	if (fresh.length < DESK.QUORUM) {
		throw new QuorumError(`quorum ${fresh.length}/${input.series.length} < ${DESK.QUORUM}`)
	}
	const tEnd = commonEnd(fresh, DESK.QUORUM)
	if (tEnd === null) throw new QuorumError(`no minute closed by ${DESK.QUORUM} venues`)

	const prices = perMinuteMedians(fresh, tEnd, DESK.WINDOW_MIN)
	const rv = realizedVolPerSqrtSec(prices)
	const endCloses: number[] = []
	for (const s of fresh) {
		const c = s.candles.find((x) => x.t === tEnd)
		if (c !== undefined) endCloses.push(c.close)
	}
	const mid = median(endCloses)
	const rvE9 = Math.round(rv * 1e9)
	return {
		sigmaE9: rvE9,
		rv15E9: rvE9,
		refTick: priceToTick(mid, input.token0IsEth),
		dispBp: dispersionBp(endCloses, mid),
		nSources: fresh.length,
		priceE6: Math.round(mid * 1e6),
		tEnd,
		sources: fresh.map((s) => s.venue),
	}
}

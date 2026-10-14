// clim × Fables risk desk: every 30 s, measure ETH volatility over 5 and 15 minutes on four venues and the venue mid
// against the target pool's mid, reach DON consensus field by field (median), and write the signed report to
// RiskDeskV2.onReport on Robinhood Chain testnet.
import {
	bytesToHex,
	ConsensusAggregationByFields,
	type CronPayload,
	CronCapability,
	EVMClient,
	encodeCallMsg,
	getNetwork,
	HTTPCapability,
	type HTTPPayload,
	handler,
	LATEST_BLOCK_NUMBER,
	median,
	type NodeRuntime,
	prepareReportRequest,
	type Runtime,
	TxStatus,
} from '@chainlink/cre-sdk'
import { EVM_PB } from '@chainlink/cre-sdk/pb'
import { type Address, decodeFunctionResult, encodeFunctionData, type Hex, zeroAddress } from 'viem'
import { z } from 'zod'
import { annualPctFromE9, estimate, SIGMA_ESTIMATORS } from './estimator'
import { decodeSlot0, devPipsOf, parseRpcSlot0, poolMidFromSqrtPriceX96, rpcSlot0Request, slot0CallData } from './pool'
import { buildReport, encodeRiskReport, MIN_GAP_SEC, type Observation, RISK_DESK_ABI } from './report'
import { fetchLive, type HttpReq, VENUES } from './venues'

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const BYTES32 = /^0x[0-9a-fA-F]{64}$/

export const configSchema = z.object({
	schedule: z.string(),
	deskAddress: z.string().regex(ADDRESS),
	chainSelectorName: z.string(),
	gasLimit: z.string(),
	venues: z.array(z.enum(VENUES)).min(3),
	sigmaEstimator: z.enum(SIGMA_ESTIMATORS),
	kE4: z.number().int().min(10_000).max(20_000),
	pool: z.object({
		source: z.enum(['evm', 'http']), // evm: StateView on the desk's chain; http: eth_call to rpcUrl (shadow)
		rpcUrl: z.string(),
		stateView: z.string().regex(ADDRESS),
		poolId: z.string().regex(BYTES32),
		token0IsEth: z.boolean(),
		decimals0: z.number().int().min(0).max(36),
		decimals1: z.number().int().min(0).max(36),
	}),
	httpAuthorizedKeys: z.array(z.string()),
})

export type Config = z.infer<typeof configSchema>

export interface DeskState {
	tObs: number
	sigma15E9: number
	sigma5E9: number
	devPips: number
	kE4: number
	flags: number
	seq: number
}

const pct = (sigmaE9: number): string => annualPctFromE9(sigmaE9).toFixed(1)
const msg = (e: unknown): string => (e instanceof Error ? e.message.split('\n')[0] : String(e))

// Runs on every node: fetch the sources (and, in shadow mode, the pool over JSON-RPC), estimate, return one
// observation for consensus.
export const observe = (nodeRuntime: NodeRuntime<Config>, nowSec: number): Observation => {
	const cfg = nodeRuntime.config
	const extra: HttpReq[] =
		cfg.pool.source === 'http' ? [rpcSlot0Request(cfg.pool.rpcUrl, cfg.pool.stateView as Hex, cfg.pool.poolId as Hex)] : []
	const { input, extra: fetched } = fetchLive(nodeRuntime, cfg.venues, nowSec, cfg.sigmaEstimator === 'binance-1s', extra)
	for (const note of input.notes) nodeRuntime.log(`source dropped: ${note}`)
	const est = estimate({ ...input, estimator: cfg.sigmaEstimator })
	let poolMidE6 = 0
	if (cfg.pool.source === 'http') {
		const f = fetched[0]
		try {
			if (f === undefined) throw new Error('no response')
			if ('error' in f) throw new Error(f.error)
			poolMidE6 = Math.round(poolMidFromSqrtPriceX96(parseRpcSlot0(f.json), cfg.pool) * 1e6)
		} catch (e) {
			nodeRuntime.log(`pool read dropped: ${msg(e)}`)
		}
	}
	nodeRuntime.log(
		`node: estimator=${cfg.sigmaEstimator} sources=${est.sources.join(',')} n=${est.nSources} tEnd=${est.tEnd} sigma5=${pct(est.sigma5E9)}% sigma15=${pct(est.sigma15E9)}% disp=${est.dispBp}bp mid=${(est.venueMidE6 / 1e6).toFixed(2)} (${est.midFrom})${poolMidE6 > 0 ? ` pool=${(poolMidE6 / 1e6).toFixed(2)}` : ''}`,
	)
	return {
		sigma15E9: est.sigma15E9,
		sigma5E9: est.sigma5E9,
		dispBp: est.dispBp,
		nSources: est.nSources,
		venueMidE6: est.venueMidE6,
		poolMidE6,
	}
}

export const observationAggregation = ConsensusAggregationByFields<Observation>({
	sigma15E9: median,
	sigma5E9: median,
	dispBp: median,
	nSources: median,
	venueMidE6: median,
	poolMidE6: median,
})

function evmClientFor(cfg: Config): EVMClient {
	const network = getNetwork({ chainFamily: 'evm', chainSelectorName: cfg.chainSelectorName, isTestnet: true })
	if (!network) throw new Error(`unknown chainSelectorName ${cfg.chainSelectorName}`)
	return new EVMClient(network.chainSelector.selector)
}

export function readDeskState(runtime: Runtime<Config>, evm: EVMClient): DeskState | null {
	try {
		const reply = evm
			.callContract(runtime, {
				call: encodeCallMsg({
					from: zeroAddress,
					to: runtime.config.deskAddress as Address,
					data: encodeFunctionData({ abi: RISK_DESK_ABI, functionName: 'state' }),
				}),
				blockNumber: LATEST_BLOCK_NUMBER,
			})
			.result()
		const [tObs, sigma15E9, sigma5E9, devPips, kE4, flags, seq] = decodeFunctionResult({
			abi: RISK_DESK_ABI,
			functionName: 'state',
			data: bytesToHex(reply.data),
		})
		return { tObs, sigma15E9, sigma5E9, devPips, kE4, flags, seq }
	} catch (e) {
		runtime.log(`desk state unreadable: ${msg(e)}`)
		return null
	}
}

/** Pool mid from StateView on the desk's own chain (pool D on Robinhood testnet); null if unreadable. */
export function readPoolMidEvm(runtime: Runtime<Config>, evm: EVMClient): number | null {
	const cfg = runtime.config
	try {
		const reply = evm
			.callContract(runtime, {
				call: encodeCallMsg({
					from: zeroAddress,
					to: cfg.pool.stateView as Address,
					data: slot0CallData(cfg.pool.poolId as Hex),
				}),
				blockNumber: LATEST_BLOCK_NUMBER,
			})
			.result()
		return poolMidFromSqrtPriceX96(decodeSlot0(bytesToHex(reply.data)), cfg.pool)
	} catch (e) {
		runtime.log(`pool read failed: ${msg(e)}`)
		return null
	}
}

export const onTick = (runtime: Runtime<Config>): string => {
	const cfg = runtime.config
	const tObs = Math.floor(runtime.now().getTime() / 1000)

	let obs: Observation
	try {
		obs = runtime.runInNodeMode(observe, observationAggregation)(tObs).result()
	} catch (e) {
		const m = e instanceof Error ? e.message : String(e)
		runtime.log(`clim: no report (${m})`)
		return `SKIP: ${m}`
	}
	if (obs.nSources < 3) {
		runtime.log(`clim: no report (consensus nSources=${obs.nSources} < 3)`)
		return 'SKIP: quorum'
	}

	const evm = evmClientFor(cfg)
	const poolMid = cfg.pool.source === 'evm' ? readPoolMidEvm(runtime, evm) : obs.poolMidE6 > 0 ? obs.poolMidE6 / 1e6 : null
	if (poolMid === null) runtime.log('pool mid unreadable: devPips = 0 (no directional premium)')
	const devPips = poolMid === null ? 0 : devPipsOf(obs.venueMidE6 / 1e6, poolMid)
	const report = buildReport(obs, tObs, devPips, cfg.kE4)
	runtime.log(
		`consensus: sigma5=${pct(report.sigma5E9)}%/yr sigma15=${pct(report.sigma15E9)}%/yr sigma5E9=${report.sigma5E9} sigma15E9=${report.sigma15E9} n=${report.nSources} disp=${report.dispBp}bp venue=${(obs.venueMidE6 / 1e6).toFixed(2)} pool=${poolMid === null ? 'n/a' : poolMid.toFixed(2)} dev=${report.devPips}pips tObs=${report.tObs}`,
	)

	const prev = readDeskState(runtime, evm)
	if (prev !== null) {
		runtime.log(`desk before: seq=${prev.seq} tObs=${prev.tObs} sigma5=${pct(prev.sigma5E9)}%/yr dev=${prev.devPips} flags=${prev.flags}`)
		if (prev.tObs > 0 && report.tObs < prev.tObs + MIN_GAP_SEC) {
			runtime.log(`clim: no report (${report.tObs - prev.tObs} s since the last report < ${MIN_GAP_SEC} s)`)
			return 'SKIP: min gap'
		}
	}

	const signed = runtime.report(prepareReportRequest(encodeRiskReport(report))).result()
	const reply = evm.writeReport(runtime, { receiver: cfg.deskAddress, report: signed, gasConfig: { gasLimit: cfg.gasLimit } }).result()
	const txHash = bytesToHex(reply.txHash ?? new Uint8Array(32))
	if (reply.txStatus !== TxStatus.SUCCESS) {
		throw new Error(`writeReport failed: status=${reply.txStatus} ${reply.errorMessage ?? ''} tx=${txHash}`)
	}
	// Exact line parsed by bots/src/lib/simParse.ts (the CRE docs and templates format).
	runtime.log(`Write report transaction succeeded: ${txHash}`)
	if (reply.receiverContractExecutionStatus === EVM_PB.ReceiverContractExecutionStatus.REVERTED) {
		runtime.log(`REJECTED by RiskDesk (onReport reverted) tx=${txHash}`)
		return `REJECTED ${txHash}`
	}
	if (/^0x0+$/.test(txHash)) {
		runtime.log(`DRY RUN: report encoded and simulated, not broadcast (sigma5E9=${report.sigma5E9} dev=${report.devPips})`)
		return 'DRY RUN'
	}
	// Forwarders never revert when the receiver reverts, and the simulator then still reports receiver SUCCESS:
	// re-read the desk to know if it applied.
	const after = readDeskState(runtime, evm)
	if (after === null) {
		runtime.log(`REPORT sent, desk state unreadable after tx=${txHash}`)
		return `SENT ${txHash}`
	}
	if (after.tObs === report.tObs) {
		runtime.log(
			`REPORT applied seq=${after.seq} sigma5Reported=${pct(report.sigma5E9)}% sigma5Applied=${pct(after.sigma5E9)}% dev=${after.devPips} flags=${after.flags} tx=${txHash}`,
		)
		return `OK ${txHash}`
	}
	runtime.log(
		`NOT APPLIED: RiskDesk state unchanged at the latest block after tx=${txHash} (rejected inside the forwarder, or the RPC read lagged: check ReportProcessed)`,
	)
	return `NOT_APPLIED ${txHash}`
}

export const onCron = (runtime: Runtime<Config>, _payload: CronPayload): string => onTick(runtime)
export const onHttp = (runtime: Runtime<Config>, _payload: HTTPPayload): string => onTick(runtime)

export function initWorkflow(config: Config) {
	const cron = new CronCapability()
	const http = new HTTPCapability()
	return [
		handler(cron.trigger({ schedule: config.schedule }), onCron),
		handler(
			http.trigger({
				authorizedKeys: config.httpAuthorizedKeys.map((publicKey) => ({ type: 'KEY_TYPE_ECDSA_EVM' as const, publicKey })),
			}),
			onHttp,
		),
	]
}

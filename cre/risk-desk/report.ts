// Canonical CRE report v2 (the contract between this workflow and RiskDeskV2._processReport) and the RiskDeskV2 read
// ABI. Must match contracts/src/v2/RiskDeskV2.sol and shared/abis/RiskDeskV2.json (abi-sync.test.ts).
import { decodeAbiParameters, encodeAbiParameters, type Hex, parseAbi, parseAbiParameters } from 'viem'

export const REPORT_ABI = parseAbiParameters(
	'uint40 tObs, uint32 sigma15E9, uint32 sigma5E9, int32 devPips, uint16 dispBp, uint8 nSources, uint16 kE4',
)

export const RISK_DESK_ABI = parseAbi([
	'function state() view returns (uint40 tObs, uint32 sigma15E9, uint32 sigma5E9, int32 devPips, uint16 kE4, uint8 flags, uint32 seq)',
])

export const K_E4_NEUTRAL = 10_000 // k = 1: no model-risk multiplier
export const MIN_GAP_SEC = 20 // RiskDeskV2 rejects tObs < last tObs + 20 s

export interface RiskReport {
	tObs: number
	sigma15E9: number
	sigma5E9: number
	devPips: number
	dispBp: number
	nSources: number
	kE4: number
}

/** One node's observation; the DON takes the median of each field. poolMidE6 is 0 unless read in node mode. */
export interface Observation {
	sigma15E9: number
	sigma5E9: number
	dispBp: number
	nSources: number
	venueMidE6: number
	poolMidE6: number
}

const UINT16_MAX = 65_535
const UINT32_MAX = 4_294_967_295
const INT32_MIN = -2_147_483_648
const INT32_MAX = 2_147_483_647

const clampInt = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.round(x)))

// Rounds and clamps the consensus observation into the report's integer ranges.
export function buildReport(obs: Observation, tObs: number, devPips: number, kE4 = K_E4_NEUTRAL): RiskReport {
	return {
		tObs: Math.floor(tObs),
		sigma15E9: clampInt(obs.sigma15E9, 0, UINT32_MAX),
		sigma5E9: clampInt(obs.sigma5E9, 0, UINT32_MAX),
		devPips: clampInt(devPips, INT32_MIN, INT32_MAX),
		dispBp: clampInt(obs.dispBp, 0, UINT16_MAX),
		nSources: clampInt(obs.nSources, 0, 255),
		kE4: clampInt(kE4, 0, UINT16_MAX),
	}
}

function assertInt(name: string, x: number, lo: number, hi: number): void {
	if (!Number.isInteger(x) || x < lo || x > hi) throw new RangeError(`${name}=${x} outside [${lo}, ${hi}]`)
}

export function encodeRiskReport(r: RiskReport): Hex {
	assertInt('tObs', r.tObs, 0, 2 ** 40 - 1)
	assertInt('sigma15E9', r.sigma15E9, 0, UINT32_MAX)
	assertInt('sigma5E9', r.sigma5E9, 0, UINT32_MAX)
	assertInt('devPips', r.devPips, INT32_MIN, INT32_MAX)
	assertInt('dispBp', r.dispBp, 0, UINT16_MAX)
	assertInt('nSources', r.nSources, 0, 255)
	assertInt('kE4', r.kE4, 0, UINT16_MAX)
	return encodeAbiParameters(REPORT_ABI, [r.tObs, r.sigma15E9, r.sigma5E9, r.devPips, r.dispBp, r.nSources, r.kE4])
}

export function decodeRiskReport(data: Hex): RiskReport {
	const [tObs, sigma15E9, sigma5E9, devPips, dispBp, nSources, kE4] = decodeAbiParameters(REPORT_ABI, data)
	return { tObs, sigma15E9, sigma5E9, devPips, dispBp, nSources, kE4 }
}

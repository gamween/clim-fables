import { describe, expect, test } from 'bun:test'
import { buildReport, decodeRiskReport, encodeRiskReport, K_E4_NEUTRAL, type RiskReport } from './report'

const REPORT: RiskReport = {
	tObs: 1_791_282_309,
	sigma15E9: 59_492,
	sigma5E9: 61_000,
	devPips: -1_234,
	dispBp: 2,
	nSources: 4,
	kE4: 10_000,
}

// Golden value from Foundry (independent encoder), i.e. what RiskDeskV2's abi.decode expects:
// cast abi-encode "f(uint40,uint32,uint32,int32,uint16,uint8,uint16)" 1791282309 59492 61000 -1234 2 4 10000
const GOLDEN =
	'0x' +
	'000000000000000000000000000000000000000000000000000000006ac4cc85' +
	'000000000000000000000000000000000000000000000000000000000000e864' +
	'000000000000000000000000000000000000000000000000000000000000ee48' +
	'fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffb2e' +
	'0000000000000000000000000000000000000000000000000000000000000002' +
	'0000000000000000000000000000000000000000000000000000000000000004' +
	'0000000000000000000000000000000000000000000000000000000000002710'

describe('encodeRiskReport (v2)', () => {
	test('matches the Foundry encoding word for word', () => {
		expect(encodeRiskReport(REPORT)).toBe(GOLDEN)
	})
	test('round trip, negative gap included', () => {
		expect(decodeRiskReport(encodeRiskReport(REPORT))).toEqual(REPORT)
	})
	test('rejects out-of-range or fractional fields', () => {
		expect(() => encodeRiskReport({ ...REPORT, sigma5E9: -1 })).toThrow(RangeError)
		expect(() => encodeRiskReport({ ...REPORT, dispBp: 1.5 })).toThrow('dispBp=1.5 outside [0, 65535]')
		expect(() => encodeRiskReport({ ...REPORT, devPips: 2 ** 31 })).toThrow(RangeError)
	})
})

describe('buildReport', () => {
	test('rounds consensus medians and clamps to the field ranges', () => {
		const r = buildReport(
			{ sigma15E9: 59_492.4, sigma5E9: 61_000.5, dispBp: 70_000, nSources: 3.5, venueMidE6: 2_713_150_000, poolMidE6: 0 },
			1_791_282_309.9,
			-1_234,
		)
		expect(r).toEqual({ tObs: 1_791_282_309, sigma15E9: 59_492, sigma5E9: 61_001, devPips: -1_234, dispBp: 65_535, nSources: 4, kE4: K_E4_NEUTRAL })
	})
	test('kE4 from the config', () => {
		const r = buildReport({ sigma15E9: 1, sigma5E9: 1, dispBp: 0, nSources: 4, venueMidE6: 1, poolMidE6: 0 }, 1, 0, 12_500)
		expect(r.kE4).toBe(12_500)
	})
})

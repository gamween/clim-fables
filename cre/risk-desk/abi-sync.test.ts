import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { type Abi, type AbiEvent, type AbiFunction, toEventSignature, toFunctionSignature } from 'viem'
import { RISK_DESK_ABI } from './report'

// shared/abis/RiskDeskV2.json is exported from contracts/out by contracts/script/export-abis.sh.
const PATH = process.env.RISK_DESK_ABI ?? '../../shared/abis/RiskDeskV2.json'
const exported = existsSync(PATH) ? (JSON.parse(readFileSync(PATH, 'utf8')) as Abi | { abi: Abi }) : null
const abi: Abi = exported === null ? [] : Array.isArray(exported) ? exported : exported.abi

const fn = (name: string) => abi.find((x): x is AbiFunction => x.type === 'function' && x.name === name)
const ev = (name: string) => abi.find((x): x is AbiEvent => x.type === 'event' && x.name === name)

describe.skipIf(exported === null)('RiskDeskV2 ABI matches the workflow', () => {
	test('state() has the outputs the workflow decodes', () => {
		expect(fn('state')?.outputs.map((o) => o.type)).toEqual(RISK_DESK_ABI[0].outputs.map((o) => o.type))
	})
	test('onReport(bytes,bytes) exists', () => {
		const f = fn('onReport')
		expect(f === undefined ? '' : toFunctionSignature(f)).toBe('onReport(bytes,bytes)')
	})
	test('RiskReportedV2 carries both windows, the gap and the flags', () => {
		const e = ev('RiskReportedV2')
		expect(e === undefined ? '' : toEventSignature(e)).toBe(
			'RiskReportedV2(uint32,uint40,uint32,uint32,uint32,uint32,int32,uint16,uint8,uint16,uint8)',
		)
	})
})

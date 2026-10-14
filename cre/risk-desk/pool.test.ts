import { describe, expect, test } from 'bun:test'
import { encodeFunctionResult, type Hex } from 'viem'
import { devPipsOf, parseRpcSlot0, poolMidFromSqrtPriceX96, rpcSlot0Request, STATE_VIEW_ABI } from './pool'

const FABLES_POOL = '0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551' as Hex
const STATE_VIEW = '0xF3334192D15450CdD385c8B70e03f9A6bD9E673b' as Hex
// Fables' ETH/USDG slot0 read on Robinhood Chain mainnet on 2026-10-13 (native ETH is token0, 18 and 6 decimals).
const FABLES_SQRT = 3_967_422_558_559_756_050_525_311n

describe('pool mid', () => {
	test("Fables' ETH/USDG: ETH token0, 18/6 decimals", () => {
		expect(poolMidFromSqrtPriceX96(FABLES_SQRT, { token0IsEth: true, decimals0: 18, decimals1: 6 })).toBeCloseTo(2507.597, 3)
	})
	test('USD token0 (6 decimals) at 2,500 (contracts/test/v2/LiveScript.t.sol value)', () => {
		const sqrt = 1_584_563_250_285_286_751_870_879_006_720_000n
		expect(poolMidFromSqrtPriceX96(sqrt, { token0IsEth: false, decimals0: 6, decimals1: 18 })).toBeCloseTo(2500, 6)
	})
	test('devPips = (venue - pool) / pool x 1e6, rounded, clamped like the desk', () => {
		expect(devPipsOf(2501, 2500)).toBe(400)
		expect(devPipsOf(2500, 2501)).toBe(-400)
		expect(devPipsOf(10_000, 2500)).toBe(1_000_000)
		expect(() => devPipsOf(0, 2500)).toThrow(RangeError)
	})
})

describe('slot0 over JSON-RPC (shadow mode)', () => {
	test('eth_call body', () => {
		const r = rpcSlot0Request('https://rpc.mainnet.chain.robinhood.com', STATE_VIEW, FABLES_POOL)
		expect(r.method).toBe('POST')
		const body = JSON.parse(r.body ?? '')
		expect(body.method).toBe('eth_call')
		expect(body.params[0].to).toBe(STATE_VIEW)
		expect(body.params[0].data).toBe(`0xc815641c${FABLES_POOL.slice(2)}`)
		expect(body.params[1]).toBe('latest')
	})
	test('decodes the result, rejects errors', () => {
		const result = encodeFunctionResult({ abi: STATE_VIEW_ABI, functionName: 'getSlot0', result: [FABLES_SQRT, -198_050, 0, 0] })
		expect(parseRpcSlot0({ jsonrpc: '2.0', id: 1, result })).toBe(FABLES_SQRT)
		expect(() => parseRpcSlot0({ jsonrpc: '2.0', id: 1, error: { message: 'rate limited' } })).toThrow('rpc: rate limited')
		expect(() => parseRpcSlot0({ jsonrpc: '2.0', id: 1 })).toThrow('rpc: no result')
	})
})

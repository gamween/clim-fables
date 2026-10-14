// The target pool's mid price for devPips, from Uniswap v4 StateView.getSlot0: read with the CRE EVM capability on the
// chain the desk writes to (pool D on Robinhood Chain testnet), or with a JSON-RPC eth_call over the HTTP capability
// (Fables' ETH/USDG pool on Robinhood Chain mainnet, shadow mode: a read, never a write).
import { decodeFunctionResult, encodeFunctionData, type Hex, parseAbi } from 'viem'
import type { HttpReq } from './venues'

export const STATE_VIEW_ABI = parseAbi([
	'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
])

export interface PoolTarget {
	token0IsEth: boolean
	decimals0: number
	decimals1: number
}

export const DEV_MAX_PIPS = 1_000_000 // RiskDeskV2.DEV_MAX_PIPS
const Q96 = 2 ** 96

/** ETH price in USD (human units) from a pool's sqrtPriceX96, for either token order and any decimals. */
export function poolMidFromSqrtPriceX96(sqrtPriceX96: bigint, t: PoolTarget): number {
	if (sqrtPriceX96 <= 0n) throw new RangeError('sqrtPriceX96 must be > 0')
	const r = Number(sqrtPriceX96) / Q96
	const p01 = r * r * 10 ** (t.decimals0 - t.decimals1) // human price of token0 in token1
	return t.token0IsEth ? p01 : 1 / p01
}

/** (venue - pool) / pool x 1e6, rounded and clamped to +-DEV_MAX_PIPS: positive means ETH is cheap in the pool. */
export function devPipsOf(venueMid: number, poolMid: number): number {
	if (!(venueMid > 0) || !(poolMid > 0)) throw new RangeError(`prices must be > 0, got ${venueMid} and ${poolMid}`)
	const d = Math.round(((venueMid - poolMid) / poolMid) * 1e6)
	return Math.max(-DEV_MAX_PIPS, Math.min(DEV_MAX_PIPS, d))
}

export function slot0CallData(poolId: Hex): Hex {
	return encodeFunctionData({ abi: STATE_VIEW_ABI, functionName: 'getSlot0', args: [poolId] })
}

export function decodeSlot0(data: Hex): bigint {
	const [sqrtPriceX96] = decodeFunctionResult({ abi: STATE_VIEW_ABI, functionName: 'getSlot0', data })
	return sqrtPriceX96
}

export function rpcSlot0Request(rpcUrl: string, stateView: Hex, poolId: Hex): HttpReq {
	return {
		url: rpcUrl,
		method: 'POST',
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'eth_call',
			params: [{ to: stateView, data: slot0CallData(poolId) }, 'latest'],
		}),
	}
}

export function parseRpcSlot0(json: unknown): bigint {
	if (typeof json !== 'object' || json === null) throw new Error('rpc: not an object')
	const o = json as { result?: unknown; error?: { message?: string } }
	if (o.error !== undefined) throw new Error(`rpc: ${o.error.message ?? 'error'}`)
	if (typeof o.result !== 'string' || !/^0x[0-9a-fA-F]+$/.test(o.result)) throw new Error('rpc: no result')
	return decodeSlot0(o.result as Hex)
}

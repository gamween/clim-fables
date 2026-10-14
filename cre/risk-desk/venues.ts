// Venue requests, response parsers and the node-mode fetch. Parsers are pure and tested on fixtures captured from
// the real endpoints (fixtures/) and on trimmed real responses (venues.test.ts).
import { HTTPClient, type NodeRuntime, ok, text } from '@chainlink/cre-sdk'
import type { Candle, Quote, VenueSeries, VenueTicker } from './estimator'

export const VENUES = ['coinbase', 'kraken', 'binance', 'hyperliquid'] as const
export type VenueName = (typeof VENUES)[number]

export const VENUE_QUOTE: Record<VenueName, Quote> = {
	coinbase: 'USD',
	kraken: 'USD',
	binance: 'USDT',
	hyperliquid: 'USD', // USDC-margined perp, treated as USD
}

const LOOKBACK_SEC = 1200 // 20 minutes: the 16 closes of the 15-minute window plus the staleness margin

export interface HttpReq {
	url: string
	method: 'GET' | 'POST'
	body?: string // raw JSON text; base64-encoded at send time
}

export function venueRequest(venue: VenueName, nowSec: number): HttpReq {
	switch (venue) {
		case 'coinbase':
			return {
				url: 'https://api.coinbase.com/api/v3/brokerage/market/products/ETH-USD/candles?granularity=ONE_MINUTE&limit=20',
				method: 'GET',
			}
		case 'kraken':
			return { url: `https://api.kraken.com/0/public/OHLC?pair=ETHUSD&interval=1&since=${nowSec - LOOKBACK_SEC}`, method: 'GET' }
		case 'binance':
			return { url: 'https://data-api.binance.vision/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=20', method: 'GET' }
		case 'hyperliquid':
			return {
				url: 'https://api.hyperliquid.xyz/info',
				method: 'POST',
				body: JSON.stringify({
					type: 'candleSnapshot',
					req: { coin: 'ETH', interval: '1m', startTime: (nowSec - LOOKBACK_SEC) * 1000, endTime: nowSec * 1000 },
				}),
			}
	}
}

/** Real-time price per venue, for the venue mid that devPips compares with the pool (the lab used 1 s prices). */
export function tickerRequest(venue: VenueName): HttpReq {
	switch (venue) {
		case 'coinbase':
			return { url: 'https://api.coinbase.com/api/v3/brokerage/market/products/ETH-USD', method: 'GET' }
		case 'kraken':
			return { url: 'https://api.kraken.com/0/public/Ticker?pair=ETHUSD,USDTUSD', method: 'GET' }
		case 'binance':
			return { url: 'https://data-api.binance.vision/api/v3/ticker/price?symbol=ETHUSDT', method: 'GET' }
		case 'hyperliquid':
			return { url: 'https://api.hyperliquid.xyz/info', method: 'POST', body: JSON.stringify({ type: 'allMids' }) }
	}
}

/** 1 s klines, only for the binance-1s estimator: 1,000 seconds cover the 900 s window and its first price. */
export const BINANCE_1S_REQUEST: HttpReq = {
	url: 'https://data-api.binance.vision/api/v3/klines?symbol=ETHUSDT&interval=1s&limit=1000',
	method: 'GET',
}

// ---------- parsing helpers ----------

function num(x: unknown, what: string): number {
	const n = typeof x === 'string' ? Number(x) : x
	if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`${what}: not a number: ${String(x)}`)
	return n
}

function positive(x: unknown, what: string): number {
	const n = num(x, what)
	if (!(n > 0)) throw new Error(`${what}: not positive: ${String(x)}`)
	return n
}

function obj(x: unknown, what: string): Record<string, unknown> {
	if (typeof x !== 'object' || x === null || Array.isArray(x)) throw new Error(`${what}: not an object`)
	return x as Record<string, unknown>
}

function arr(x: unknown, what: string): unknown[] {
	if (!Array.isArray(x)) throw new Error(`${what}: not an array`)
	return x
}

const ascending = (cs: Candle[]): Candle[] => cs.sort((a, b) => a.t - b.t)

// ---------- candle parsers (ascending by open time, seconds; close, high and low) ----------

// {"candles":[{"start":"1791282180","low":"..","high":"..","open":"..","close":"2713.98",...}, ...]} newest first
export function parseCoinbase(json: unknown): Candle[] {
	const rows = arr(obj(json, 'coinbase').candles, 'coinbase.candles')
	return ascending(
		rows.map((r) => {
			const o = obj(r, 'coinbase.candle')
			return {
				t: num(o.start, 'coinbase.start'),
				close: num(o.close, 'coinbase.close'),
				high: num(o.high, 'coinbase.high'),
				low: num(o.low, 'coinbase.low'),
			}
		}),
	)
}

// {"error":[],"result":{"XETHZUSD":[[time,open,high,low,close,vwap,volume,count],...],"last":N}}
export function parseKraken(json: unknown): Candle[] {
	const o = obj(json, 'kraken')
	const errors = arr(o.error ?? [], 'kraken.error')
	if (errors.length > 0) throw new Error(`kraken: ${errors.join(',')}`)
	const result = obj(o.result, 'kraken.result')
	const key = Object.keys(result).find((k) => k !== 'last')
	if (key === undefined) throw new Error('kraken: no pair in result')
	return ascending(
		arr(result[key], 'kraken.rows').map((r) => {
			const row = arr(r, 'kraken.row')
			return {
				t: num(row[0], 'kraken.time'),
				close: num(row[4], 'kraken.close'),
				high: num(row[2], 'kraken.high'),
				low: num(row[3], 'kraken.low'),
			}
		}),
	)
}

// [[openTimeMs,"open","high","low","close","volume",closeTimeMs,...], ...] (1m and 1s klines)
export function parseBinance(json: unknown): Candle[] {
	return ascending(
		arr(json, 'binance').map((r) => {
			const row = arr(r, 'binance.row')
			return {
				t: num(row[0], 'binance.openTime') / 1000,
				close: num(row[4], 'binance.close'),
				high: num(row[2], 'binance.high'),
				low: num(row[3], 'binance.low'),
			}
		}),
	)
}

// [{"t":openMs,"T":closeMs,"s":"ETH","i":"1m","o":"..","c":"..","h":"..","l":"..",...}, ...]
export function parseHyperliquid(json: unknown): Candle[] {
	return ascending(
		arr(json, 'hyperliquid').map((r) => {
			const o = obj(r, 'hyperliquid.candle')
			return {
				t: num(o.t, 'hyperliquid.t') / 1000,
				close: num(o.c, 'hyperliquid.c'),
				high: num(o.h, 'hyperliquid.h'),
				low: num(o.l, 'hyperliquid.l'),
			}
		}),
	)
}

export function parseVenue(venue: VenueName, json: unknown): Candle[] {
	switch (venue) {
		case 'coinbase':
			return parseCoinbase(json)
		case 'kraken':
			return parseKraken(json)
		case 'binance':
			return parseBinance(json)
		case 'hyperliquid':
			return parseHyperliquid(json)
	}
}

// ---------- ticker parsers ----------

// {"product_id":"ETH-USD","price":"2713.33",...}
export function parseCoinbaseTicker(json: unknown): number {
	return positive(obj(json, 'coinbase').price, 'coinbase.price')
}

// {"error":[],"result":{"XETHZUSD":{"c":["2713.25","0.004"],...},"USDTZUSD":{"c":["0.9997","49.9"],...}}}
export function parseKrakenTicker(json: unknown): { ethUsd: number; usdtUsd: number } {
	const o = obj(json, 'kraken')
	const errors = arr(o.error ?? [], 'kraken.error')
	if (errors.length > 0) throw new Error(`kraken: ${errors.join(',')}`)
	const result = obj(o.result, 'kraken.result')
	const last = (pair: string): number => positive(arr(obj(result[pair], `kraken.${pair}`).c, `kraken.${pair}.c`)[0], `kraken.${pair}`)
	return { ethUsd: last('XETHZUSD'), usdtUsd: last('USDTZUSD') }
}

// {"symbol":"ETHUSDT","price":"2713.86000000"}
export function parseBinanceTicker(json: unknown): number {
	return positive(obj(json, 'binance').price, 'binance.price')
}

// POST /info {"type":"allMids"} -> {"ETH":"2712.75",...} (perp mid, USDC treated as USD)
export function parseHyperliquidMids(json: unknown): number {
	return positive(obj(json, 'hyperliquid').ETH, 'hyperliquid.ETH')
}

// ---------- node-mode fetch ----------

export type Fetched = { json: unknown } | { error: string }

export interface DeskInput {
	nowSec: number
	usdtUsd: number | null // Kraken's USDT/USD; null: USDT-quoted prices cannot be converted and are dropped
	series: VenueSeries[] // 1-minute candles per venue (a failed venue keeps an empty list, so the quorum counts it)
	tickers: VenueTicker[] // real-time prices of the venues that answered
	binance1s: Candle[] | null // only for the binance-1s estimator
	notes: string[] // per-source fetch/parse problems, for logs
}

// Sends every request first, then waits for each response, so the calls run concurrently.
export function sendAll(nodeRuntime: NodeRuntime<unknown>, reqs: HttpReq[]): Fetched[] {
	const http = new HTTPClient()
	const pending = reqs.map((r) =>
		http.sendRequest(nodeRuntime, {
			url: r.url,
			method: r.method,
			headers: r.body === undefined ? {} : { 'Content-Type': 'application/json' },
			body: r.body === undefined ? '' : Buffer.from(r.body).toString('base64'),
			timeout: '8s', // below the 10 s connection quota; a hung venue must not stall the tick
		}),
	)
	return pending.map((p): Fetched => {
		try {
			const resp = p.result()
			if (!ok(resp)) return { error: `HTTP ${resp.statusCode}` }
			return { json: JSON.parse(text(resp)) }
		} catch (e) {
			return { error: e instanceof Error ? e.message : String(e) }
		}
	})
}

export function settle<T>(f: Fetched | undefined, parse: (json: unknown) => T): { value: T } | { error: string } {
	if (f === undefined) return { error: 'no response' }
	if ('error' in f) return { error: f.error }
	try {
		return { value: parse(f.json) }
	} catch (e) {
		return { error: e instanceof Error ? e.message : String(e) }
	}
}

function parseTicker(venue: Exclude<VenueName, 'kraken'>, json: unknown): number {
	switch (venue) {
		case 'coinbase':
			return parseCoinbaseTicker(json)
		case 'binance':
			return parseBinanceTicker(json)
		case 'hyperliquid':
			return parseHyperliquidMids(json)
	}
}

/**
 * One concurrent batch: each venue's 1-minute candles and ticker, Kraken's ticker for USDT/USD if Kraken is not a
 * venue, Binance 1 s klines when asked, then `extra` requests (the pool read in shadow mode), returned as is.
 * At most 4 + 4 + 1 + 1 = 10 HTTP calls, under the 15 per execution quota.
 */
export function fetchLive(
	nodeRuntime: NodeRuntime<unknown>,
	venues: VenueName[],
	nowSec: number,
	withBinance1s: boolean,
	extra: HttpReq[] = [],
): { input: DeskInput; extra: Fetched[] } {
	const needKrakenTicker = !venues.includes('kraken')
	const reqs: HttpReq[] = [
		...venues.map((v) => venueRequest(v, nowSec)),
		...venues.map((v) => tickerRequest(v)),
		...(needKrakenTicker ? [tickerRequest('kraken')] : []),
		...(withBinance1s ? [BINANCE_1S_REQUEST] : []),
		...extra,
	]
	const res = sendAll(nodeRuntime, reqs)
	let i = 0
	const notes: string[] = []
	const series: VenueSeries[] = venues.map((v) => {
		const r = settle(res[i++], (j) => parseVenue(v, j))
		if ('error' in r) notes.push(`${v}: ${r.error}`)
		return { venue: v, quote: VENUE_QUOTE[v], candles: 'error' in r ? [] : r.value }
	})
	const tickers: VenueTicker[] = []
	let usdtUsd: number | null = null
	const takeKraken = (f: Fetched | undefined, asVenue: boolean): void => {
		const r = settle(f, parseKrakenTicker)
		if ('error' in r) {
			notes.push(`kraken ticker: ${r.error}`)
			return
		}
		usdtUsd = r.value.usdtUsd
		if (asVenue) tickers.push({ venue: 'kraken', quote: 'USD', price: r.value.ethUsd })
	}
	for (const v of venues) {
		const f = res[i++]
		if (v === 'kraken') {
			takeKraken(f, true)
			continue
		}
		const r = settle(f, (j) => parseTicker(v, j))
		if ('error' in r) notes.push(`${v} ticker: ${r.error}`)
		else tickers.push({ venue: v, quote: VENUE_QUOTE[v], price: r.value })
	}
	if (needKrakenTicker) takeKraken(res[i++], false)
	let binance1s: Candle[] | null = null
	if (withBinance1s) {
		const r = settle(res[i++], parseBinance)
		if ('error' in r) notes.push(`binance 1s: ${r.error}`)
		else binance1s = r.value
	}
	return { input: { nowSec, usdtUsd, series, tickers, binance1s, notes }, extra: res.slice(i) }
}

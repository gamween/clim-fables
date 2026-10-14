import { describe, expect, test } from 'bun:test'
import binance from './fixtures/binance.json'
import coinbase from './fixtures/coinbase.json'
import hyperliquid from './fixtures/hyperliquid.json'
import kraken from './fixtures/kraken.json'
import {
	BINANCE_1S_REQUEST,
	parseBinance,
	parseBinanceTicker,
	parseCoinbase,
	parseCoinbaseTicker,
	parseHyperliquid,
	parseHyperliquidMids,
	parseKraken,
	parseKrakenTicker,
	parseVenue,
	tickerRequest,
	VENUE_QUOTE,
	VENUES,
	venueRequest,
} from './venues'

// Real candle responses captured by scripts/capture-fixtures.sh at this instant (fixtures/now.txt).
const NOW = 1_791_282_309
// Trimmed real ticker responses (same shapes as bots/test/market.test.ts).
const COINBASE_TICKER = { product_id: 'ETH-USD', price: '2713.33' }
const KRAKEN_TICKER = {
	error: [],
	result: {
		XETHZUSD: { a: ['2713.25000', '2', '2.000'], b: ['2713.24000', '4', '4.000'], c: ['2713.25000', '0.00412332'] },
		USDTZUSD: { a: ['0.99971000', '83080', '83080.000'], b: ['0.99970000', '745859', '745859.000'], c: ['0.99970000', '49.901'] },
	},
}
const BINANCE_TICKER = { symbol: 'ETHUSDT', price: '2713.86000000' }
const HL_MIDS = { BTC: '86027.5', ETH: '2712.75', SOL: '120.015' }

describe('requests', () => {
	test('1-minute candle URLs and the Hyperliquid POST body', () => {
		expect(venueRequest('coinbase', NOW).url).toBe(
			'https://api.coinbase.com/api/v3/brokerage/market/products/ETH-USD/candles?granularity=ONE_MINUTE&limit=20',
		)
		expect(venueRequest('kraken', NOW).url).toBe(`https://api.kraken.com/0/public/OHLC?pair=ETHUSD&interval=1&since=${NOW - 1200}`)
		expect(venueRequest('binance', NOW).url).toBe('https://data-api.binance.vision/api/v3/klines?symbol=ETHUSDT&interval=1m&limit=20')
		const hl = venueRequest('hyperliquid', NOW)
		expect(hl.method).toBe('POST')
		expect(JSON.parse(hl.body ?? '')).toEqual({
			type: 'candleSnapshot',
			req: { coin: 'ETH', interval: '1m', startTime: (NOW - 1200) * 1000, endTime: NOW * 1000 },
		})
	})
	test('tickers (Kraken also carries USDT/USD) and Binance 1 s klines', () => {
		expect(tickerRequest('coinbase').url).toBe('https://api.coinbase.com/api/v3/brokerage/market/products/ETH-USD')
		expect(tickerRequest('kraken').url).toBe('https://api.kraken.com/0/public/Ticker?pair=ETHUSD,USDTUSD')
		expect(tickerRequest('binance').url).toBe('https://data-api.binance.vision/api/v3/ticker/price?symbol=ETHUSDT')
		expect(JSON.parse(tickerRequest('hyperliquid').body ?? '')).toEqual({ type: 'allMids' })
		expect(BINANCE_1S_REQUEST.url).toBe('https://data-api.binance.vision/api/v3/klines?symbol=ETHUSDT&interval=1s&limit=1000')
	})
})

describe('candle parsers on captured fixtures (close, high, low)', () => {
	test('coinbase: newest-first strings, sorted ascending', () => {
		const c = parseCoinbase(coinbase)
		expect(c).toHaveLength(19)
		expect(c[0]).toEqual({ t: 1_791_281_160, close: 2708.41, high: 2709.79, low: 2708.41 })
		expect(c[c.length - 1]).toEqual({ t: 1_791_282_240, close: 2713.76, high: 2715.08, low: 2713.75 })
	})
	test('kraken: rows under XETHZUSD, last row still open', () => {
		const c = parseKraken(kraken)
		expect(c).toHaveLength(20)
		expect(c[c.length - 1]).toEqual({ t: 1_791_282_300, close: 2714.65, high: 2714.83, low: 2713.87 })
	})
	test('binance: open time in ms, prices in USDT', () => {
		const c = parseBinance(binance)
		expect(c).toHaveLength(20)
		expect(c[c.length - 1]).toEqual({ t: 1_791_282_300, close: 2715.18, high: 2715.33, low: 2714.58 })
	})
	test('hyperliquid: t in ms, prices as strings', () => {
		const c = parseHyperliquid(hyperliquid)
		expect(c).toHaveLength(21)
		expect(c[0]).toEqual({ t: 1_791_281_100, close: 2708.3, high: 2708.3, low: 2708 })
	})
	test('parseVenue dispatches, and every venue has a quote currency', () => {
		for (const v of VENUES) expect(VENUE_QUOTE[v]).toMatch(/^USDT?$/)
		expect(parseVenue('binance', binance)).toEqual(parseBinance(binance))
	})
	test('malformed responses throw', () => {
		expect(() => parseKraken({ error: ['EQuery:Unknown asset pair'], result: {} })).toThrow('kraken: EQuery:Unknown asset pair')
		expect(() => parseCoinbase({ message: 'rate limited' })).toThrow('coinbase.candles: not an array')
	})
})

describe('ticker parsers', () => {
	test('each venue', () => {
		expect(parseCoinbaseTicker(COINBASE_TICKER)).toBe(2713.33)
		expect(parseKrakenTicker(KRAKEN_TICKER)).toEqual({ ethUsd: 2713.25, usdtUsd: 0.9997 })
		expect(parseBinanceTicker(BINANCE_TICKER)).toBe(2713.86)
		expect(parseHyperliquidMids(HL_MIDS)).toBe(2712.75)
	})
	test('reject malformed or error payloads', () => {
		expect(() => parseCoinbaseTicker({ price: 'abc' })).toThrow('coinbase.price')
		expect(() => parseKrakenTicker({ error: ['EGeneral:Too many requests'], result: {} })).toThrow('kraken: EGeneral:Too many requests')
		expect(() => parseHyperliquidMids({ BTC: '1' })).toThrow('hyperliquid.ETH')
	})
})

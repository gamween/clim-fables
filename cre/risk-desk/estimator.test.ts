import { describe, expect, test } from 'bun:test'
import {
	annualPctFromE9,
	type Candle,
	closedCandles,
	commonEnd,
	DESK,
	dispersionBp,
	estimate,
	type EstimatorInput,
	isFresh,
	median,
	parkinsonPerSqrtSec,
	perMinuteMedians,
	QuorumError,
	realizedVolPerSqrtSec,
	sigmaBinance1s,
	sigmaVenueRange,
	toUsd,
	type VenueSeries,
	type VenueTicker,
} from './estimator'

// Synthetic market: 20 one-minute candles, every log return exactly +0.001, high/low at +-0.001 in log.
const T0 = 1_799_998_800 // multiple of 60
const NOW = T0 + 20 * 60 + 10 // 10 s after the 20th candle closed
const p = (i: number): number => 2000 * Math.exp(0.001 * i)
const candles = (f: (i: number) => number, n = 20, h = 0.001): Candle[] =>
	Array.from({ length: n }, (_, i) => ({ t: T0 + 60 * i, close: f(i), high: f(i) * Math.exp(h), low: f(i) * Math.exp(-h) }))

const venueA: VenueSeries = { venue: 'a', quote: 'USD', candles: candles(p) }
const venueB: VenueSeries = { venue: 'b', quote: 'USD', candles: candles((i) => p(i) * 1.0002) }
const venueC: VenueSeries = { venue: 'c', quote: 'USDT', candles: candles((i) => 2 * p(i) * 0.9999) } // usdtUsd 0.5
const venueStale: VenueSeries = { venue: 'd', quote: 'USD', candles: candles(p, 17) } // last close 190 s ago
const TICKERS: VenueTicker[] = [
	{ venue: 'a', quote: 'USD', price: 2050 },
	{ venue: 'b', quote: 'USD', price: 2051 },
	{ venue: 'c', quote: 'USDT', price: 4100 }, // 2050 USD at usdtUsd 0.5
]

// Binance 1 s klines ending one second before NOW; the price steps by exp(0.001) every 5 s back from the last second.
const ones = (n = 1000, end = NOW - 1): Candle[] =>
	Array.from({ length: n }, (_, i) => {
		const t = end - (n - 1) + i
		return { t, close: 2000 * Math.exp(0.001 * Math.floor((t - end) / 5)) }
	})

const input = (over: Partial<EstimatorInput> = {}): EstimatorInput => ({
	nowSec: NOW,
	usdtUsd: 0.5,
	series: [venueA, venueB, venueC, venueStale],
	tickers: TICKERS,
	binance1s: null,
	estimator: 'median-close',
	...over,
})

describe('median', () => {
	test('odd, even, empty', () => {
		expect(median([3, 1, 2])).toBe(2)
		expect(median([4, 1, 3, 2])).toBe(2.5)
		expect(() => median([])).toThrow('median of an empty list')
	})
})

describe('closedCandles, toUsd, isFresh, commonEnd', () => {
	test('keeps candles whose minute has ended (t + 60 <= now), sorted ascending', () => {
		const cs = [
			{ t: 940, close: 2 },
			{ t: 880, close: 1 },
			{ t: 941, close: 3 },
		]
		expect(closedCandles(cs, 1000)).toEqual([
			{ t: 880, close: 1 },
			{ t: 940, close: 2 },
		])
	})
	test('USD passes through, USDT is multiplied (high and low too), USDT without rate is dropped', () => {
		expect(toUsd(venueA, null)).toBe(venueA)
		expect(toUsd({ venue: 'x', quote: 'USDT', candles: [{ t: 0, close: 10 }] }, 0.5)?.candles).toEqual([{ t: 0, close: 5 }])
		expect(toUsd({ venue: 'x', quote: 'USDT', candles: [{ t: 0, close: 10, high: 12, low: 8 }] }, 0.5)?.candles).toEqual([
			{ t: 0, close: 5, high: 6, low: 4 },
		])
		expect(toUsd(venueC, null)).toBeNull()
	})
	test(`isFresh: last close at most ${DESK.MAX_AGE_SEC} s old`, () => {
		expect(isFresh([{ t: 820, close: 1 }], 1000)).toBe(true)
		expect(isFresh([{ t: 819, close: 1 }], 1000)).toBe(false)
		expect(isFresh([], 1000)).toBe(false)
	})
	test('commonEnd: latest minute closed by at least `quorum` venues', () => {
		const late: VenueSeries = { venue: 'b', quote: 'USD', candles: candles(p, 19) }
		expect(commonEnd([venueA, late, venueC], 3)).toBe(T0 + 60 * 18)
		expect(commonEnd([venueA, late, venueC], 2)).toBe(T0 + 60 * 19)
		expect(commonEnd([venueA], 3)).toBeNull()
	})
})

describe('median-close', () => {
	test('one median per minute over the window, oldest first', () => {
		const out = perMinuteMedians([venueA, venueB], T0 + 60 * 19, 2)
		expect(out).toHaveLength(3)
		expect(out[2]).toBeCloseTo(p(19) * 1.0001, 9)
		expect(() => perMinuteMedians([venueA], T0 + 60 * 25, 15)).toThrow(QuorumError)
	})
	test('5 and 15 returns of exactly 0.001', () => {
		expect(realizedVolPerSqrtSec(Array.from({ length: 6 }, (_, i) => p(i)))).toBeCloseTo(Math.sqrt(5e-6 / 300), 15)
		expect(realizedVolPerSqrtSec(Array.from({ length: 16 }, (_, i) => p(i)))).toBeCloseTo(1.2909944487358055e-4, 15)
		expect(annualPctFromE9(85_475)).toBeCloseTo(48.0, 2)
	})
})

describe('venue-range (Parkinson on 1-minute high and low)', () => {
	test('ln(H/L) = 0.002 on every candle', () => {
		expect(parkinsonPerSqrtSec(candles(p, 5))).toBeCloseTo(Math.sqrt(0.002 ** 2 / (4 * Math.log(2)) / 60), 15)
		expect(() => parkinsonPerSqrtSec([{ t: 0, close: 1 }])).toThrow('no valid high/low')
	})
	test('median across venues; a venue missing a candle of the window is left out', () => {
		const wide = (h: number, venue: string): VenueSeries => ({ venue, quote: 'USD', candles: candles(p, 20, h) })
		const tEnd = T0 + 60 * 19
		expect(sigmaVenueRange([wide(0.001, 'a'), wide(0.002, 'b'), wide(0.003, 'c')], tEnd, 300)).toBeCloseTo(
			Math.sqrt(0.004 ** 2 / (4 * Math.log(2)) / 60),
			15,
		)
		const holed: VenueSeries = { venue: 'h', quote: 'USD', candles: candles(p).filter((c) => c.t !== T0 + 60 * 17) }
		expect(() => sigmaVenueRange([wide(0.001, 'a'), wide(0.002, 'b'), holed], tEnd, 300)).toThrow(QuorumError)
	})
})

describe('binance-1s (5 s returns, as the lab)', () => {
	test('returns of exactly 0.001 every 5 s', () => {
		expect(sigmaBinance1s(ones(), NOW, 300)).toBeCloseTo(Math.sqrt(0.001 ** 2 / 5), 15)
		expect(sigmaBinance1s(ones(), NOW, 900)).toBeCloseTo(Math.sqrt(0.001 ** 2 / 5), 15)
	})
	test('a missing second keeps the previous close', () => {
		// the sample at last - 10 s takes the close of last - 11 s (one step lower): one return of 0, one of 0.002
		const gap = ones().filter((c) => c.t !== NOW - 1 - 10)
		expect(sigmaBinance1s(gap, NOW, 300)).toBeCloseTo(Math.sqrt((58 * 0.001 ** 2 + 0.002 ** 2) / 300), 15)
	})
	test('stale or short data is an error, not a guess', () => {
		expect(() => sigmaBinance1s(ones(1000, NOW - 30), NOW, 300)).toThrow('binance-1s: last second closed')
		expect(() => sigmaBinance1s(ones(200), NOW, 300)).toThrow('binance-1s: not enough history')
	})
})

describe('estimate', () => {
	test('median-close: 3 fresh venues out of 4, both windows, dispersion, mid from tickers', () => {
		const est = estimate(input())
		expect(est.sources).toEqual(['a', 'b', 'c'])
		expect(est.nSources).toBe(3)
		expect(est.tEnd).toBe(T0 + 60 * 19)
		expect(est.sigma5E9).toBe(129_099)
		expect(est.sigma15E9).toBe(129_099)
		expect(est.dispBp).toBe(2)
		expect(est.venueMidE6).toBe(2_050_000_000)
		expect(est.midFrom).toBe('tickers')
	})
	test('venue-range and binance-1s', () => {
		const r = estimate(input({ estimator: 'venue-range' }))
		expect(r.sigma5E9).toBe(155_064)
		expect(r.sigma15E9).toBe(155_064)
		const b = estimate(input({ estimator: 'binance-1s', binance1s: ones() }))
		expect(b.sigma5E9).toBe(447_214)
		expect(b.sigma15E9).toBe(447_214)
		expect(() => estimate(input({ estimator: 'binance-1s' }))).toThrow('binance-1s: no data')
	})
	test('fewer than 3 tickers: the mid is the median 1-minute close', () => {
		const est = estimate(input({ tickers: TICKERS.slice(0, 2) }))
		expect(est.venueMidE6).toBe(2_038_363_297)
		expect(est.midFrom).toBe('closes')
	})
	test('USDT venue without a USDT/USD rate is dropped and quorum fails', () => {
		expect(() => estimate(input({ usdtUsd: null }))).toThrow('quorum 2/4 < 3')
	})
})

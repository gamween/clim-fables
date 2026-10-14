// Pure risk-desk estimator: no SDK imports, no I/O, no clock. Every input is passed in.
// Units: times in unix seconds, prices in quote currency per ETH, sigma per sqrt(second).

/** The volatility estimators the desk can compute; shared/params-fables.json's sigmaEstimator picks one (plan 03). */
export const SIGMA_ESTIMATORS = ['median-close', 'venue-range', 'binance-1s'] as const
export type SigmaEstimator = (typeof SIGMA_ESTIMATORS)[number]

export const DESK = {
	QUORUM: 3, // fewer fresh venues than this: no report
	MAX_AGE_SEC: 120, // a venue whose last closed 1m candle closed longer ago than this is dropped
	CLOSE_GRACE_SEC: 0, // a candle counts as closed once its minute has ended (the lab's convention)
	CANDLE_SEC: 60,
	LONG_SEC: 900, // sigma15
	SHORT_SEC: 300, // sigma5
	STEP_1S_SEC: 5, // binance-1s: 5 s returns, as the lab (damps the bid-ask bounce of 1 s closes)
	MAX_AGE_1S_SEC: 10, // binance-1s: the last closed second must be at most this old
} as const

export const SECONDS_PER_YEAR = 31_536_000
const PARKINSON = 1 / (4 * Math.log(2))

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
	series: VenueSeries[]
	tickers: VenueTicker[]
	binance1s: Candle[] | null
	estimator: SigmaEstimator
}

export interface Estimate {
	sigma15E9: number // 15-minute volatility, per sqrt(second) * 1e9
	sigma5E9: number // 5-minute volatility, per sqrt(second) * 1e9
	dispBp: number // farthest venue from the median close at tEnd, in bp, rounded up
	nSources: number // fresh, USD-normalized venues
	venueMidE6: number // venue mid in USD * 1e6: median of the tickers, or of the closes at tEnd
	midFrom: 'tickers' | 'closes'
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
	return candles.filter((c) => c.t + DESK.CANDLE_SEC + DESK.CLOSE_GRACE_SEC <= nowSec).sort((a, b) => a.t - b.t)
}

export function toUsd(series: VenueSeries, usdtUsd: number | null): VenueSeries | null {
	if (series.quote === 'USD') return series
	if (usdtUsd === null || !(usdtUsd > 0)) return null
	return {
		venue: series.venue,
		quote: 'USD',
		candles: series.candles.map((c) => ({
			t: c.t,
			close: c.close * usdtUsd,
			...(c.high === undefined ? {} : { high: c.high * usdtUsd }),
			...(c.low === undefined ? {} : { low: c.low * usdtUsd }),
		})),
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

/** median-close: realized volatility of the cross-venue median close over windowSec (windowSec / 60 returns). */
export function sigmaMedianClose(fresh: VenueSeries[], tEnd: number, windowSec: number): number {
	return realizedVolPerSqrtSec(perMinuteMedians(fresh, tEnd, windowSec / DESK.CANDLE_SEC))
}

/** Parkinson volatility per sqrt(second) of 1-minute candles: sqrt(mean(ln(high / low)^2) / (4 ln 2) / 60 s). */
export function parkinsonPerSqrtSec(candles: Candle[]): number {
	if (candles.length === 0) throw new Error('need at least one candle')
	let s = 0
	for (const c of candles) {
		if (c.high === undefined || c.low === undefined || !(c.low > 0) || c.high < c.low) {
			throw new Error(`candle ${c.t}: no valid high/low`)
		}
		const r = Math.log(c.high / c.low)
		s += r * r
	}
	return Math.sqrt(((s / candles.length) * PARKINSON) / DESK.CANDLE_SEC)
}

/** venue-range: median across venues of each venue's Parkinson volatility over its windowSec / 60 candles ending at
 *  tEnd. A venue missing one of those candles, or a high/low, is left out; fewer than QUORUM left: no report. */
export function sigmaVenueRange(fresh: VenueSeries[], tEnd: number, windowSec: number): number {
	const n = windowSec / DESK.CANDLE_SEC
	const values: number[] = []
	for (const s of fresh) {
		const byT = new Map(s.candles.map((c) => [c.t, c] as const))
		const window: Candle[] = []
		for (let i = n - 1; i >= 0; i--) {
			const c = byT.get(tEnd - i * DESK.CANDLE_SEC)
			if (c !== undefined) window.push(c)
		}
		if (window.length < n) continue
		try {
			values.push(parkinsonPerSqrtSec(window))
		} catch {
			// no high/low on this venue: left out
		}
	}
	if (values.length < DESK.QUORUM) {
		throw new QuorumError(`venue-range: ${values.length} venues with ${n} full candles < ${DESK.QUORUM}`)
	}
	return median(values)
}

/** binance-1s: realized volatility of 5 s returns over windowSec, from Binance 1 s closes ending at the last closed
 *  second (a second without a candle keeps the previous close). The lab's estimator (lab/clim_lab/venue.py rv_window). */
export function sigmaBinance1s(candles: Candle[], nowSec: number, windowSec: number): number {
	const closed = candles.filter((c) => c.t + 1 <= nowSec).sort((a, b) => a.t - b.t)
	if (closed.length === 0) throw new QuorumError('binance-1s: no closed second')
	const last = closed[closed.length - 1].t
	if (nowSec - (last + 1) > DESK.MAX_AGE_1S_SEC) {
		throw new QuorumError(`binance-1s: last second closed ${nowSec - last - 1} s ago`)
	}
	const step = DESK.STEP_1S_SEC
	const n = windowSec / step
	const first = last - n * step
	if (closed[0].t > first) throw new QuorumError('binance-1s: not enough history')
	const prices: number[] = []
	let j = 0
	let px = Number.NaN
	for (let k = 0; k <= n; k++) {
		const target = first + k * step
		while (j < closed.length && closed[j].t <= target) {
			px = closed[j].close
			j++
		}
		prices.push(px)
	}
	let ss = 0
	for (let k = 1; k < prices.length; k++) {
		const r = Math.log(prices[k] / prices[k - 1])
		ss += r * r
	}
	return Math.sqrt(ss / windowSec)
}

export function dispersionBp(closes: number[], mid: number): number {
	let worst = 0
	for (const p of closes) worst = Math.max(worst, Math.abs(p / mid - 1))
	return Math.max(0, Math.ceil(worst * 1e4 - 1e-9))
}

export function annualPctFromE9(sigmaE9: number): number {
	return (sigmaE9 / 1e9) * Math.sqrt(SECONDS_PER_YEAR) * 100
}

function sigmas(input: EstimatorInput, fresh: VenueSeries[], tEnd: number): [number, number] {
	switch (input.estimator) {
		case 'median-close':
			return [sigmaMedianClose(fresh, tEnd, DESK.LONG_SEC), sigmaMedianClose(fresh, tEnd, DESK.SHORT_SEC)]
		case 'venue-range':
			return [sigmaVenueRange(fresh, tEnd, DESK.LONG_SEC), sigmaVenueRange(fresh, tEnd, DESK.SHORT_SEC)]
		case 'binance-1s': {
			if (input.binance1s === null) throw new QuorumError('binance-1s: no data')
			return [
				sigmaBinance1s(input.binance1s, input.nowSec, DESK.LONG_SEC),
				sigmaBinance1s(input.binance1s, input.nowSec, DESK.SHORT_SEC),
			]
		}
	}
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

	const [s15, s5] = sigmas(input, fresh, tEnd)
	const endCloses: number[] = []
	for (const s of fresh) {
		const c = s.candles.find((x) => x.t === tEnd)
		if (c !== undefined) endCloses.push(c.close)
	}
	const closeMid = median(endCloses)
	const usdTickers: number[] = []
	for (const t of input.tickers) {
		if (t.quote === 'USD') usdTickers.push(t.price)
		else if (input.usdtUsd !== null && input.usdtUsd > 0) usdTickers.push(t.price * input.usdtUsd)
	}
	const fromTickers = usdTickers.length >= DESK.QUORUM
	const mid = fromTickers ? median(usdTickers) : closeMid
	return {
		sigma15E9: Math.round(s15 * 1e9),
		sigma5E9: Math.round(s5 * 1e9),
		dispBp: dispersionBp(endCloses, closeMid),
		nSources: fresh.length,
		venueMidE6: Math.round(mid * 1e6),
		midFrom: fromTickers ? 'tickers' : 'closes',
		tEnd,
		sources: fresh.map((s) => s.venue),
	}
}

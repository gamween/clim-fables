import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The pacing functions of cre/scripts/sim-loop.sh, called through bash (the script runs its loop only when executed,
// not when sourced). macOS runs it with /bin/bash 3.2.
const SCRIPT = join(import.meta.dir, '..', 'scripts', 'sim-loop.sh')
const sh = (call: string): string => {
	const r = Bun.spawnSync(['bash', '-c', `source "${SCRIPT}" && ${call}`])
	if (r.exitCode !== 0) throw new Error(`bash exited ${r.exitCode}: ${r.stderr.toString()}`)
	return r.stdout.toString().trim()
}
const transcript = (lines: string[]): string => {
	const f = join(mkdtempSync(join(tmpdir(), 'sim-loop-')), 'run.log')
	writeFileSync(f, lines.length > 0 ? `${lines.join('\n')}\n` : '')
	return f
}

// The workflow's lines as the loop's filter keeps them (2026-10-14 runs on Robinhood Chain testnet).
const APPLIED = [
	'2026-10-14T09:34:16Z [USER LOG] node: estimator=venue-range sources=coinbase,kraken,binance,hyperliquid n=4 tEnd=1791970380 sigma5=27.7% sigma15=27.3% disp=6bp mid=2497.37 (tickers)',
	'2026-10-14T09:34:17Z [USER LOG] consensus: sigma5=27.7%/yr sigma15=27.3%/yr sigma5E9=49415 sigma15E9=48604 n=4 disp=6bp venue=2497.37 pool=2497.72 dev=-138pips tObs=1791970456',
	'2026-10-14T09:34:17Z [USER LOG] desk before: seq=102 tObs=1791970429 sigma5=28.5%/yr dev=390 flags=0',
	'2026-10-14T09:34:19Z [USER LOG] Write report transaction succeeded: 0x85e94b619908bd8e0cc9efa764a8ab1e6232c12bd8a6d2d78a7dd98df331bb00',
	'2026-10-14T09:34:19Z [USER LOG] REPORT applied seq=103 sigma5Reported=27.7% sigma5Applied=27.7% dev=-138 flags=0 tx=0x85e94b619908bd8e0cc9efa764a8ab1e6232c12bd8a6d2d78a7dd98df331bb00',
]
const SKIPPED = [
	'2026-10-14T09:35:18Z [USER LOG] consensus: sigma5=26.8%/yr sigma15=27.9%/yr sigma5E9=47704 sigma15E9=49749 n=4 disp=6bp venue=2495.55 pool=2497.72 dev=-867pips tObs=1791970517',
	'2026-10-14T09:35:18Z [USER LOG] desk before: seq=104 tObs=1791970500 sigma5=26.8%/yr dev=-239 flags=0',
	'2026-10-14T09:35:18Z [USER LOG] clim: no report (17 s since the last report < 20 s)',
]

describe('the tObs the next report must clear', () => {
	test("a run that sent a report: that report's tObs", () => {
		expect(sh(`anchor_tobs "${transcript(APPLIED)}"`)).toBe('1791970456')
	})
	test("a run that sent nothing: the desk's last tObs as the run read it", () => {
		expect(sh(`anchor_tobs "${transcript(SKIPPED)}"`)).toBe('1791970500')
	})
	test('a run that printed neither (CLI or network failure): none', () => {
		expect(sh(`anchor_tobs "${transcript(['✗ Credential validation failed'])}"`)).toBe('')
		expect(sh(`anchor_tobs "${transcript([])}"`)).toBe('')
	})
})

describe("a run's start-up (its tObs minus the loop's start time)", () => {
	test('from the consensus line', () => {
		expect(sh(`startup_sec 1791970454 "${transcript(APPLIED)}"`)).toBe('2')
		expect(sh(`startup_sec 1791970515 "${transcript(SKIPPED)}"`)).toBe('2')
	})
	test('none without a consensus line', () => {
		expect(sh(`startup_sec 1791970454 "${transcript([])}"`)).toBe('')
	})
	test('the median of the last runs ignores one slow start', () => {
		expect(sh('median_of 2 1 39 3 2')).toBe('2')
		expect(sh('median_of 15')).toBe('15')
		expect(sh('median_of')).toBe('')
	})
})

describe('when the next run starts (interval 30 s, RiskDeskV2.MIN_GAP 20 s)', () => {
	test('30 s after the last tObs, minus the expected start-up: one report every 30 s', () => {
		expect(sh('next_start 1000 1002 2 30 20')).toBe('1030') // start-up 2 s: the next tObs lands at 1032
	})
	test('a fast start after a slow one still clears MIN_GAP (the 09:22 to 09:32 UTC skips)', () => {
		// 2026-10-14 09:30:59: start-up 39 s (tObs = start + 39); the next run started on finishing, 4 s later, and its
		// tObs came 9 s after: "no report (9 s since the last report < 20 s)". Now it waits for anchor + 30 - lead.
		const start = 1_000
		const anchor = start + 39
		for (const lead of [0, 2, 8, 39]) {
			const next = Number(sh(`next_start ${start} ${anchor} ${lead} 30 20`))
			expect(next - anchor).toBeGreaterThanOrEqual(22) // any start-up >= 0 then gives a gap >= 22 s > MIN_GAP
		}
	})
	test('the lead is capped at interval - MIN_GAP - 2 s', () => {
		expect(sh('next_start 1000 1039 39 30 20')).toBe('1061')
		expect(sh('next_start 1000 1039 -3 30 20')).toBe('1069')
		expect(sh('next_start 1000 1039 5 21 20')).toBe('1060') // no room for a lead
	})
	test('no tObs read (the run failed): INTERVAL after this start, as before', () => {
		expect(sh('next_start 1000 "" 2 30 20')).toBe('1030')
	})
	test('an old tObs (after a silence) gives a start in the past: the loop starts at once', () => {
		expect(Number(sh('next_start 5000 1000 2 30 20'))).toBeLessThan(5000)
	})
})

// Outage handling of the live processes, pure parts. The stack runs on the maintainer's Mac: it may sleep, lose the
// network, reboot, or a process may crash (launchd restarts it). Each process ticks on a timer; a wall-clock gap of more
// than WAKE_GAP_SEC between two timer firings means the Mac slept or the process was stopped, and the process then
// re-syncs its nonce and re-reads the chain before acting. Failed ticks back off (capped) instead of crashing.

/** Timer firings are at most 10 s apart in every process, so a gap of more than 60 s is a sleep or a stop. */
export const WAKE_GAP_SEC = 60;

export type ClockGap = { fromMs: number; toMs: number; gapSec: number };
export type LoopGuardOptions = { wakeGapSec: number; baseMs: number; capMs: number; recordAfterFailures: number };

const DEFAULTS: LoopGuardOptions = { wakeGapSec: WAKE_GAP_SEC, baseMs: 2_000, capMs: 60_000, recordAfterFailures: 3 };

/** Delay before the next try after `failures` consecutive failures: base, 2 x base, 4 x base, ... capped. */
export function backoffMs(failures: number, baseMs = DEFAULTS.baseMs, capMs = DEFAULTS.capMs): number {
  if (failures <= 0) return 0;
  return Math.min(capMs, baseMs * 2 ** (failures - 1));
}

/** True when an action prepared at startedMs is too old to send at nowMs (the Mac may have slept in between). */
export function isStale(startedMs: number, nowMs: number, maxAgeMs: number): boolean {
  return nowMs - startedMs > maxAgeMs;
}

/** ClimPoker's DeskBlind() revert (selector 0x5caf72fd), decoded or raw: a normal skip, not an error. */
export function isDeskBlindError(text: string): boolean {
  return /DeskBlind|0x5caf72fd/.test(text);
}

/** Per-process state machine: wall-clock jumps, consecutive failures and the backoff they impose. */
export class LoopGuard {
  private readonly o: LoopGuardOptions;
  private lastBeatMs: number | null = null;
  private failures = 0;
  private firstFailureMs: number | null = null;
  private notBeforeMs = 0;

  constructor(options: Partial<LoopGuardOptions> = {}) {
    this.o = { ...DEFAULTS, ...options };
  }

  /** Call on every timer firing. Returns the gap when this firing follows a wall-clock jump, else null. A resume
   *  lifts any backoff, so the process acts on fresh state at once. */
  beat(nowMs: number): ClockGap | null {
    const prev = this.lastBeatMs;
    this.lastBeatMs = nowMs;
    if (prev === null || nowMs - prev <= this.o.wakeGapSec * 1_000) return null;
    this.notBeforeMs = 0;
    return { fromMs: prev, toMs: nowMs, gapSec: Math.round((nowMs - prev) / 1_000) };
  }

  /** False while a backoff is running. */
  canRun(nowMs: number): boolean {
    return nowMs >= this.notBeforeMs;
  }

  /** Records a failed tick; returns the backoff delay before the next try. */
  failure(nowMs: number): number {
    this.failures += 1;
    this.firstFailureMs ??= nowMs;
    const delay = backoffMs(this.failures, this.o.baseMs, this.o.capMs);
    this.notBeforeMs = nowMs + delay;
    return delay;
  }

  /** Records a good tick; returns the span of the failure streak it ends when the streak had at least
   *  recordAfterFailures failures (an RPC or network outage worth recording), else null. */
  success(nowMs: number): ClockGap | null {
    const failures = this.failures;
    const first = this.firstFailureMs;
    this.failures = 0;
    this.firstFailureMs = null;
    this.notBeforeMs = 0;
    if (first === null || failures < this.o.recordAfterFailures) return null;
    return { fromMs: first, toMs: nowMs, gapSec: Math.round((nowMs - first) / 1_000) };
  }

  get consecutiveFailures(): number {
    return this.failures;
  }
}

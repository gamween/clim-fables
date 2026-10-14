// Outage handling of the live processes, the side-effect parts: the supervised tick loop, the local outage records
// (bots/out/outages-local.jsonl) and the nonce re-sync. The decisions are in supervise.ts (pure, tested).
import { join } from "node:path";
import { appendJsonl, OUT_DIR, shortError } from "../../lib/jsonl";
import type { LiveWallet } from "./chain";
import type { LocalOutageKind } from "./outages";
import { LoopGuard, type ClockGap } from "./supervise";
import { lastTs } from "./tail";

export const LOCAL_OUTAGES_FILE = join(OUT_DIR, "outages-local.jsonl");

export function recordLocalOutage(process: string, kind: LocalOutageKind, fromMs: number, toMs: number, detail: string): void {
  appendJsonl(LOCAL_OUTAGES_FILE, {
    ts: new Date().toISOString(),
    process,
    kind,
    fromSec: Math.floor(fromMs / 1_000),
    toSec: Math.floor(toMs / 1_000),
    detail,
  });
}

/** At start: if the process logged before, it was down from its last log line until now (a crash, a reboot, a stop). */
export function recordStart(process: string, logFile: string): void {
  const last = lastTs(logFile);
  const now = Date.now();
  if (last === null) return;
  const lastMs = Date.parse(last);
  if (Number.isFinite(lastMs) && lastMs < now) {
    recordLocalOutage(process, "restart", lastMs, now, `started; last log line at ${last}`);
  }
}

/** Drops the cached nonce, so the next transaction reads it from the chain (pending block). */
export function resyncNonce(wallet: LiveWallet): void {
  wallet.account.nonceManager?.reset({ address: wallet.account.address, chainId: wallet.chain.id });
}

export type SupervisedLoop = {
  /** Process name in the local records: desk, runner, keeper, arb, noise, outages. */
  name: string;
  /** The process's JSON-lines log (its last line dates a restart). */
  logFile: string;
  /** Timer period; at most 10 s so that a gap of more than 60 s can only be a sleep or a stop. */
  everyMs: number;
  /** One iteration; throwing counts as a failure (capped backoff), never a crash. */
  tick: () => Promise<void>;
  /** After a wall-clock jump, before the next tick (the nonce is already re-synced). */
  onResume?: (gap: ClockGap) => Promise<void> | void;
  /** The wallet whose nonce is re-synced after a jump and after every failed tick. */
  wallet?: LiveWallet;
  /** Run a tick at once instead of after the first period. */
  immediate?: boolean;
};

/** Runs `tick` every `everyMs`, one at a time, with wake detection, nonce re-sync and capped backoff. */
export function runSupervised(l: SupervisedLoop): void {
  const guard = new LoopGuard();
  let busy = false;
  let resume: ClockGap | null = null;
  recordStart(l.name, l.logFile);
  const fire = (): void => {
    const now = Date.now();
    const gap = guard.beat(now);
    if (gap) {
      resume = gap;
      recordLocalOutage(l.name, "wake", gap.fromMs, gap.toMs, `wall-clock gap of ${gap.gapSec} s between two timer firings`);
      console.log(`[${l.name}] resumed after a ${gap.gapSec} s wall-clock gap (Mac asleep or process stopped): re-syncing`);
    }
    if (busy || !guard.canRun(now)) return;
    busy = true;
    const pending = resume;
    resume = null;
    (async () => {
      if (pending) {
        if (l.wallet) resyncNonce(l.wallet);
        await l.onResume?.(pending);
      }
      await l.tick();
    })()
      .then(
        () => {
          const streak = guard.success(Date.now());
          if (streak) {
            recordLocalOutage(l.name, "rpc-errors", streak.fromMs, streak.toMs, `failing ticks for ${streak.gapSec} s, recovered`);
            console.log(`[${l.name}] recovered after ${streak.gapSec} s of failing ticks`);
          }
        },
        (e: unknown) => {
          if (pending) resume = resume ?? pending; // the resume did not complete: redo it on the next tick
          if (l.wallet) resyncNonce(l.wallet);
          const delay = guard.failure(Date.now());
          console.error(`[${l.name}] ${shortError(e)}; failure ${guard.consecutiveFailures}, next try in ${delay / 1_000} s`);
        },
      )
      .finally(() => {
        busy = false;
      });
  };
  if (l.immediate) fire();
  setInterval(fire, l.everyMs);
}

/** Wake detection alone, for the desk loop (its CRE runs are separate processes that read their nonce every run). */
export function watchClock(name: string, onGap: (gap: ClockGap) => void, everyMs = 5_000): void {
  const guard = new LoopGuard();
  guard.beat(Date.now());
  setInterval(() => {
    const gap = guard.beat(Date.now());
    if (!gap) return;
    recordLocalOutage(name, "wake", gap.fromMs, gap.toMs, `wall-clock gap of ${gap.gapSec} s between two timer firings`);
    console.log(`[${name}] resumed after a ${gap.gapSec} s wall-clock gap (Mac asleep or process stopped)`);
    onGap(gap);
  }, everyMs);
}

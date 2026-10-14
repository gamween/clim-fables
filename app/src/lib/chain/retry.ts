// Ported from bots/src/live/lib/retry.ts (the live scripts' fix of 2026-10-14). The public RPCs of Robinhood Chain are
// load-balanced and some nodes lag the head by a few blocks, so a read pinned to the head block can fail on a node that
// has not seen it yet. The app reads a few blocks behind the head and retries a failed read.

/** Blocks behind the head the app reads at (0.3 s of chain at 0.1 s blocks). */
export const HEAD_LAG_BLOCKS = 3n;
export const READ_RETRIES = 3;
export const READ_RETRY_DELAY_MS = 1_000;

export function laggedHead(head: bigint, lag: bigint = HEAD_LAG_BLOCKS): bigint {
  return head > lag ? head - lag : 0n;
}

export type RetryOptions = {
  retries?: number;
  delayMs?: number;
  shouldRetry?: (e: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
};

/** `fn()`, tried again up to `retries` times, `delayMs` apart; the last error is thrown when every try failed. */
export async function withRetry<T>(fn: () => Promise<T>, o: RetryOptions = {}): Promise<T> {
  const retries = o.retries ?? READ_RETRIES;
  const delayMs = o.delayMs ?? READ_RETRY_DELAY_MS;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= retries || (o.shouldRetry !== undefined && !o.shouldRetry(e))) throw e;
      await sleep(delayMs);
    }
  }
}

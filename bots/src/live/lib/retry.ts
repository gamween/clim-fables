// Reads on Robinhood Chain testnet's public RPC, which is load-balanced: some of its nodes lag the head by a few blocks,
// so a read pinned to the head block can fail (BlockNotFoundError, "Missing or invalid parameters", "historical state not
// available") on a node that has not seen that block yet. The scripts read a few blocks behind the head and retry a
// failed read; a check never changes because of a retry, it only gets its data.

/** Blocks behind the head the scripts read at (0.3 s of chain at 0.1 s blocks). */
export const HEAD_LAG_BLOCKS = 3n;
export const READ_RETRIES = 3;
export const READ_RETRY_DELAY_MS = 1_000;

export function laggedHead(head: bigint, lag: bigint = HEAD_LAG_BLOCKS): bigint {
  return head > lag ? head - lag : 0n;
}

export type RetryOptions = {
  /** retries after the first try (default READ_RETRIES) */
  retries?: number;
  /** wait before each retry (default READ_RETRY_DELAY_MS) */
  delayMs?: number;
  /** false: throw this error at once (default: retry any error) */
  shouldRetry?: (e: unknown) => boolean;
  /** called before each retry with its number, from 1 */
  onRetry?: (e: unknown, retry: number) => void;
  sleep?: (ms: number) => Promise<void>;
};

/** `fn()`, tried again up to `retries` times, `delayMs` apart, while it throws an error `shouldRetry` accepts; the last
 *  error is thrown when every try failed. */
export async function withRetry<T>(fn: () => Promise<T>, o: RetryOptions = {}): Promise<T> {
  const retries = o.retries ?? READ_RETRIES;
  const delayMs = o.delayMs ?? READ_RETRY_DELAY_MS;
  const sleep = o.sleep ?? ((ms: number) => Bun.sleep(ms));
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= retries || (o.shouldRetry !== undefined && !o.shouldRetry(e))) throw e;
      o.onRetry?.(e, attempt + 1);
      await sleep(delayMs);
    }
  }
}

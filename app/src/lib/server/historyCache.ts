// The server's copy of one log history (app/api/history/[series]), kept in memory. The first request waits for the
// whole window; after that a request is answered at once with the last history, and when that is older than
// `maxAgeMs` a top-up from it (the blocks since its head only) starts in the background. Concurrent requests share one
// read; a failed top-up keeps the last good history (it carries the block it was read at).
import type { History } from "@/lib/chain/history";

export type CacheEntry<T> = { history: History<T>; builtAt: number };

export function createHistoryCache<T>(poll: (prev: History<T> | null) => Promise<History<T>>, o: { maxAgeMs: number; now?: () => number }) {
  const now = o.now ?? Date.now;
  let entry: CacheEntry<T> | null = null;
  let pending: Promise<CacheEntry<T>> | null = null;
  const read = () =>
    (pending ??= poll(entry?.history ?? null)
      .then((history) => (entry = { history, builtAt: now() }))
      .finally(() => {
        pending = null;
      }));
  return {
    async get(): Promise<CacheEntry<T>> {
      if (entry === null) return read();
      if (now() - entry.builtAt >= o.maxAgeMs) read().catch(() => undefined);
      return entry;
    },
    /** The top-up under way, if any; it never rejects (a failure keeps the last history). The route hands it to
     *  next/server's after() so the function lives until it ends. */
    refreshing(): Promise<void> | null {
      return pending ? pending.then(() => undefined, () => undefined) : null;
    },
  };
}

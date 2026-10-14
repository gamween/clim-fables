// The browser's first read of a log history: the server's cached copy (app/api/history/[series], read from the chain
// by the server at most a minute ago) is shown at once, then topped up from the chain with the blocks after it.
import type { History } from "./history";
import { decodeHistory } from "./historyJson";

/** Give up on the cache after this long and read the whole window from the chain instead. */
export const SEED_TIMEOUT_MS = 6_000;

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export async function fetchSeed<T>(key: string, windowSec: number, fetchImpl: Fetch = fetch): Promise<History<T>> {
  const res = await fetchImpl(`/api/history/${key}`, { signal: AbortSignal.timeout(SEED_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`history cache answered ${res.status}`);
  const { history } = decodeHistory<T>(await res.json());
  if (history.windowSec !== windowSec) throw new Error(`history cache has a ${history.windowSec} s window, expected ${windowSec} s`);
  return history;
}

/** The cached history, published as soon as it arrives, then `poll` from it; `poll(null)` (the whole window from the
 *  chain) when the cache fails. */
export async function seededPoll<T>(o: { seed: () => Promise<History<T>>; poll: (prev: History<T> | null) => Promise<History<T>>; publish: (h: History<T>) => void }): Promise<History<T>> {
  let prev: History<T> | null = null;
  try {
    prev = await o.seed();
  } catch {
    prev = null;
  }
  if (prev) o.publish(prev);
  return o.poll(prev);
}

// Small helpers for the status and verification scripts: the last line of a large log, and block ranges for getLogs
// (RPCs cap the range of one eth_getLogs call; Robinhood Chain makes about 10 blocks per second).
import { closeSync, existsSync, fstatSync, openSync, readSync } from "node:fs";

/** The last non-empty line of a file, reading at most maxBytes from its end. */
export function lastLine(path: string, maxBytes = 65_536): string | null {
  if (!existsSync(path)) return null;
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(size, maxBytes);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString("utf8").split("\n").filter((l) => l.trim() !== "");
    return lines[lines.length - 1] ?? null;
  } finally {
    closeSync(fd);
  }
}

/** `ts` of the last JSON line of a log, or null. */
export function lastTs(path: string): string | null {
  const line = lastLine(path);
  if (line === null) return null;
  try {
    const o = JSON.parse(line) as { ts?: unknown };
    return typeof o.ts === "string" ? o.ts : null;
  } catch {
    return null;
  }
}

/** Inclusive [from, to] ranges of at most `chunk` blocks covering [fromBlock, toBlock]. */
export function chunkedRanges(fromBlock: bigint, toBlock: bigint, chunk = 2_000n): Array<[bigint, bigint]> {
  const out: Array<[bigint, bigint]> = [];
  for (let a = fromBlock; a <= toBlock; a += chunk) {
    const b = a + chunk - 1n;
    out.push([a, b < toBlock ? b : toBlock]);
  }
  return out;
}

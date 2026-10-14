// Number, time and address formats, after Fables' own (docs/research/fables-ui-inventory.md §5): fees in percent never
// in bp, trimmed to significant digits; averages to 4 decimals; prices and amounts with thousands separators; "-" for
// a missing value. Times are UTC so every viewer reads the same text.
import { sigmaE9ToAnnual } from "@clim/shared";

export const MISSING = "-";

const trimZeros = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);

/** A fee in pips (1e-6) as Fables shows it: 700 -> "0.07%", 5000 -> "0.5%", 1468 -> "0.1468%". */
export function formatFeePct(pips: number | null | undefined): string {
  if (pips === null || pips === undefined || !Number.isFinite(pips)) return MISSING;
  return `${trimZeros((pips / 10_000).toFixed(4))}%`;
}

/** An average fee in pips with 4 decimals, as Fables' "0.1007% average over 7d". */
export function formatAvgFeePct(pips: number | null | undefined): string {
  if (pips === null || pips === undefined || !Number.isFinite(pips)) return MISSING;
  return `${(pips / 10_000).toFixed(4)}%`;
}

const twoDecimals = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A price in USDG per ETH: "2,484.83". */
export function formatPrice(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return MISSING;
  return twoDecimals.format(n);
}

/** A token amount, up to `maxDecimals` decimals, separators kept: "7,388.25462". */
export function formatAmount(n: number, maxDecimals = 5): string {
  if (!Number.isFinite(n)) return MISSING;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: maxDecimals }).format(n);
}

/** An integer with separators: "86,285". */
export function formatInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return MISSING;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

/** A fraction as a percentage with 2 decimals: 1.1181 -> "111.81%". */
export function formatPct2(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return MISSING;
  return `${twoDecimals.format(fraction * 100)}%`;
}

/** The desk's sigma (per-sqrt-second x 1e9) as annualised volatility: "41.58%". */
export function formatSigmaE9(sigmaE9: number | null | undefined): string {
  if (sigmaE9 === null || sigmaE9 === undefined) return MISSING;
  return formatPct2(sigmaE9ToAnnual(sigmaE9));
}

/** The venue-minus-pool gap in pips of the pool price (1e-6) as a signed percentage: 158 -> "+0.0158%". */
export function formatGapPips(devPips: number | null | undefined): string {
  if (devPips === null || devPips === undefined || !Number.isFinite(devPips)) return MISSING;
  const sign = devPips > 0 ? "+" : devPips < 0 ? "-" : "";
  return `${sign}${trimZeros((Math.abs(devPips) / 10_000).toFixed(4))}%`;
}

/** A relative age, Fables' table style: "17s", "1m", "2h", "3d". */
export function formatAge(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return MISSING;
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

/** A duration in plain words: "13 min 34 s", "45 s", "2 h 05 min". */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")} min`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A chart axis label: "Oct 9" (UTC). */
export function formatDayTick(ts: number): string {
  const d = new Date(ts * 1000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** An hour axis label: "14:00" (UTC). */
export function formatHourTick(ts: number): string {
  const d = new Date(ts * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** A chart tooltip head: "Oct 12, 3:23 AM UTC". */
export function formatTooltipTime(ts: number): string {
  const d = new Date(ts * 1000);
  const h = d.getUTCHours();
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${h % 12 === 0 ? 12 : h % 12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"} UTC`;
}

/** A clock time: "09:04:39 UTC". */
export function formatUtcClock(ts: number): string {
  return `${new Date(ts * 1000).toISOString().slice(11, 19)} UTC`;
}

/** A date and time: "2026-10-14 09:04:39 UTC". */
export function formatUtcDateTime(ts: number): string {
  const iso = new Date(ts * 1000).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

/** "0xbac3...e551". */
export function shortAddress(a: string): string {
  return a.length <= 12 ? a : `${a.slice(0, 6)}...${a.slice(-4)}`;
}

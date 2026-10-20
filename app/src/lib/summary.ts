// The markets page's summary rail (Fables' "Total deposits" and "Total volume" cards): a fee series over 24 hours as an
// area, and as one bar per UTC hour. Pure, so the bars the page draws are the numbers the tests check.
import { feeAt, timeWeightedAverage, type Direction, type FeeStep } from "./fees";

export const HOUR = 3_600;

export type HourBar = { start: number; end: number; avg: number | null; partial: boolean };

/** The time-weighted average of the steps over [from, to], or null when no fee is in force at `from`. */
export function averageOver(steps: readonly FeeStep[], from: number, to: number, d: Direction): number | null {
  if (to <= from) return null;
  const start = feeAt(steps, from, d);
  if (start === null) return null;
  const inside = steps.filter((s) => s.t > from && s.t < to);
  const clipped: FeeStep[] = [{ t: from, fee0For1: start, fee1For0: start, overridden: false }, ...inside];
  return timeWeightedAverage(clipped, to, d);
}

/** `hours` bars on UTC hour boundaries, the last one being the hour `to` falls in (partial unless `to` is on the hour). */
export function hourlyBars(steps: readonly FeeStep[], to: number, d: Direction, hours = 24): HourBar[] {
  const lastStart = Math.ceil(to / HOUR) * HOUR - HOUR;
  const bars: HourBar[] = [];
  for (let i = hours - 1; i >= 0; i--) {
    const start = lastStart - i * HOUR;
    const end = Math.min(start + HOUR, to);
    bars.push({ start, end, avg: averageOver(steps, start, end, d), partial: end < start + HOUR });
  }
  return bars;
}

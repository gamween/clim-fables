// Pure geometry of Fables-style step charts: an SVG path of H/V segments (Fables draws its fee line this way) and the
// time ticks under it.
import { formatDayTick, formatHourTick } from "@/lib/format";

export type Point = { t: number; v: number };
export type Frame = { from: number; to: number; yMin: number; yMax: number; width: number; height: number };

export const xOf = (f: Frame, t: number) => ((t - f.from) / (f.to - f.from)) * f.width;
export const yOf = (f: Frame, v: number) => f.height - ((v - f.yMin) / (f.yMax - f.yMin)) * f.height;

const r = (n: number) => Math.round(n * 100) / 100;

/** "M x0 y0 H x1 V y1 ... H xEnd": each value holds until the next point, the last one until `to`. Points before
 *  `from` are clamped to it. */
export function stepPath(points: readonly Point[], f: Frame): string {
  if (points.length === 0) return "";
  const parts: string[] = [];
  points.forEach((p, i) => {
    const x = r(xOf(f, Math.max(p.t, f.from)));
    const y = r(yOf(f, p.v));
    parts.push(i === 0 ? `M${x} ${y}` : `H${x} V${y}`);
  });
  parts.push(`H${r(f.width)}`);
  return parts.join(" ");
}

/** The step path closed down to the baseline, for the area under the line. */
export function stepArea(points: readonly Point[], f: Frame): string {
  const line = stepPath(points, f);
  if (!line) return "";
  const first = points[0] as Point;
  return `${line} V${r(f.height)} H${r(xOf(f, Math.max(first.t, f.from)))} Z`;
}

/** The value in force at `t`, or null before the first point. */
export function valueAt(points: readonly Point[], t: number): number | null {
  let v: number | null = null;
  for (const p of points) {
    if (p.t > t) break;
    v = p.v;
  }
  return v;
}

const STEPS = [300, 900, 1800, 3600, 7200, 14_400, 21_600, 43_200, 86_400];

/** At most `max` ticks on round UTC times: days ("Oct 9") for windows over two days, hours ("14:00") otherwise. */
export function timeTicks(from: number, to: number, max = 8): Array<{ t: number; label: string }> {
  const span = to - from;
  const step = span > 2 * 86_400 ? 86_400 : (STEPS.find((s) => span / s <= max) ?? 86_400);
  const out: Array<{ t: number; label: string }> = [];
  for (let t = Math.ceil(from / step) * step; t <= to; t += step) out.push({ t, label: step >= 86_400 ? formatDayTick(t) : formatHourTick(t) });
  return out;
}

/** A y range that shows every series with a little headroom; never below 0. */
export function yRange(values: readonly number[], floor = 0): { yMin: number; yMax: number } {
  if (values.length === 0) return { yMin: floor, yMax: floor + 1 };
  const max = Math.max(...values);
  return { yMin: floor, yMax: max <= floor ? floor + 1 : floor + (max - floor) * 1.08 };
}

"use client";
import { useId, useRef, useState, type CSSProperties } from "react";
import { formatTooltipTime } from "@/lib/format";
import s from "./chart.module.css";
import { stepArea, stepPath, timeTicks, valueAt, xOf, yOf, yRange, type Frame, type Point } from "./scale";

export type Series = { id: string; label: string; color: string; points: Point[]; dashed?: boolean; area?: boolean };
export type Marker = { t: number; v: number; color: string };

const W = 1000;
const H = 227;

/** A step chart in Fables' style: lines drawn with H/V segments, a crosshair, a dot per series and a tooltip with one
 *  row per series. Values are fees in pips; `format` turns them into text. */
export function StepChart({ series, from, to, format, height = 249, markers = [], loading = false, empty }: {
  series: Series[];
  from: number;
  to: number;
  format: (v: number) => string;
  height?: number;
  markers?: Marker[];
  loading?: boolean;
  empty?: string;
}) {
  const gid = useId().replace(/:/g, "");
  const box = useRef<HTMLDivElement>(null);
  const [hoverT, setHoverT] = useState<number | null>(null);
  const values = [...series.flatMap((x) => x.points.map((p) => p.v)), ...markers.map((m) => m.v)];
  const f: Frame = { from, to, ...yRange(values), width: W, height: H };
  const hasData = series.some((x) => x.points.length > 0);

  const onMove = (e: React.PointerEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setHoverT(from + frac * (to - from));
  };

  const hx = hoverT === null ? 0 : (xOf(f, hoverT) / W) * 100;
  const plotH = height - 22;
  return (
    <div className={s.plot} style={{ "--plot-h": `${height}px` } as CSSProperties} ref={box} onPointerMove={onMove} onPointerLeave={() => setHoverT(null)}>
      {loading || !hasData ? (
        <div className={s.empty}>{loading ? <span className={s.loadingMark} aria-label="loading" /> : <span style={{ color: "var(--ink-muted)" }}>{empty ?? "No data in this window"}</span>}</div>
      ) : (
        <svg className={`${s.svg} ${s.reveal}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
          <defs>
            {series.map((x) => (
              <linearGradient key={x.id} id={`${gid}-${x.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={x.color} stopOpacity={0.4} />
                <stop offset="100%" stopColor={x.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          {series.map((x) => (x.area ? <path key={`a-${x.id}`} d={stepArea(x.points, f)} fill={`url(#${gid}-${x.id})`} stroke="none" /> : null))}
          {series.map((x) => (
            <path key={x.id} d={stepPath(x.points, f)} fill="none" stroke={x.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={x.dashed ? "4 3" : undefined} data-series={x.id} />
          ))}
          {markers.map((m, i) => (
            <circle key={i} cx={xOf(f, m.t)} cy={yOf(f, m.v)} r={3} fill={m.color} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
      )}
      <div className={s.ticks} aria-hidden>
        {timeTicks(from, to).map((t) => (
          <span key={t.t} className={s.tick} style={{ left: `${(xOf(f, t.t) / W) * 100}%` }}>
            {t.label}
          </span>
        ))}
      </div>
      {hoverT !== null && hasData && !loading ? (
        <>
          <span className={s.crosshair} style={{ left: `${hx}%` }} />
          {series.map((x) => {
            const v = valueAt(x.points, hoverT);
            return v === null ? null : <span key={x.id} className={s.dot} style={{ left: `${hx}%`, top: (yOf(f, v) / H) * plotH, background: x.color }} />;
          })}
          <div className={s.tooltip} style={hx > 60 ? { right: `calc(${100 - hx}% + 12px)` } : { left: `calc(${hx}% + 12px)` }}>
            <div className={s.tooltipHead}>{formatTooltipTime(Math.round(hoverT))}</div>
            {series.map((x) => {
              const v = valueAt(x.points, hoverT);
              return (
                <div key={x.id} className={s.tooltipRow}>
                  <span className={s.tooltipLabel}>
                    <span className={s.tooltipDot} style={{ background: x.color }} />
                    {x.label}
                  </span>
                  <span className={s.tooltipValue}>{v === null ? "-" : format(v)}</span>
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

"use client";
// Fables' summary rail on the markets page (inventory §2.2: "Total deposits" as an area, "Total volume" as bars), holding
// what the chain gives over the last 24 hours: the fee on Fables' ETH/USDG pool (keeper overrides, mainnet) as an area,
// and clim's recommendation (the testnet desk) as one bar per UTC hour. Hovering a card shows the value at that time.
import { useId, useRef, useState, type ReactNode } from "react";
import { InfoTip, LiveValue } from "@/components/ui/kit";
import { useClimPoints, useFablesPokes } from "@/hooks/live";
import { stepArea, stepPath, valueAt, xOf, type Frame, type Point } from "@/components/charts/scale";
import { FABLES } from "@/lib/chain/fables";
import { formatAvgFeePct, formatHourTick } from "@/lib/format";
import { hourlyBars, type HourBar } from "@/lib/summary";
import { climWindow, feeWindow } from "@/lib/windowStats";
import s from "./summary.module.css";

const DAY = 86_400;
const W = 600;
const H = 100;

/** Values from 0 to the series' peak with Fables' headroom, so both cards read from the same baseline. */
const yMaxOf = (values: number[]) => (values.length ? Math.max(...values) * 1.08 : 1);

function FeatureCard({ label, tip, big, caption, children, qa }: { label: string; tip: string; big: ReactNode; caption: ReactNode; children: ReactNode; qa: string }) {
  return (
    <div className={s.card} data-qa={qa}>
      <div className={s.head}>
        <div className={s.text}>
          <span className={s.label}>
            {label} <InfoTip text={tip} />
          </span>
          <span className={s.big}>{big}</span>
          <span className={s.caption}>{caption}</span>
        </div>
      </div>
      <div className={s.plotBox}>{children}</div>
    </div>
  );
}

const Wait = () => (
  <div className={s.plotWait}>
    <span className={s.plotSkeleton} aria-label="loading" />
  </div>
);
const BigWait = () => <span className={s.bigSkeleton} aria-label="loading" />;

function FablesFeeCard() {
  const pokes = useFablesPokes(DAY);
  const gid = useId().replace(/:/g, "");
  const box = useRef<HTMLDivElement>(null);
  const [hoverT, setHoverT] = useState<number | null>(null);
  const d = pokes.data;
  const win = d ? feeWindow(d.items, FABLES.config, d.toTs, DAY) : null;
  const points: Point[] = win ? win.steps.map((x) => ({ t: x.t, v: x.fee0For1 })) : [];
  const f: Frame | null = win ? { from: win.fromTs, to: win.toTs, yMin: 0, yMax: yMaxOf(points.map((p) => p.v)), width: W, height: H } : null;
  const hoverV = hoverT !== null ? valueAt(points, hoverT) : null;

  const onMove = (e: React.PointerEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || !win || r.width === 0) return;
    setHoverT(win.fromTs + Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (win.toTs - win.fromTs));
  };

  return (
    <FeatureCard
      qa="summary-fables"
      label="Fables' fee, 24h average"
      tip="The fee in force on Fables' ETH/USDG pool over the last 24 hours, time-weighted: the flat fee and every keeper override (FeePoked logs, Robinhood Chain mainnet)"
      big={
        hoverT !== null && hoverV !== null ? (
          formatAvgFeePct(hoverV)
        ) : win && d ? (
          <LiveValue k="fables:avg" chain="mainnet" block={d.toBlock} raw={win.avg ?? ""} text={formatAvgFeePct(win.avg)} range={{ fromBlock: d.fromBlock, toBlock: d.toBlock, fromTs: win.fromTs, toTs: win.toTs, cacheBlock: d.cacheBlock }} />
        ) : (
          <BigWait />
        )
      }
      caption={hoverT !== null ? `${formatHourTick(hoverT)} UTC` : "Keeper overrides, mainnet"}
    >
      {f && points.length ? (
        <div ref={box} className={s.hit} onPointerMove={onMove} onPointerLeave={() => setHoverT(null)}>
          <svg className={s.plot} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden data-series="fables-fee">
            <defs>
              <linearGradient id={`${gid}-fill`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="currentColor" stopOpacity="0.4" />
                <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
              </linearGradient>
            </defs>
            {hoverT !== null ? <line x1={xOf(f, hoverT)} x2={xOf(f, hoverT)} y1={0} y2={H} className={s.crosshair} /> : null}
            <g className={s.series}>
              <path d={stepArea(points, f)} fill={`url(#${gid}-fill)`} />
              <path d={stepPath(points, f)} fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            </g>
          </svg>
        </div>
      ) : (
        <Wait />
      )}
    </FeatureCard>
  );
}

function ClimFeeCard() {
  const pts = useClimPoints();
  const [hover, setHover] = useState<number | null>(null);
  const d = pts.data;
  const win = d ? climWindow(d.items, d.toTs, DAY) : null;
  const bars: HourBar[] = win ? hourlyBars(win.steps, win.toTs, "0For1") : [];
  const yMax = yMaxOf(bars.flatMap((b) => (b.avg === null ? [] : [b.avg])));
  const hovered = hover !== null ? bars[hover] : undefined;
  // Fables' bar geometry: each bar is 72 % of its step, the first flush left and the last flush right.
  const step = bars.length ? W / (bars.length - 1 + 0.72) : 0;
  const barW = step * 0.72;

  return (
    <FeatureCard
      qa="summary-clim"
      label="clim's fee, 24h average"
      tip="clim's recommendation at each desk report over the last 24 hours, time-weighted (ClimPoker's Poked logs, Robinhood Chain testnet); one bar per UTC hour, the current hour hatched"
      big={
        hovered && hovered.avg !== null ? (
          formatAvgFeePct(hovered.avg)
        ) : win && d ? (
          <LiveValue k="clim:avg" chain="testnet" block={d.toBlock} raw={win.avg ?? ""} text={formatAvgFeePct(win.avg)} range={{ fromBlock: d.fromBlock, toBlock: d.toBlock, fromTs: win.fromTs, toTs: win.toTs, cacheBlock: d.cacheBlock }} />
        ) : (
          <BigWait />
        )
      }
      caption={hovered ? `${formatHourTick(hovered.start)} UTC${hovered.partial ? ", so far" : ""}` : "Desk recommendation, testnet"}
    >
      {bars.some((b) => b.avg !== null) ? (
        <div className={s.hit} onPointerLeave={() => setHover(null)}>
          <svg className={s.plot} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden data-series="clim-fee">
            <defs>
              <pattern id="clim-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="3" height="6" fill="currentColor" fillOpacity="0.5" />
              </pattern>
            </defs>
            <g className={s.series}>
              {bars.map((b, i) => {
                const x = i * step;
                const h = b.avg === null ? 0 : (b.avg / yMax) * H;
                return (
                  <g key={b.start} onPointerEnter={() => setHover(i)}>
                    <rect x={x - (step - barW) / 2} y={0} width={step} height={H} className={hover === i ? s.column : s.columnIdle} />
                    {h > 0 ? (
                      <rect
                        x={x}
                        y={H - h}
                        width={barW}
                        height={h + 4}
                        rx={4}
                        className={s.bar}
                        fill={b.partial ? "url(#clim-hatch)" : "currentColor"}
                        data-dim={hover !== null && hover !== i ? "on" : undefined}
                      />
                    ) : null}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      ) : (
        <Wait />
      )}
    </FeatureCard>
  );
}

export function MarketsSummary() {
  return (
    <div className={s.railOuter}>
      <div className={s.rail} data-qa="summary-rail">
        <FablesFeeCard />
        <ClimFeeCard />
      </div>
    </div>
  );
}

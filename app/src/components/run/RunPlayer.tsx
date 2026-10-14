"use client";
// The recorded run, replayed in Fables' pool layout: a cursor moves through the 90 minutes of the 7 October 2026 storm
// and reveals clim's pokes on Fables' real hook (fork) next to Fables' own keeper fee (mainnet, same window).
import { useEffect, useState } from "react";
import { StepChart } from "@/components/charts/StepChart";
import { PeriodButtons } from "@/components/ui/FilterToggle";
import { AsideGrid, ChartPanel, RailRows, Rule, Stat, Swatch } from "@/components/ui/kit";
import forkReports from "@/generated/fork-reports-2026-10-07.json";
import forkRun from "@/generated/fork-run-2026-10-07.json";
import storm from "@/generated/fables-storm-2026-10-07.json";
import { formatFeePct, formatGapPips, formatPct2, formatTooltipTime } from "@/lib/format";
import { atCursor, buildRun, upTo } from "@/lib/run";
import u from "@/components/ui/ui.module.css";

const RUN = buildRun(forkRun, forkReports, storm);
const SPEEDS = { "30x": 30, "60x": 60, "120x": 120 } as const;
type Speed = keyof typeof SPEEDS;
const TICK_MS = 100;

export function RunPlayer() {
  const [t, setT] = useState(RUN.to);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>("60x");
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setT((v) => {
        const next = v + (SPEEDS[speed] * TICK_MS) / 1000;
        if (next >= RUN.to) {
          setPlaying(false);
          return RUN.to;
        }
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing, speed]);
  const c = atCursor(RUN, t);
  const play = () => {
    if (t >= RUN.to) setT(RUN.from);
    setPlaying((v) => !v);
  };
  return (
    <AsideGrid
      rail={
        <>
          <Stat label="Cursor" value={<span style={{ fontSize: 16 }}>{formatTooltipTime(Math.round(t))}</span>} secondary="2026-10-07, on the fork" />
          <Rule />
          <RailRows
            rows={[
              { label: "clim, poked", tip: "The fee ClimPoker sent to Fables' hook on the fork", value: formatFeePct(c.clim) },
              { label: "Fables keeper", tip: "The fee Fables' keeper set on mainnet at the same time", value: formatFeePct(c.keeper) },
              { label: "σ 5 min", tip: "The desk's 5-minute volatility in the replayed report", value: c.sigma5 === null ? "-" : formatPct2(c.sigma5) },
              { label: "Venue gap", tip: "Venue mid minus Fables' pool mid in the replayed report", value: formatGapPips(c.dev) },
              { label: "Swaps so far", value: String(c.swaps) },
            ]}
          />
        </>
      }
    >
      <ChartPanel
        top={
          <>
            <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
              <button type="button" className={u.secondary} style={{ height: 26, padding: "0 10px", fontSize: 12 }} onClick={play} aria-pressed={playing}>
                {playing ? "Pause" : t >= RUN.to ? "Replay" : "Play"}
              </button>
              <input
                type="range"
                aria-label="Cursor"
                min={RUN.from}
                max={RUN.to}
                step={30}
                value={Math.round(t)}
                onChange={(e) => {
                  setPlaying(false);
                  setT(Number(e.target.value));
                }}
                style={{ width: 220, accentColor: "var(--brand)" }}
              />
            </span>
            <PeriodButtons options={Object.keys(SPEEDS) as Speed[]} value={speed} onChange={setSpeed} />
          </>
        }
        legend={
          <>
            <span style={{ display: "inline-flex", gap: 12 }}>
              <Swatch color="var(--brand)" label="Fables keeper (mainnet)" />
              <Swatch color="var(--ink)" label="clim on the fork" />
              <Swatch color="var(--positive)" label="swap, buy" />
              <Swatch color="var(--negative)" label="swap, sell" />
            </span>
          </>
        }
      >
        <StepChart
          from={RUN.from}
          to={RUN.to}
          format={formatFeePct}
          series={[
            { id: "keeper", label: "Fables keeper", color: "var(--brand)", area: true, points: upTo(RUN.keeper, t) },
            { id: "clim", label: "clim on the fork", color: "var(--ink)", points: upTo(RUN.clim, t) },
          ]}
          markers={RUN.swaps.filter((s) => s.t <= t).map((s) => ({ t: s.t, v: s.feePips, color: s.zeroForOne ? "var(--negative)" : "var(--positive)" }))}
        />
      </ChartPanel>
    </AsideGrid>
  );
}

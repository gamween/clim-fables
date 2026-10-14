"use client";
import { StepChart } from "@/components/charts/StepChart";
import { ChartPanel, Swatch } from "@/components/ui/kit";
import forkReports from "@/generated/fork-reports-2026-10-07.json";
import forkRun from "@/generated/fork-run-2026-10-07.json";
import storm from "@/generated/fables-storm-2026-10-07.json";
import { formatFeePct } from "@/lib/format";
import { buildRun } from "@/lib/run";

const RUN = buildRun(forkRun, forkReports, storm);

/** The whole fork run at once: Fables' keeper on mainnet and clim on the fork, same window. */
export function ForkRunChart() {
  return (
    <ChartPanel
      legend={
        <span style={{ display: "inline-flex", gap: 12 }}>
          <Swatch color="var(--brand)" label="Fables keeper (mainnet)" />
          <Swatch color="var(--ink)" label="clim on the fork" />
        </span>
      }
    >
      <StepChart
        from={RUN.from}
        to={RUN.to}
        format={formatFeePct}
        height={220}
        series={[
          { id: "keeper", label: "Fables keeper", color: "var(--brand)", area: true, points: RUN.keeper },
          { id: "clim", label: "clim on the fork", color: "var(--ink)", points: RUN.clim },
        ]}
      />
    </ChartPanel>
  );
}

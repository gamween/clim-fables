import type { Metadata } from "next";
import { RunPlayer } from "@/components/run/RunPlayer";
import { ButtonLink, NetworkTag, Section, Stat } from "@/components/ui/kit";
import forkReports from "@/generated/fork-reports-2026-10-07.json";
import forkRun from "@/generated/fork-run-2026-10-07.json";
import storm from "@/generated/fables-storm-2026-10-07.json";
import { buildRun } from "@/lib/run";
import { FABLES } from "@/lib/chain/fables";
import { formatFeePct, formatInt, formatUtcDateTime } from "@/lib/format";
import { repoFile } from "@/lib/site";
import p from "@/components/pages.module.css";

export const metadata: Metadata = { title: "The run" };

// Server-side: a client module's exports are references, not values, in a server component.
const RUN = buildRun(forkRun, forkReports, storm);
const RUN_SUMMARY = RUN.summary;
const RUN_WINDOW = { from: RUN.from, to: RUN.to };

export default function RunPage() {
  return (
    <div className={p.pool}>
      <div className={p.poolHead}>
        <div className={p.identity}>
          <div>
            <h1 className={p.pairTitle}>The run, 7 October 2026</h1>
            <div className={p.pairSub}>
              <span className={p.pairSubMuted}>A fork of Robinhood Chain mainnet at block {formatInt(RUN_SUMMARY.forkBlock)}, against Fables&apos; real ETH/USDG hook. Nothing was sent to mainnet.</span>
              <NetworkTag network="mainnet" />
            </div>
          </div>
          <div className={p.actions}>
            <ButtonLink href={repoFile("docs/evidence/fork-run-2026-10-07.json")}>The recorded file</ButtonLink>
          </div>
        </div>
      </div>
      <div className={p.statRow}>
        <Stat label="Pokes" tip="ClimPoker.poke() calls on the fork, one per replayed desk report" value={formatInt(RUN_SUMMARY.pokes)} secondary="one every 30 s" />
        <Stat label="Poked fee" tip="Lowest and highest fee clim sent to Fables' hook" value={`${formatFeePct(RUN_SUMMARY.minPokedPips)} to ${formatFeePct(RUN_SUMMARY.maxPokedPips)}`} secondary="inside the hook's band" />
        <Stat label="Swaps" tip="Swaps sent both ways on the fork; each paid the hook's currentFee" value={formatInt(RUN_SUMMARY.swaps)} secondary={`${RUN_SUMMARY.swapReverts} reverted`} />
        <Stat label="Keeper overrides" tip="Fables' keeper's FeePoked logs on mainnet in the same window" value={formatInt(RUN_SUMMARY.keeperPokes)} secondary="mainnet, same window" />
        <Stat label="Window" value={<span style={{ fontSize: 16 }}>{formatUtcDateTime(RUN_WINDOW.from).slice(11)}</span>} secondary={`to ${formatUtcDateTime(RUN_WINDOW.to).slice(11)}`} />
      </div>
      <Section
        title="Replay"
        description="clim's desk reports for the storm, replayed every 30 s; ClimPoker pokes Fables' real hook on the fork after each one, and swaps both ways pay the hook's fee. Fables' own keeper fee over the same 90 minutes is drawn next to it, rebuilt from its mainnet logs."
      >
        <RunPlayer />
        <p className={p.note}>
          Recorded by <code>npm run demo:fork</code> ({forkRun.sigmaEstimator} estimator, etaE4 {formatInt(forkRun.etaE4)}). {forkRun.note}. Hook <code>{FABLES.hook}</code>. The run shows
          that clim&apos;s pokes land inside Fables&apos; bounds on its real hook and that swaps pay them; it is not a claim that clim prices the storm better than the keeper.
        </p>
      </Section>
    </div>
  );
}

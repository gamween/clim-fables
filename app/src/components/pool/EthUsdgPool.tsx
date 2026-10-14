"use client";
// Fables' ETH/USDG pool page with clim grafted into its Dynamic Fee section (inventory §2.3 and §8). Fables' side is
// read live from Robinhood Chain mainnet; clim's from the testnet desk. Nothing here sends a transaction.
import Link from "next/link";
import { useState } from "react";
import { StepChart, type Series } from "@/components/charts/StepChart";
import { FilterToggle, PeriodButtons } from "@/components/ui/FilterToggle";
import { AddressLink, AsideGrid, ButtonLink, ChartPanel, LiveDot, LiveValue, NetworkTag, ReadError, Section, Skeleton, Stat, Swatch, TierBadge } from "@/components/ui/kit";
import { ExternalIcon } from "@/components/ui/icons";
import { useClimNow, useClimPoints, useDeskReports, useFablesNow, useFablesPokes, useFablesSwaps } from "@/hooks/live";
import { mainnetClient } from "@/lib/chain/clients";
import { LIVE, sourcifyTestnet, testnetCode } from "@/lib/chain/deployments";
import { FABLES, fablesAddress, fablesTx } from "@/lib/chain/fables";
import { climQuoteOf, climSteps } from "@/lib/fees";
import { formatAge, formatFeePct, formatGapPips, formatInt, formatPrice, formatSigmaE9, formatUtcClock, shortAddress } from "@/lib/format";
import { deskBadge, feeTier, feeTooltip, MODE_NUMBER, modeLabel } from "@/lib/tiers";
import { feeWindow } from "@/lib/windowStats";
import p from "../pages.module.css";
import { FeeUpdates, feeUpdateRows } from "./FeeUpdates";
import { FeeRail, FeeValue, ParamsCard, PoolHeader } from "./parts";
import { RecentSwaps } from "./RecentSwaps";

const PERIODS = { "24H": 86_400, "7D": 7 * 86_400 } as const;
type Period = keyof typeof PERIODS;
type View = "both" | "direction";

export function EthUsdgPool() {
  const [period, setPeriod] = useState<Period>("24H");
  const [view, setView] = useState<View>("both");
  const windowSec = PERIODS[period];
  const fables = useFablesNow();
  const clim = useClimNow();
  const pokes = useFablesPokes(windowSec);
  const points = useClimPoints(PERIODS["24H"]);
  const reports = useDeskReports(900);
  const swaps = useFablesSwaps(600);

  const f = fables.data;
  const c = clim.data;
  const win = pokes.data ? feeWindow(pokes.data.items, FABLES.config, pokes.data.toTs, windowSec) : null;
  const climAge = c ? c.quote.blockTimestamp - c.quote.tObs : null;
  const badge = c && climAge !== null ? deskBadge(MODE_NUMBER[c.quote.mode], climAge, c.quote.tauKillSec) : null;

  const series: Series[] = [];
  if (win) series.push({ id: "keeper", label: "Fables keeper", color: "var(--brand)", area: true, points: win.steps.map((s) => ({ t: s.t, v: s.fee0For1 })) });
  if (points.data && win) {
    const cs = climSteps(points.data.items, Math.max(win.fromTs, points.data.toTs - PERIODS["24H"]), points.data.toTs);
    if (view === "both") series.push({ id: "clim", label: "clim", color: "var(--ink)", points: cs.map((s) => ({ t: s.t, v: climQuoteOf(s) })) });
    else {
      series.push({ id: "buy", label: "clim, buy ETH", color: "var(--positive)", points: cs.map((s) => ({ t: s.t, v: s.fee1For0 })) });
      series.push({ id: "sell", label: "clim, sell ETH", color: "var(--negative)", points: cs.map((s) => ({ t: s.t, v: s.fee0For1 })) });
    }
  }

  const tier = f ? feeTier(Math.max(f.fee0For1, f.fee1For0), FABLES.config.flatPips) : null;
  const nowTs = f?.t ?? c?.quote.blockTimestamp ?? 0;

  return (
    <div className={p.pool} data-qa="pool">
      <PoolHeader
        title="ETH / USDG"
        network="mainnet"
        sub={
          <>
            Uniswap v4 <span className={p.pairSubMuted}>on</span> Robinhood Chain <span className={p.pairSubMuted}>· Fables&apos; pool, read only</span>
          </>
        }
        actions={
          <>
            <ButtonLink href={FABLES.app} variant="primary">
              Open on Fables <ExternalIcon size={14} />
            </ButtonLink>
            <ButtonLink href={fablesAddress(FABLES.hook)}>
              RobinScan <ExternalIcon size={14} />
            </ButtonLink>
          </>
        }
      />

      <div className={p.statRow}>
        <Stat
          label="Current fee"
          tip={f ? feeTooltip(f.fee0For1, f.fee1For0, FABLES.config.flatPips) : "The fee this market charges on every swap right now"}
          value={f ? <FeeValue prefix="fables" chain="mainnet" block={f.blockNumber} fee0For1={f.fee0For1} fee1For0={f.fee1For0} /> : "-"}
          secondary={tier ? <TierBadge badge={tier} title="Fables' keeper has raised the fee above the flat 0.07%" /> : f ? "flat fee" : <Skeleton />}
        />
        <Stat
          label="Price"
          tip="USDG per ETH from the pool's slot0 (Uniswap v4 StateView)"
          value={f ? <LiveValue k="fables:price" chain="mainnet" block={f.blockNumber} raw={f.sqrtPriceX96} text={formatPrice(f.price)} /> : "-"}
          secondary="USDG per ETH"
        />
        <Stat
          label="clim now"
          tip="ClimFeePolicy.quote() on the testnet desk: clim's recommendation for this pool, not applied to it"
          value={c ? <LiveValue k="clim:quote" chain="testnet" block={c.quote.blockNumber} raw={c.quote.fee} text={formatFeePct(c.quote.fee)} /> : "-"}
          secondary={badge ? <TierBadge badge={badge} /> : <Skeleton />}
        />
        <Stat
          label="Desk volatility"
          tip="Annualised 5-minute volatility the desk last reported (RiskDeskV2.state, sigma5)"
          value={c ? <LiveValue k="desk:sigma5" chain="testnet" block={c.quote.blockNumber} raw={c.desk.sigma5E9} text={formatSigmaE9(c.desk.sigma5E9)} /> : "-"}
          secondary="5 min, four venues"
        />
        <Stat
          label="Last report"
          tip="The desk's last observation; blind after tauKillSec without one"
          value={c ? <span>{formatAge(climAge)}</span> : "-"}
          secondary={c ? <span>report <LiveValue k="clim:seq" chain="testnet" block={c.quote.blockNumber} raw={c.quote.seq} text={formatInt(c.quote.seq)} /></span> : <Skeleton />}
        />
      </div>
      {fables.error ? <ReadError error={fables.error} /> : null}
      {clim.error ? <ReadError error={clim.error} /> : null}

      <Section
        id="dynamic-fee"
        title="Dynamic Fee"
        description="This market leverages dynamic fees to optimize rewards for liquidity providers. Fables' keeper sets it on mainnet; clim's testnet desk publishes its own recommendation next to it, read live from both chains."
      >
        <AsideGrid
          rail={
            <FeeRail
              prefix="fables"
              chain="mainnet"
              label={period === "24H" ? "24h" : "7d"}
              current={f ? <FeeValue prefix="fables" chain="mainnet" block={f.blockNumber} fee0For1={f.fee0For1} fee1For0={f.fee1For0} /> : "-"}
              win={win}
              history={pokes.data}
              extra={[
                { label: "clim now", tip: "ClimFeePolicy.quote(), testnet", value: c ? <LiveValue k="clim:quote" chain="testnet" block={c.quote.blockNumber} raw={c.quote.fee} text={formatFeePct(c.quote.fee)} /> : <Skeleton /> },
                {
                  label: "clim buy / sell",
                  tip: "ClimFeePolicy.quoteDirectional(): the premium goes to the side the venue-pool gap makes toxic (measured against pool D on testnet)",
                  value: c ? (
                    <span>
                      <LiveValue k="clim:fee1For0" chain="testnet" block={c.quote.blockNumber} raw={c.quote.fee1For0} text={formatFeePct(c.quote.fee1For0)} /> /{" "}
                      <LiveValue k="clim:fee0For1" chain="testnet" block={c.quote.blockNumber} raw={c.quote.fee0For1} text={formatFeePct(c.quote.fee0For1)} />
                    </span>
                  ) : (
                    <Skeleton />
                  ),
                },
                { label: "Desk mode", tip: "normal, degraded (venues disagree) or blind (no report for tauKillSec)", value: c ? <LiveValue k="clim:mode" chain="testnet" block={c.quote.blockNumber} raw={c.quote.mode} text={modeLabel(c.quote.mode)} /> : <Skeleton /> },
                { label: "Venue gap", tip: "Venue mid minus pool D's mid, as the desk last reported it (devPips)", value: c ? <LiveValue k="desk:dev" chain="testnet" block={c.quote.blockNumber} raw={c.desk.devPips} text={formatGapPips(c.desk.devPips)} /> : <Skeleton /> },
                { label: "Observed at", tip: "The desk's last observation time (tObs)", value: c ? <LiveValue k="clim:tObs" chain="testnet" block={c.quote.blockNumber} raw={c.quote.tObs} text={formatUtcClock(c.quote.tObs)} /> : <Skeleton /> },
              ]}
            />
          }
        >
          <ChartPanel
            top={
              <>
                <span style={{ display: "inline-flex", gap: 12, alignItems: "center" }}>
                  <LiveDot />
                  <FilterToggle
                    label="clim's line"
                    value={view}
                    onChange={setView}
                    options={[
                      { value: "both", label: "Both fees" },
                      { value: "direction", label: "clim per direction" },
                    ]}
                  />
                </span>
                <PeriodButtons options={["24H", "7D"] as const} value={period} onChange={setPeriod} />
              </>
            }
            legend={
              <>
                <span style={{ display: "inline-flex", gap: 12, flexWrap: "wrap" }}>
                  {series.map((x) => (
                    <Swatch key={x.id} color={x.color} label={x.label} />
                  ))}
                </span>
                <span style={{ display: "inline-flex", gap: 8 }}>
                  <NetworkTag network="mainnet" />
                  <NetworkTag network="testnet" />
                </span>
              </>
            }
          >
            <StepChart series={series} from={win?.fromTs ?? 0} to={win?.toTs ?? 1} format={formatFeePct} loading={!win} />
          </ChartPanel>
        </AsideGrid>
        <p className={p.note}>
          clim&apos;s line is a recommendation computed by the testnet desk (ClimFeePolicy); it is not applied to Fables&apos; pool. Its per-direction premium is measured against pool
          D&apos;s mid on testnet. clim&apos;s line covers the last 24 hours (one report every 30 s){period === "7D" ? "; the keeper's covers 7 days" : ""}. clim does not claim lower or
          better fees than the keeper: the lab&apos;s comparison is on the Evidence page.
        </p>
      </Section>

      <Section id="fee-updates" title="Fee updates" description="The keeper's overrides on Fables' pool and clim's reports, newest first. Each links to its transaction.">
        {pokes.data && points.data ? (
          <FeeUpdates rows={feeUpdateRows(pokes.data.items, points.data.items, reports.data?.items ?? [], 12)} nowTs={nowTs} />
        ) : (
          <Skeleton width={300} />
        )}
      </Section>

      <Section id="verify" title="Pool and desk" description="Fables' pool on mainnet and clim's desk on testnet. Every contract is verified; follow the links.">
        <ParamsCard
          rows={[
            { label: "Pool ID", value: <AddressLink href={fablesAddress(FABLES.poolManager)}>{shortAddress(FABLES.poolId)}</AddressLink>, copy: FABLES.poolId },
            { label: "PoolManager", value: <AddressLink href={fablesAddress(FABLES.poolManager)}>{shortAddress(FABLES.poolManager)}</AddressLink>, copy: FABLES.poolManager },
            { label: "Fee model", value: "Dynamic" },
            { label: "Tick spacing", value: String(FABLES.key.tickSpacing) },
            { label: "Hook (Fables)", tip: `${FABLES.hookContract}, verified on Sourcify`, value: <AddressLink href={FABLES.sourcify}>{shortAddress(FABLES.hook)}</AddressLink>, copy: FABLES.hook },
            { label: "Flat, floor, cap", value: `${formatFeePct(FABLES.config.flatPips)}, ${formatFeePct(FABLES.config.floorPips)}, ${formatFeePct(FABLES.config.capPips)}` },
            { label: "Keeper (Fables)", value: <AddressLink href={fablesAddress(FABLES.keeper)}>{shortAddress(FABLES.keeper)}</AddressLink>, copy: FABLES.keeper },
            { label: "AccessManager (Fables)", value: <AddressLink href={fablesAddress(FABLES.accessManager)}>{shortAddress(FABLES.accessManager)}</AddressLink>, copy: FABLES.accessManager },
            { label: "Risk desk (clim)", tip: "RiskDeskV2 on testnet, Blockscout and Sourcify", value: <AddressLink href={testnetCode(LIVE.riskDesk)}>{shortAddress(LIVE.riskDesk)}</AddressLink>, copy: LIVE.riskDesk },
            { label: "Fee policy (clim)", value: <AddressLink href={sourcifyTestnet(LIVE.policy)}>{shortAddress(LIVE.policy)}</AddressLink>, copy: LIVE.policy },
            { label: "Poker (clim)", value: <AddressLink href={testnetCode(LIVE.poker)}>{shortAddress(LIVE.poker)}</AddressLink>, copy: LIVE.poker },
            { label: "Integration", value: <Link href="/integrate">Levels 0, 1, 2</Link> },
          ]}
        />
      </Section>

      <Section id="transactions" title="Recent transactions" description="Swaps against this market in the last 10 minutes, newest first, read from the PoolManager's Swap logs.">
        <RecentSwaps history={swaps.data} client={mainnetClient} txUrl={fablesTx} />
      </Section>
    </div>
  );
}

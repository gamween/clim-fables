"use client";
// clim's reference pools on Robinhood Chain testnet (spec §5.7): D driven by ClimPoker from the live desk, K by a
// keeper-style bot, F flat. Same page as Fables' pool, labelled testnet throughout; test tokens, no value at stake.
import type { LivePoolName } from "@clim/shared";
import { StepChart, type Series } from "@/components/charts/StepChart";
import { AddressLink, AsideGrid, ButtonLink, ChartPanel, LiveDot, LiveValue, NetworkTag, ReadError, Section, Skeleton, Stat, Swatch, TierBadge } from "@/components/ui/kit";
import { ExternalIcon } from "@/components/ui/icons";
import { useClimNow, usePoolPokes, usePoolSwaps } from "@/hooks/live";
import { testnetClient } from "@/lib/chain/clients";
import { LIVE, sourcifyTestnet, testnetAddress, testnetCode, testnetTx } from "@/lib/chain/deployments";
import { formatAvgFeePct, formatFeePct, formatInt, formatPrice, shortAddress } from "@/lib/format";
import { FEE_SOURCE, feeTier, feeTooltip } from "@/lib/tiers";
import { feeWindow, swapWindow } from "@/lib/windowStats";
import p from "../pages.module.css";
import { OutagesTable } from "./Outages";
import { FeeRail, FeeValue, ParamsCard, PoolHeader } from "./parts";
import { RecentSwaps } from "./RecentSwaps";

const DAY = 86_400;

export function TestnetPool({ name }: { name: LivePoolName }) {
  const pool = LIVE.pools[name];
  const clim = useClimNow();
  const pokes = usePoolPokes(name, DAY);
  const swaps = usePoolSwaps(name, DAY);
  const c = clim.data;
  const now = c?.pools[name];
  const block = c?.quote.blockNumber ?? 0n;
  const win = pokes.data ? feeWindow(pokes.data.items, LIVE.hookConfig, pokes.data.toTs, DAY) : null;
  const sw = swaps.data ? swapWindow(swaps.data.items) : null;
  const directional = win ? win.steps.some((s) => s.fee0For1 !== s.fee1For0) : false;
  const series: Series[] = win
    ? directional
      ? [
          { id: "buy", label: "Buy ETH", color: "var(--positive)", points: win.steps.map((s) => ({ t: s.t, v: s.fee1For0 })) },
          { id: "sell", label: "Sell ETH", color: "var(--negative)", points: win.steps.map((s) => ({ t: s.t, v: s.fee0For1 })) },
        ]
      : [{ id: "fee", label: "Fee", color: "var(--brand)", area: true, points: win.steps.map((s) => ({ t: s.t, v: s.fee0For1 })) }]
    : [];
  const source = FEE_SOURCE[name];
  const tier = now ? feeTier(Math.max(now.fee0For1, now.fee1For0), LIVE.hookConfig.flatPips) : null;
  const swapRange = sw && swaps.data ? { fromBlock: swaps.data.fromBlock, toBlock: swaps.data.toBlock, fromTs: swaps.data.toTs - DAY, toTs: swaps.data.toTs } : undefined;

  return (
    <div className={p.pool} data-qa="pool">
      <PoolHeader
        title={`tETH / tUSDG · Pool ${name}`}
        network="testnet"
        sub={
          <>
            Uniswap v4 <span className={p.pairSubMuted}>on</span> Robinhood Chain testnet <span className={p.pairSubMuted}>· {pool.driver}</span>
          </>
        }
        actions={
          <ButtonLink href={testnetCode(LIVE.hook)}>
            Blockscout <ExternalIcon size={14} />
          </ButtonLink>
        }
      />

      <div className={p.statRow}>
        <Stat
          label="Current fee"
          tip={now ? feeTooltip(now.fee0For1, now.fee1For0, LIVE.hookConfig.flatPips) : "The fee this market charges on every swap right now"}
          value={now ? <FeeValue prefix={`pool:${name}`} chain="testnet" block={block} fee0For1={now.fee0For1} fee1For0={now.fee1For0} /> : "-"}
          secondary={tier ? <TierBadge badge={tier} /> : now ? "flat fee" : <Skeleton />}
        />
        <Stat label="Price" tip="tUSDG per tETH from slot0" value={now ? <LiveValue k={`pool:${name}:price`} chain="testnet" block={block} raw={now.sqrtPriceX96} text={formatPrice(now.price)} /> : "-"} secondary="tUSDG per tETH" />
        <Stat label="Fee source" tip={source.note} value={<TierBadge badge={source} />} secondary={name === "D" ? "ClimPoker" : name === "K" ? "keeper-style bot" : "no override"} />
        <Stat
          label="Swaps (24h)"
          tip="Arbitrage and retail bots trade every pool against real venue prices"
          value={sw && swaps.data && swapRange ? <LiveValue k={`pool:${name}:swaps`} chain="testnet" block={swaps.data.toBlock} raw={sw.count} text={formatInt(sw.count)} range={swapRange} /> : "-"}
          secondary="arbitrage and retail"
        />
        <Stat
          label="Mean fee paid (24h)"
          tip="The average Swap.fee of the swaps in the last 24 hours"
          value={sw && swaps.data && swapRange && sw.meanFeePips !== null ? <LiveValue k={`pool:${name}:meanSwapFee`} chain="testnet" block={swaps.data.toBlock} raw={sw.meanFeePips} text={formatAvgFeePct(sw.meanFeePips)} range={swapRange} /> : "-"}
          secondary="per swap"
        />
      </div>
      {clim.error ? <ReadError error={clim.error} /> : null}

      <Section id="dynamic-fee" title="Dynamic Fee" description={`${source.label}: ${source.note}. The fee in force over the last 24 hours, rebuilt with the hook's own rule from ${name === "D" ? "ClimPoker's Poked logs, each at its report's observation time" : "the hook's FeePoked logs, each at its block's time"}.`}>
        <AsideGrid
          rail={
            <FeeRail
              prefix={`pool:${name}`}
              chain="testnet"
              label="24h"
              current={now ? <FeeValue prefix={`pool:${name}`} chain="testnet" block={block} fee0For1={now.fee0For1} fee1For0={now.fee1For0} /> : "-"}
              win={win}
              history={pokes.data}
            />
          }
        >
          <ChartPanel
            top={
              <>
                <LiveDot />
                <span style={{ color: "var(--ink-secondary)", fontSize: 12 }}>24H</span>
              </>
            }
            legend={
              <>
                <span style={{ display: "inline-flex", gap: 12 }}>
                  {series.map((x) => (
                    <Swatch key={x.id} color={x.color} label={x.label} />
                  ))}
                </span>
                <NetworkTag network="testnet" />
              </>
            }
          >
            <StepChart series={series} from={win?.fromTs ?? 0} to={win?.toTs ?? 1} format={formatFeePct} loading={!win} />
          </ChartPanel>
        </AsideGrid>
      </Section>

      {name === "D" ? (
        <Section id="outages" title="Desk outages" description="Windows in which clim's desk sent no report, measured on chain. The live stack runs on the maintainer's Mac; every silence is published as measured.">
          <OutagesTable />
        </Section>
      ) : null}

      <Section id="pool" title="Pool">
        <ParamsCard
          rows={[
            { label: "Pool ID", value: <AddressLink href={testnetAddress(LIVE.uniswap.poolManager)}>{shortAddress(pool.poolId)}</AddressLink>, copy: pool.poolId },
            { label: "Hook (clim's PokeFeeHook)", value: <AddressLink href={sourcifyTestnet(LIVE.hook)}>{shortAddress(LIVE.hook)}</AddressLink>, copy: LIVE.hook },
            { label: "Tick spacing", value: String(pool.key.tickSpacing) },
            { label: "Flat, floor, cap", value: `${formatFeePct(LIVE.hookConfig.flatPips)}, ${formatFeePct(LIVE.hookConfig.floorPips)}, ${formatFeePct(LIVE.hookConfig.capPips)}` },
            { label: "tETH", value: <AddressLink href={testnetAddress(LIVE.tokens.tETH.address)}>{shortAddress(LIVE.tokens.tETH.address)}</AddressLink>, copy: LIVE.tokens.tETH.address },
            { label: "tUSDG", value: <AddressLink href={testnetAddress(LIVE.tokens.tUSDG.address)}>{shortAddress(LIVE.tokens.tUSDG.address)}</AddressLink>, copy: LIVE.tokens.tUSDG.address },
          ]}
        />
      </Section>

      <Section id="transactions" title="Recent transactions" description="Swaps against this pool in the last 24 hours, newest first.">
        <RecentSwaps history={swaps.data} client={testnetClient} txUrl={testnetTx} />
      </Section>
    </div>
  );
}

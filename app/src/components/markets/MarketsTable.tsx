"use client";
// Fables' markets table with a "Fee source" column. TVL, volume and APR come from Fables' own indexer and are not
// readable per pool from the chain, so the showcase shows what the chain gives: the price, the fee a swap pays now and
// who sets it.
import Link from "next/link";
import { useState } from "react";
import { FilterToggle } from "@/components/ui/FilterToggle";
import { AssetBadge, InfoTip, LiveValue, NetworkTag, PairLogo, ReadError, Skeleton, TierBadge } from "@/components/ui/kit";
import { ChevronRightIcon } from "@/components/ui/icons";
import { FeeValue } from "@/components/pool/parts";
import { useClimNow, useFablesNow } from "@/hooks/live";
import { formatPrice } from "@/lib/format";
import { FEE_SOURCE, feeTier, type FeeSource } from "@/lib/tiers";
import { FABLES } from "@/lib/chain/fables";
import { LIVE } from "@/lib/chain/deployments";
import p from "../pages.module.css";

type Filter = "all" | "mainnet" | "testnet";
type Row = { key: FeeSource; href: string; name: string; network: "mainnet" | "testnet"; asset: [string, string] };

export const MARKET_ROWS: Row[] = [
  { key: "fables", href: "/markets/eth", name: "ETH/USDG", network: "mainnet", asset: ["Ethereum", "Crypto"] },
  { key: "D", href: "/markets/d", name: "tETH/tUSDG · D", network: "testnet", asset: ["Test ETH", "clim"] },
  { key: "K", href: "/markets/k", name: "tETH/tUSDG · K", network: "testnet", asset: ["Test ETH", "Keeper-style"] },
  { key: "F", href: "/markets/f", name: "tETH/tUSDG · F", network: "testnet", asset: ["Test ETH", "Flat"] },
];

export function MarketsTable({ filterable = false, limit }: { filterable?: boolean; limit?: number }) {
  const [filter, setFilter] = useState<Filter>("all");
  const fables = useFablesNow();
  const clim = useClimNow();
  const rows = MARKET_ROWS.filter((r) => filter === "all" || r.network === filter).slice(0, limit);

  const cells = (r: Row) => {
    if (r.key === "fables") {
      const f = fables.data;
      return {
        price: f ? <LiveValue k="fables:price" chain="mainnet" block={f.blockNumber} raw={f.sqrtPriceX96} text={formatPrice(f.price)} /> : <Skeleton />,
        fee: f ? <FeeValue prefix="fables" chain="mainnet" block={f.blockNumber} fee0For1={f.fee0For1} fee1For0={f.fee1For0} /> : <Skeleton />,
        tier: f ? feeTier(Math.max(f.fee0For1, f.fee1For0), FABLES.config.flatPips) : null,
      };
    }
    const c = clim.data;
    const pool = c?.pools[r.key];
    return {
      price: c && pool ? <LiveValue k={`pool:${r.key}:price`} chain="testnet" block={c.quote.blockNumber} raw={pool.sqrtPriceX96} text={formatPrice(pool.price)} /> : <Skeleton />,
      fee: c && pool ? <FeeValue prefix={`pool:${r.key}`} chain="testnet" block={c.quote.blockNumber} fee0For1={pool.fee0For1} fee1For0={pool.fee1For0} /> : <Skeleton />,
      tier: pool ? feeTier(Math.max(pool.fee0For1, pool.fee1For0), LIVE.hookConfig.flatPips) : null,
    };
  };

  return (
    <>
      {filterable ? (
        <div className={p.filterBar}>
          <FilterToggle
            label="Network"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All networks" },
              { value: "mainnet", label: "Mainnet" },
              { value: "testnet", label: "Testnet" },
            ]}
          />
        </div>
      ) : null}
      <div className={p.tableWrap}>
        <table className={`${p.table} ${p.tall}`} data-qa="markets-table">
          <thead>
            <tr>
              <th>Market</th>
              <th className={p.num}>Price</th>
              <th className={p.num}>Current fee</th>
              <th>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  Fee source <InfoTip text="Who sets each pool's fee: Fables' keeper on mainnet; on testnet, clim (pool D), a keeper-style bot (K) or nobody (F, flat)" />
                </span>
              </th>
              <th>Network</th>
              <th aria-label="Open" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const c = cells(r);
              const src = FEE_SOURCE[r.key];
              return (
                <tr key={r.key} data-market={r.key}>
                  <td>
                    <Link href={r.href} className={p.marketCell}>
                      <PairLogo size={40} test={r.network === "testnet"} />
                      <span>
                        <span className={p.marketName}>{r.name}</span>
                        <AssetBadge name={r.asset[0]} kind={r.asset[1]} test={r.network === "testnet"} />
                      </span>
                    </Link>
                  </td>
                  <td className={p.num}>{c.price}</td>
                  <td className={p.num}>
                    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
                      {c.fee}
                      {c.tier ? <TierBadge badge={c.tier} /> : null}
                    </span>
                  </td>
                  <td>
                    <TierBadge badge={src} title={src.note} />
                  </td>
                  <td>
                    <NetworkTag network={r.network} />
                  </td>
                  <td className={p.num}>
                    <Link href={r.href} className={p.chevron} aria-label={`Open ${r.name}`}>
                      <ChevronRightIcon />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {fables.error ? <ReadError error={fables.error} /> : null}
      {clim.error ? <ReadError error={clim.error} /> : null}
    </>
  );
}

"use client";
import { InfoTip, LiveValue, Skeleton } from "@/components/ui/kit";
import { useClimNow, useFablesPokes } from "@/hooks/live";
import { formatInt } from "@/lib/format";
import { feeWindow } from "@/lib/windowStats";
import { FABLES } from "@/lib/chain/fables";
import p from "../pages.module.css";
import u from "../ui/ui.module.css";

/** Fables' header stats slot ("Daily Fees", "Lifetime Fees"), holding what the chain gives: the keeper's overrides in
 *  24 hours and the desk's report counter. */
export function MarketsHeadStats() {
  const pokes = useFablesPokes(86_400);
  const clim = useClimNow();
  const win = pokes.data ? feeWindow(pokes.data.items, FABLES.config, pokes.data.toTs, 86_400) : null;
  return (
    <dl className={p.headStats} style={{ margin: 0 }}>
      <div>
        <dt className={u.statLabel}>
          Keeper overrides (24h) <InfoTip text="FeePoked logs of Fables' ETH/USDG hook over the last 24 hours (mainnet)" />
        </dt>
        <dd className={`${u.statValue} ${p.headValue}`} style={{ margin: "4px 0 0" }}>
          {win && pokes.data ? (
            <LiveValue k="fables:changes" chain="mainnet" block={pokes.data.toBlock} raw={win.changes} text={formatInt(win.changes)} range={{ fromBlock: pokes.data.fromBlock, toBlock: pokes.data.toBlock, fromTs: win.fromTs, toTs: win.toTs }} />
          ) : (
            <Skeleton />
          )}
        </dd>
      </div>
      <div>
        <dt className={u.statLabel}>
          clim desk reports <InfoTip text="The desk's report counter (seq) since it was deployed on testnet" />
        </dt>
        <dd className={`${u.statValue} ${p.headValue}`} style={{ margin: "4px 0 0" }}>
          {clim.data ? <LiveValue k="clim:seq" chain="testnet" block={clim.data.quote.blockNumber} raw={clim.data.quote.seq} text={formatInt(clim.data.quote.seq)} /> : <Skeleton />}
        </dd>
      </div>
    </dl>
  );
}

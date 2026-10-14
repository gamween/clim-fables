"use client";
// Level 1, live: the published composeFee (docs/integrate/keeper-read.ts, vendored) applied to Fables' fee now and
// clim's quote now. A display of what the keeper diff would post, never a transaction.
import { LiveValue, NetworkTag, Skeleton } from "@/components/ui/kit";
import { useClimNow, useFablesNow, useLevel2Roles } from "@/hooks/live";
import { formatFeePct } from "@/lib/format";
import { composeFee } from "@/vendor/integrate/keeper-read";
import { Table } from "@/components/docs/Docs";

export function LiveCompose() {
  const f = useFablesNow().data;
  const c = useClimNow().data;
  if (!f || !c) return <Skeleton width={240} />;
  const composed = composeFee(f.fee0For1, c.quote);
  return (
    <Table
      header={["Input", "Read from", "Fee"]}
      rows={[
        ["Fables' keeper fee now (currentFee)", <NetworkTag key="m" network="mainnet" />, <LiveValue key="v" k="fables:fee0For1" chain="mainnet" block={f.blockNumber} raw={f.fee0For1} text={formatFeePct(f.fee0For1)} />],
        ["clim's quote() now", <NetworkTag key="t" network="testnet" />, <LiveValue key="v" k="clim:quote" chain="testnet" block={c.quote.blockNumber} raw={c.quote.fee} text={formatFeePct(c.quote.fee)} />],
        [
          <strong key="l">composeFee(keeper, clim)</strong>,
          composed.climUsed ? "clim is fresh, so it counts" : "clim is blind or stale: the keeper's fee alone",
          <strong key="v">
            {formatFeePct(composed.fee)} ({composed.source === "clim" ? "clim's" : "the keeper's"})
          </strong>,
        ],
      ]}
    />
  );
}

export function LiveRoles() {
  const r = useLevel2Roles().data;
  if (!r) return <Skeleton width={240} />;
  const yes = (v: boolean) => (v ? "yes" : "no");
  return (
    <Table
      header={["Role on clim's testnet AccessManager", "Held"]}
      rows={[
        ["FEE_POKER (1) by ClimPoker", <LiveValue key="a" k="roles:poker" chain="testnet" block={r.blockNumber} raw={r.pokerHasFeePoker} text={yes(r.pokerHasFeePoker)} />],
        ["CLIM_RUNNER (7) by clim's runner", <LiveValue key="b" k="roles:runner" chain="testnet" block={r.blockNumber} raw={r.runnerHasClimRunner} text={yes(r.runnerHasClimRunner)} />],
      ]}
    />
  );
}

import type { Metadata } from "next";
import { MarketsHeadStats } from "@/components/markets/MarketsHeadStats";
import { MarketsTable } from "@/components/markets/MarketsTable";
import { Card } from "@/components/ui/kit";
import p from "@/components/pages.module.css";

export const metadata: Metadata = { title: "Markets" };

export default function MarketsPage() {
  return (
    <div className={p.stack} data-qa="page">
      <div className={p.pageHead}>
        <div>
          <h1 className={p.pageTitle} data-qa="page-title">
            Markets
          </h1>
          <p className={p.pageDesc}>Fables&apos; ETH/USDG pool, read live from Robinhood Chain mainnet, next to clim&apos;s three reference pools on testnet.</p>
        </div>
        <MarketsHeadStats />
      </div>
      <Card>
        <MarketsTable filterable />
      </Card>
    </div>
  );
}

import { MarketsHeadStats } from "@/components/markets/MarketsHeadStats";
import { MarketsSummary } from "@/components/markets/MarketsSummary";
import { MarketsTable } from "@/components/markets/MarketsTable";
import { Card } from "@/components/ui/kit";
import p from "@/components/pages.module.css";

export default function MarketsPage() {
  return (
    <div className={`${p.stack} ${p.marketsPage}`} data-qa="page">
      <div className={p.pageHead}>
        <div>
          <h1 className={p.pageTitle} data-qa="page-title">
            Markets
          </h1>
          <p className={p.pageDesc}>Fables&apos; ETH/USDG pool, read live from Robinhood Chain mainnet, next to clim&apos;s three reference pools on testnet.</p>
        </div>
        <MarketsHeadStats />
      </div>
      <MarketsSummary />
      <Card>
        <MarketsTable filterable />
      </Card>
    </div>
  );
}

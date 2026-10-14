"use client";
// Fables' landing (inventory §2.1) with clim's thesis in the hero and the live number under it: the keeper's fee on
// Fables' pool now against clim's recommendation now.
import Link from "next/link";
import { MarketsTable } from "@/components/markets/MarketsTable";
import { ButtonLink, Card, LiveDot, LiveValue, NetworkTag, Skeleton, TierBadge } from "@/components/ui/kit";
import { ArrowRightIcon, ExternalIcon } from "@/components/ui/icons";
import { useClimNow, useFablesNow } from "@/hooks/live";
import { FABLES } from "@/lib/chain/fables";
import { formatFeePct, formatInt } from "@/lib/format";
import { repoFile } from "@/lib/site";
import { deskBadge, MODE_NUMBER } from "@/lib/tiers";
import s from "./landing.module.css";

/** The effective floor of an override on Fables' pool: max(floor, flat x 50 %). */
const EFFECTIVE_FLOOR = Math.max(FABLES.config.floorPips, FABLES.config.flatPips / 2);

function bandPos(pips: number) {
  const lo = EFFECTIVE_FLOOR;
  const hi = FABLES.config.capPips;
  return `${Math.min(100, Math.max(0, ((pips - lo) / (hi - lo)) * 100))}%`;
}

export function Landing() {
  const f = useFablesNow().data;
  const c = useClimNow().data;
  const age = c ? c.quote.blockTimestamp - c.quote.tObs : null;
  return (
    <>
      <section className={s.hero} data-qa="hero">
        <div className={s.heroArt} aria-hidden />
        <div className={s.heroInner}>
          <span className={s.eyebrow}>
            <LiveDot green label="" />
            Live on Robinhood
          </span>
          <h1 className={s.headline} data-qa="headline">
            Fables&apos; keeper sets the fee.
            <br />
            <span className={s.turn}>clim checks it in public.</span>
          </h1>
          <div className={s.pills} aria-label="The fee now">
            <span className={s.pill}>
              <span className={`${s.pillFace} ${s.pillLit}`}>{f ? <LiveValue k="fables:fee0For1" chain="mainnet" block={f.blockNumber} raw={f.fee0For1} text={formatFeePct(f.fee0For1)} /> : <Skeleton />}</span>
              <span className={s.pillLabel}>Fables keeper, now</span>
              <NetworkTag network="mainnet" />
            </span>
            <span className={s.pill}>
              <span className={`${s.pillFace} ${s.pillWhite}`}>{c ? <LiveValue k="clim:quote" chain="testnet" block={c.quote.blockNumber} raw={c.quote.fee} text={formatFeePct(c.quote.fee)} /> : <Skeleton />}</span>
              <span className={s.pillLabel}>clim&apos;s recommendation, now</span>
              <NetworkTag network="testnet" />
            </span>
          </div>
          <p className={s.subline}>
            A Chainlink CRE desk reads ETH on four exchanges every 30 s and publishes a fee anyone can recompute, next to the fee Fables&apos; keeper sets on ETH/USDG. A showcase, read only.{" "}
            <a href={repoFile("docs/integrate/README.md")} target="_blank" rel="noreferrer">
              Read the integration guide <ExternalIcon size={14} />
            </a>
          </p>
        </div>
      </section>

      <div className={s.grid}>
        <div className={s.feature}>
          <div className={s.plate}>
            <span className={s.tag}>Two fees</span>
            <div className={s.pills}>
              <span className={s.pillFace}>{formatFeePct(FABLES.config.flatPips)}</span>
              <span className={`${s.pillFace} ${s.pillLit}`}>{f ? <LiveValue k="fables:fee0For1" chain="mainnet" block={f.blockNumber} raw={f.fee0For1} text={formatFeePct(f.fee0For1)} /> : <Skeleton />}</span>
              <span className={`${s.pillFace} ${s.pillWhite}`}>{c ? <LiveValue k="clim:quote" chain="testnet" block={c.quote.blockNumber} raw={c.quote.fee} text={formatFeePct(c.quote.fee)} /> : <Skeleton />}</span>
            </div>
          </div>
          <div className={s.featureText}>
            <span className={s.featureTitle}>Two fees, one chart</span>
            <span className={s.featureDesc}>The flat fee, Fables&apos; live override and clim&apos;s recommendation, each read from the chain.</span>
          </div>
        </div>
        <div className={s.feature}>
          <div className={s.plate}>
            <span className={s.tag}>Desk</span>
            <div className={s.deskTicker}>
              <span className={s.deskSeq}>{c ? <LiveValue k="clim:seq" chain="testnet" block={c.quote.blockNumber} raw={c.quote.seq} text={formatInt(c.quote.seq)} /> : <Skeleton />}</span>
              <span className={s.pillLabel}>reports so far</span>
              {c && age !== null ? <TierBadge badge={deskBadge(MODE_NUMBER[c.quote.mode], age, c.quote.tauKillSec)} /> : null}
            </div>
          </div>
          <div className={s.featureText}>
            <span className={s.featureTitle}>Verifiable by anyone</span>
            <span className={s.featureDesc}>Four venues, one report every 30 s, a fee formula anyone can recompute from the chain.</span>
          </div>
        </div>
        <div className={s.feature}>
          <div className={s.plate} style={{ flexDirection: "column" }}>
            <span className={s.tag}>Bounds</span>
            <div className={s.band}>
              {f ? <span className={s.bandMark} style={{ left: bandPos(f.fee0For1), background: "var(--brand)" }} title="Fables keeper" /> : null}
              {c ? <span className={s.bandMark} style={{ left: bandPos(c.quote.fee), background: "var(--ink)" }} title="clim" /> : null}
            </div>
            <div className={s.bandLabels}>
              <span>{formatFeePct(EFFECTIVE_FLOOR)}</span>
              <span>{formatFeePct(FABLES.config.capPips)}</span>
            </div>
          </div>
          <div className={s.featureText}>
            <span className={s.featureTitle}>Inside your bounds</span>
            <span className={s.featureDesc}>Your hook&apos;s floor, cap and TTL; only roles you grant; revoked in one call.</span>
          </div>
        </div>
      </div>

      <div className={s.featured}>
        <span className={s.unicorn} aria-hidden />
        <Card>
          <div className={s.featuredHead}>
            <h2 className={s.featuredTitle}>Featured markets</h2>
            <Link href="/markets" className={s.viewAll}>
              <span className={s.viewAllInner}>
                View all markets <ArrowRightIcon size={14} />
              </span>
            </Link>
          </div>
          <MarketsTable />
          <div className={s.foot}>
            <div className={s.footLeft}>
              <span className={s.footMark} aria-hidden>
                c
              </span>
              <div>
                <div className={s.footTitle}>Verified by clim</div>
                <div className={s.footSub}>Every number here is read from the chain or quoted from a committed evidence file</div>
              </div>
            </div>
            <ButtonLink href="/evidence" variant="cta">
              See the evidence
            </ButtonLink>
          </div>
        </Card>
      </div>
    </>
  );
}

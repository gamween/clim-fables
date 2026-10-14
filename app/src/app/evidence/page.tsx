import Link from "next/link";
import { Callout, Caption, DocsLayout, docsStyles as s, MdTable, Rule, Table } from "@/components/docs/Docs";
import { ForkRunChart } from "@/components/evidence/ForkRunChart";
import { OutagesTable } from "@/components/pool/Outages";
import forkRun from "@/generated/fork-run-2026-10-07.json";
import gas from "@/generated/gas-robinhood-testnet.json";
import labFraming from "@/generated/lab-framing.json";
import liveCheck from "@/generated/live-check.json";
import security from "@/generated/security.json";
import { formatFeePct, formatInt } from "@/lib/format";
import { inlineMd } from "@/lib/inlineMd";
import { repoFile } from "@/lib/site";

const GAS_ROWS = [
  ["Desk report (CRE simulator, through the mock forwarder)", gas.deskReport],
  ["ClimPoker.poke() on pool D", gas.poke],
  ["Keeper-style pokeFee on pool K", gas.keeperPoke],
  ["Arbitrage swap", gas.arbSwap],
  ["Retail swap", gas.retailSwap],
] as const;

export default function EvidencePage() {
  const checks = Object.entries(liveCheck.data.checks);
  return (
    <DocsLayout current="/evidence">
      <h1>Evidence</h1>
      <p className={s.lead}>
        Every number on this page is quoted from a committed file in the repository, named next to it; the live numbers elsewhere in the showcase are read from the chain. Results are published as
        measured, including where Fables&apos; keeper does better.
      </p>
      <Rule />

      <h2 id="results">Results, as measured</h2>
      <p>Lab studies on Fables&apos; ETH/USDG pool, 2026-09-07 to 2026-10-12, quoted verbatim from the framing field of each output:</p>
      {labFraming.map((f) => (
        <div key={f.file}>
          <h3>{f.title}</h3>
          <blockquote className={s.quote}>{f.framing}</blockquote>
          <Caption>
            <a href={repoFile(f.file)}>{f.file}</a>
          </Caption>
        </div>
      ))}
      <Callout>clim does not claim lower or better fees than Fables&apos; keeper. The case is verifiability, redundancy and the per-direction signal.</Callout>

      <h2 id="fork-run">The fork run, 7 October 2026</h2>
      <p>
        The storm of 7 October replayed on a fork of Robinhood Chain mainnet (block {formatInt(forkRun.forkBlock)}) against Fables&apos; real ETH/USDG hook: {forkRun.pokedPips.length} pokes from{" "}
        {formatFeePct(Math.min(...forkRun.pokedPips))} to {formatFeePct(Math.max(...forkRun.pokedPips))}, {forkRun.swapFeePips.length} swaps, {forkRun.swapReverts} reverted. Fables&apos; own keeper fee over the same
        window is rebuilt from its mainnet logs.
      </p>
      <ForkRunChart />
      <Caption>
        <a href={repoFile("docs/evidence/fork-run-2026-10-07.json")}>docs/evidence/fork-run-2026-10-07.json</a> and <a href={repoFile("lab/out/fables-storm-2026-10-07.json")}>lab/out/fables-storm-2026-10-07.json</a>.{" "}
        <Link href="/run">Replay it</Link>.
      </Caption>

      <h2 id="gas">Gas and cadence</h2>
      <Table
        header={["Transaction", "Receipts", "Gas, median", "Gas, p90"]}
        rows={GAS_ROWS.map(([label, g]) => [label, formatInt(g.n), formatInt(g.gasUsedMedian), formatInt(g.gasUsedP90)])}
      />
      <p>
        Cadence over blocks {formatInt(gas.cadence.fromBlock)} to {formatInt(gas.cadence.toBlock)}: {formatInt(gas.cadence.deskReport.n)} desk reports, a median gap of {gas.cadence.deskReport.medianGapSec} s (p90{" "}
        {gas.cadence.deskReport.p90GapSec} s), {formatInt(gas.cadence.deskReport.perDay)} reports a day; {formatInt(gas.cadence.poke.perDay)} pokes a day.
      </p>
      <Caption>
        <a href={repoFile("docs/evidence/gas-robinhood-testnet.json")}>docs/evidence/gas-robinhood-testnet.json</a> (chain {gas.chainId}, generated {gas.generatedAt}). The cost section of the integration guide is generated
        from it.
      </Caption>

      <h2 id="live-loop">The live loop</h2>
      <Table
        header={["Check", "Result"]}
        rows={checks.map(([name, c]) => [name, <span key="r" className={c.pass ? s.pass : s.fail}>{c.pass ? "PASS" : "FAIL"}</span>])}
      />
      <Caption>
        <a href={repoFile(liveCheck.file)}>{liveCheck.file}</a>, blocks {formatInt(Number(liveCheck.data.fromBlock))} to {formatInt(Number(liveCheck.data.toBlock))} (<code>cd bots && bun run live:verify</code>).
      </Caption>

      <h2 id="outages">Desk outages</h2>
      <OutagesTable />

      <h2 id="security">Failure modes and the fee that results</h2>
      <p>{inlineMd(security.intro, "docs")}</p>
      <MdTable table={security.failureModes} docDir="docs" />
      <Caption>
        From <a href={repoFile("docs/security.md")}>docs/security.md</a> §7, which also covers who controls what, the desk&apos;s guards and the CRE path.
      </Caption>
    </DocsLayout>
  );
}

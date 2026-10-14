// The showcase guardrails (CLAUDE.md, spec §5.5), checked without a browser: no wallet library, no code that signs or
// sends, the banner and the nav identity. e2e/guardrails.spec.ts checks the same on every built route.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Banner } from "@/components/shell/Banner";
import { Brand, NoWalletPill } from "@/components/shell/Header";
import { BANNER_TEXT, NO_WALLET_TEXT, ROUTES } from "@/lib/site";
import { RPC_URLS } from "@/lib/rpc";

const APP = join(__dirname, "..");

/** Wallet and signing libraries the app must never depend on. */
const FORBIDDEN_PACKAGES = [/^wagmi$/, /^@wagmi\//, /^@rainbow-me\//, /^@metamask\//, /^@walletconnect\//, /^@reown\//, /^@coinbase\/wallet-sdk$/, /^ethers$/, /^web3$/, /^@web3-onboard\//, /^@privy-io\//, /^@dynamic-labs\//, /^connectkit$/, /^@safe-global\//];

/** Calls that sign, send or ask a wallet for accounts. */
const FORBIDDEN_CODE = /createWalletClient|walletActions|sendTransaction|sendRawTransaction|writeContract|signMessage|signTypedData|signTransaction|privateKeyToAccount|mnemonicToAccount|eth_requestAccounts|eth_sendTransaction|personal_sign|window\.ethereum|wallet_[a-zA-Z]/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx|mjs|js)$/.test(n) && !/\.test\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

describe("no wallet, no transaction", () => {
  it("depends on no wallet or signing library", () => {
    const pkg = JSON.parse(readFileSync(join(APP, "package.json"), "utf8"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d) => FORBIDDEN_PACKAGES.some((r) => r.test(d)))).toEqual([]);
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["next", "react", "react-dom", "react-markdown", "remark-gfm", "viem"]);
  });
  it("has no code path that signs or sends, vendored code included", () => {
    const hits = sourceFiles(join(APP, "src")).filter((f) => FORBIDDEN_CODE.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
  it("talks to the public Robinhood Chain RPCs only", () => {
    for (const u of [...RPC_URLS.mainnet, ...RPC_URLS.testnet]) expect(new URL(u).protocol).toBe("https:");
    expect(RPC_URLS.mainnet).toContain("https://rpc.mainnet.chain.robinhood.com");
    expect(RPC_URLS.testnet).toContain("https://rpc.testnet.chain.robinhood.com");
  });
});

describe("wording", () => {
  const texts = () => [...sourceFiles(join(APP, "src")).filter((f) => !f.includes("/vendor/") && !f.includes("/generated/")), join(APP, "THIRD_PARTY_NOTICES.md")].map((f) => [f, readFileSync(f, "utf8")] as const);
  it("never claims better fees, only disclaims them", () => {
    for (const [file, text] of texts()) {
      for (const m of text.matchAll(/better fees?/gi)) {
        const before = text.slice(Math.max(0, m.index - 40), m.index).toLowerCase();
        expect({ file, disclaimed: /\b(not|no|nothing|never)\b/.test(before) }).toEqual({ file, disclaimed: true });
      }
    }
  });
  it("has no em dash", () => {
    for (const [file, text] of texts()) expect({ file, emDash: text.includes("\u2014") }).toEqual({ file, emDash: false });
  });
});

describe("identity", () => {
  it("renders the permanent banner with no way to dismiss it", () => {
    const html = renderToStaticMarkup(<Banner />);
    expect(html).toContain(BANNER_TEXT);
    expect(html).toContain('data-guard="banner"');
    expect(html).not.toMatch(/<button/);
  });
  it("names the site clim × Fables next to Fables' mark", () => {
    const html = renderToStaticMarkup(<Brand />);
    expect(html.replace(/<[^>]+>/g, "")).toBe("clim×Fables");
    expect(html).toContain('aria-label="clim × Fables, home"');
  });
  it("puts an inert pill where Fables shows Connect", () => {
    const html = renderToStaticMarkup(<NoWalletPill />);
    expect(html).toContain(NO_WALLET_TEXT);
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toMatch(/<(button|a)\b/);
    expect(html.toLowerCase()).not.toContain("connect");
  });
  it("mounts the banner and the header in the root layout", () => {
    const layout = readFileSync(join(APP, "src/app/layout.tsx"), "utf8");
    expect(layout).toContain("<Banner />");
    expect(layout).toContain("<Header />");
  });
  it("lists every route the guardrail checks visit", () => {
    expect(ROUTES).toEqual(["/", "/markets", "/markets/eth", "/markets/d", "/markets/k", "/markets/f", "/integrate", "/evidence", "/run", "/credits"]);
  });
});

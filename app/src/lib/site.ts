// The showcase's identity and guardrails (CLAUDE.md, spec §5.5). Tests import these strings: the banner, the nav
// identity and the inert wallet pill are checked on every route.
export const SITE_NAME = "clim × Fables";
/** Fables' title, the same on every route of fables.fi (its bundle sets no per-route title), and its description. */
export const FABLES_TITLE = "Fables - Dynamic fee ve(3,3) exchange on Uniswap v4";
export const FABLES_DESCRIPTION = "Dynamic fee ve(3,3) exchange on Uniswap v4, building pair-specific markets. Live on Robinhood Chain.";
/** The showcase's: Fables' with "clim × Fables" in place of "Fables", and the non-affiliation at the end. */
export const SITE_TITLE = FABLES_TITLE.replace(/^Fables/, SITE_NAME);
export const SITE_DESCRIPTION = `${FABLES_DESCRIPTION} Showcase by clim, not affiliated with Fables.`;
export const BANNER_TEXT = "Showcase by clim, not affiliated with Fables";
export const BANNER_DETAIL = "Live data, read only. No wallet, no transaction.";
export const NO_WALLET_TEXT = "Showcase: no wallet";
export const SITE_URL = "https://clim-fables.vercel.app";
export const REPO_URL = "https://github.com/gamween/clim-fables";
export const repoFile = (path: string) => `${REPO_URL}/blob/main/${path}`;
export const FABLES_APP_URL = "https://www.fables.fi";

export const NAV = [
  { href: "/markets", label: "Markets", icon: "markets" },
  { href: "/integrate", label: "Integrate", icon: "integrate" },
  { href: "/evidence", label: "Evidence", icon: "evidence" },
  { href: "/run", label: "Run", icon: "run" },
] as const;

/** Every route the app serves, for the guardrail and live checks. */
export const ROUTES = ["/", "/markets", "/markets/eth", "/markets/d", "/markets/k", "/markets/f", "/integrate", "/evidence", "/run", "/credits"] as const;

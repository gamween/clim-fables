// The showcase's identity and guardrails (CLAUDE.md, spec §5.5). Tests import these strings: the banner, the nav
// identity and the inert wallet pill are checked on every route.
export const SITE_NAME = "clim × Fables";
/** One title on every route, as fables.fi does (its bundle sets no per-route title), but saying what clim is: a shared
 *  link must not read as Fables' own product. The description ends with the non-affiliation. */
export const SITE_TITLE = `${SITE_NAME} - A verifiable volatility desk for Fables' dynamic fees`;
export const SITE_DESCRIPTION =
  "A Chainlink CRE desk reads ETH on four exchanges every 30 s and posts a fee for Fables' pools on Robinhood Chain that anyone can recompute. Open source. Showcase by clim, not affiliated with Fables.";
/** The social card, drawn by scripts/og-image.mjs from Fables' brand files (served from public/fables/, not committed). */
export const OG_IMAGE = { url: "/fables/og.jpg", width: 2400, height: 1260, alt: "clim × Fables: Fables' keeper sets the fee, clim checks it in public. Showcase by clim, not affiliated with Fables." } as const;
export const BANNER_TEXT = "Showcase by clim, not affiliated with Fables";
export const BANNER_DETAIL = "Live data, read only. No wallet, no transaction. Not financial advice.";
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

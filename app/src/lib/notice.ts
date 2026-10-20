// The entry notice (NoticeDialog): shown on a visitor's first page, then again 30 days after they acknowledged it, or
// at once when its text changes (the version in the key).
export const NOTICE_KEY = "clim-fables:notice-v1-acknowledged-at";
export const NOTICE_TTL_MS = 30 * 24 * 3_600_000;

/** Whether an acknowledgement stored as `stored` (epoch ms) still holds at `now`. */
export function noticeAcknowledged(stored: string | null, now: number): boolean {
  const at = Number(stored);
  return stored !== null && Number.isFinite(at) && at <= now && now - at < NOTICE_TTL_MS;
}

/** The notice, point by point. Tests and the social card read the same strings. */
export const NOTICE_POINTS = [
  {
    icon: "affiliation",
    title: "Not affiliated with Fables",
    body: "An independent showcase by clim, built in Fables' look to show where clim would fit. Not Fables' app, not endorsed by Fables; their name, logo and art are theirs.",
  },
  {
    icon: "advice",
    title: "Not financial advice",
    body: "Nothing here is financial, investment or tax advice, nor a recommendation to trade or provide liquidity. Do your own research.",
  },
  {
    icon: "testnet",
    title: "Testnet, nothing at stake",
    body: "clim's desk and pools D, K, F run on Robinhood Chain testnet with worthless test tokens. Fables' pool is only read from mainnet.",
  },
  {
    icon: "wallet",
    title: "No wallet, ever",
    body: "This site never asks you to connect a wallet, sign or send funds. Anyone who does in clim's name is not clim.",
  },
  {
    icon: "experimental",
    title: "Experimental and unaudited",
    body: "Research code, not audited. Live numbers can lag or be wrong; each one is read from the chain so you can check it.",
  },
] as const;

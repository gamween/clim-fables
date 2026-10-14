// Fables' tier badge (docs/research/fables-ui-inventory.md §3.10): a 6 px dot by tier. clim reuses the badge for the
// fee's source and for the desk's state; every clim badge says "clim" or names the testnet in its label.

export type Tone = "open" | "overnight" | "faint" | "elevated" | "brand";

export const TONE_COLOR: Record<Tone, string> = {
  open: "var(--positive)",
  overnight: "var(--session)",
  faint: "var(--ink-faint)",
  elevated: "var(--accent)",
  brand: "var(--brand)",
};

export type Badge = { label: string; tone: Tone };

/** "Elevated" when the fee is above the pool's resting (flat) fee, as Fables marks a keeper override; none otherwise. */
export function feeTier(feePips: number | null, flatPips: number): Badge | null {
  return feePips !== null && feePips > flatPips ? { label: "Elevated", tone: "elevated" } : null;
}

/** Fables' "Current fee" tooltips, by state. */
export function feeTooltip(fee0For1: number | null, fee1For0: number | null, flatPips: number): string {
  if (fee0For1 !== null && fee1For0 !== null && fee0For1 !== fee1For0) {
    return "The fee this market charges right now; the two directions cost different amounts.";
  }
  return feeTier(fee0For1, flatPips)
    ? "The fee this market is charging right now, raised above its schedule to protect liquidity providers."
    : "The fee this market charges on every swap right now";
}

export const MODE_LABEL: Record<number, string> = { 0: "Normal", 1: "Degraded", 2: "Blind" };

/** ClimFeePolicy's mode as the level 1 reader names it (normal, degraded, blind) and as the contract numbers it. */
export const MODE_NUMBER = { normal: 0, degraded: 1, blind: 2 } as const;
export const modeLabel = (mode: keyof typeof MODE_NUMBER) => MODE_LABEL[MODE_NUMBER[mode]] as string;

/** The desk's state: blind once it has been silent for more than tauKillSec (ClimPoker then refuses to poke and a
 *  keeper reading clim ignores it), degraded when the venues disagree, live otherwise. */
export function deskBadge(mode: number, ageSec: number, tauKillSec: number): Badge {
  if (mode === 2 || ageSec > tauKillSec) return { label: "clim: blind", tone: "faint" };
  if (mode === 1) return { label: "clim: degraded", tone: "overnight" };
  return { label: "clim: live", tone: "open" };
}

export type FeeSource = "fables" | "D" | "K" | "F";

/** Who sets each market's fee (the markets list's "Fee source" column). */
export const FEE_SOURCE: Record<FeeSource, Badge & { note: string }> = {
  fables: { label: "Fables keeper", tone: "elevated", note: "Fables' own keeper posts overrides through pokeFee (mainnet, read only)" },
  D: { label: "clim", tone: "brand", note: "ClimPoker pokes clim's policy after every desk report (testnet)" },
  K: { label: "Keeper-style", tone: "overnight", note: "a bot imitating the pattern observed on Fables' pool, not Fables' code (testnet)" },
  F: { label: "Flat", tone: "faint", note: "no override: the hook's flat fee (testnet)" },
};

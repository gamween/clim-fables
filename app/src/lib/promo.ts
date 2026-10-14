// Fables' promo card hides for 24 hours once dismissed ("Dismiss launch announcements for 24 hours").
export const PROMO_DISMISS_KEY = "clim-fables:promo-dismissed-at";
export const PROMO_DISMISS_MS = 24 * 3_600_000;

/** Whether a dismissal stored as `stored` (epoch ms) still hides the card at `now`. */
export function promoDismissed(stored: string | null, now: number): boolean {
  const at = Number(stored);
  return stored !== null && Number.isFinite(at) && at <= now && now - at < PROMO_DISMISS_MS;
}

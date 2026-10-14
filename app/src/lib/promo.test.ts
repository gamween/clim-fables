import { describe, expect, it } from "vitest";
import { promoDismissed, PROMO_DISMISS_MS } from "./promo";

describe("promoDismissed", () => {
  it("hides the card for 24 hours after a dismissal", () => {
    const now = 1_760_000_000_000;
    expect(promoDismissed(null, now)).toBe(false);
    expect(promoDismissed(String(now - 1_000), now)).toBe(true);
    expect(promoDismissed(String(now - PROMO_DISMISS_MS + 1), now)).toBe(true);
    expect(promoDismissed(String(now - PROMO_DISMISS_MS), now)).toBe(false);
    expect(promoDismissed("garbage", now)).toBe(false);
    expect(promoDismissed(String(now + 60_000), now)).toBe(false);
  });
});

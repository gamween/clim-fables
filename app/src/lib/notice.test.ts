import { describe, expect, it } from "vitest";
import { NOTICE_POINTS, NOTICE_TTL_MS, noticeAcknowledged } from "./notice";

describe("noticeAcknowledged", () => {
  const now = 1_792_500_000_000;
  it("holds for 30 days after the acknowledgement", () => {
    expect(noticeAcknowledged(String(now - 1_000), now)).toBe(true);
    expect(noticeAcknowledged(String(now - NOTICE_TTL_MS + 1), now)).toBe(true);
    expect(noticeAcknowledged(String(now - NOTICE_TTL_MS), now)).toBe(false);
  });
  it("shows the notice when nothing, garbage or a future time is stored", () => {
    expect(noticeAcknowledged(null, now)).toBe(false);
    expect(noticeAcknowledged("yes", now)).toBe(false);
    expect(noticeAcknowledged(String(now + 60_000), now)).toBe(false);
  });
});

describe("NOTICE_POINTS", () => {
  it("says not affiliated, not financial advice, testnet, no wallet and unaudited", () => {
    expect(NOTICE_POINTS.map((p) => p.title)).toEqual(["Not affiliated with Fables", "Not financial advice", "Testnet, nothing at stake", "No wallet, ever", "Experimental and unaudited"]);
  });
});

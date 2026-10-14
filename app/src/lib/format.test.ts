import { describe, expect, it } from "vitest";
import {
  formatAge,
  formatAmount,
  formatAvgFeePct,
  formatDayTick,
  formatDuration,
  formatFeePct,
  formatGapPips,
  formatInt,
  formatPct2,
  formatPrice,
  formatSigmaE9,
  formatTooltipTime,
  formatUtcClock,
  formatUtcDateTime,
  shortAddress,
} from "./format";

describe("fees, as Fables shows them", () => {
  it("trims to significant digits", () => {
    expect(formatFeePct(700)).toBe("0.07%");
    expect(formatFeePct(5000)).toBe("0.5%");
    expect(formatFeePct(6000)).toBe("0.6%");
    expect(formatFeePct(1468)).toBe("0.1468%");
    expect(formatFeePct(100)).toBe("0.01%");
    expect(formatFeePct(0)).toBe("0%");
  });
  it("shows a missing fee as a dash", () => {
    expect(formatFeePct(null)).toBe("-");
    expect(formatFeePct(undefined)).toBe("-");
    expect(formatFeePct(Number.NaN)).toBe("-");
  });
  it("keeps 4 decimals on averages", () => {
    expect(formatAvgFeePct(1007)).toBe("0.1007%");
    expect(formatAvgFeePct(700)).toBe("0.0700%");
    expect(formatAvgFeePct(1007.4)).toBe("0.1007%");
  });
});

describe("numbers", () => {
  it("formats prices, amounts and integers with separators", () => {
    expect(formatPrice(2484.834)).toBe("2,484.83");
    expect(formatAmount(7388.254621)).toBe("7,388.25462");
    expect(formatAmount(0.00308)).toBe("0.00308");
    expect(formatInt(86285)).toBe("86,285");
    expect(formatPct2(1.1181)).toBe("111.81%");
  });
  it("annualises the desk's sigma", () => {
    // sigmaE9 = annual / sqrt(31,536,000) x 1e9: 0.4158 a year is 74,042.
    expect(formatSigmaE9(74_042)).toBe("41.58%");
    expect(formatSigmaE9(null)).toBe("-");
  });
  it("signs the venue gap", () => {
    expect(formatGapPips(158)).toBe("+0.0158%");
    expect(formatGapPips(-37)).toBe("-0.0037%");
    expect(formatGapPips(0)).toBe("0%");
  });
});

describe("time", () => {
  it("gives Fables' relative ages", () => {
    expect(formatAge(17)).toBe("17s");
    expect(formatAge(61)).toBe("1m");
    expect(formatAge(7300)).toBe("2h");
    expect(formatAge(200_000)).toBe("2d");
    expect(formatAge(-3)).toBe("0s");
  });
  it("spells durations", () => {
    expect(formatDuration(814)).toBe("13 min 34 s");
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(7500)).toBe("2 h 05 min");
  });
  it("labels axes and tooltips in UTC", () => {
    // 2026-10-12T03:23:00Z
    const t = Date.UTC(2026, 9, 12, 3, 23) / 1000;
    expect(formatDayTick(t)).toBe("Oct 12");
    expect(formatTooltipTime(t)).toBe("Oct 12, 3:23 AM UTC");
    expect(formatTooltipTime(Date.UTC(2026, 9, 12, 12, 5) / 1000)).toBe("Oct 12, 12:05 PM UTC");
    expect(formatUtcClock(1791968679)).toBe("09:04:39 UTC");
    expect(formatUtcDateTime(1791968679)).toBe("2026-10-14 09:04:39 UTC");
  });
});

it("shortens addresses Fables' way", () => {
  expect(shortAddress("0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551")).toBe("0xbac3...e551");
});

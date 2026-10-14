// The text each live key is shown with, from its raw on-chain value. The live check (e2e/live.spec.ts) re-reads the raw
// value at the element's block and expects exactly this text in the element.
import { ethUsdFromSqrtPriceX96 } from "@clim/shared";
import { formatAvgFeePct, formatFeePct, formatGapPips, formatInt, formatPrice, formatSigmaE9, formatUtcClock } from "./format";
import { modeLabel, MODE_NUMBER } from "./tiers";

const ETH_FIRST_18_6 = { token0IsEth: true, decimals0: 18, decimals1: 6 } as const;

export function liveText(key: string, raw: string): string {
  if (/:(fee0For1|fee1For0|peak|low)$/.test(key) || key === "clim:quote") return formatFeePct(Number(raw));
  if (/:(avg|meanSwapFee)$/.test(key)) return formatAvgFeePct(Number(raw));
  if (/:price$/.test(key)) return formatPrice(ethUsdFromSqrtPriceX96(BigInt(raw), ETH_FIRST_18_6));
  if (/:(changes|swaps)$/.test(key) || key === "clim:seq") return formatInt(Number(raw));
  if (key === "clim:mode") return modeLabel(raw as keyof typeof MODE_NUMBER);
  if (key === "clim:tObs") return formatUtcClock(Number(raw));
  if (key === "desk:sigma5") return formatSigmaE9(Number(raw));
  if (key === "desk:dev") return formatGapPips(Number(raw));
  if (key.startsWith("roles:")) return raw === "true" ? "yes" : "no";
  throw new Error(`unknown live key ${key}`);
}

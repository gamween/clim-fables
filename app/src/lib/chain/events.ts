// The events and views the app reads, typed from their signatures. events.test.ts checks each against the ABI that
// shared/ exports from the compiled contracts (clim's) or from the published interface (Fables' FeePoked, the same
// signature as clim's PokeFeeHook single-fee FeePoked).
import { parseAbi, parseAbiItem } from "viem";

export const FEE_POKED = parseAbiItem("event FeePoked(bytes32 indexed poolId, uint24 fee, uint40 expiry)");
export const FEE_POKED_DIRECTIONAL = parseAbiItem("event FeePoked(bytes32 indexed poolId, uint24 fee0For1, uint24 fee1For0, uint40 expiry)");
export const POKE_CLEARED = parseAbiItem("event PokeCleared(bytes32 indexed poolId)");
export const SWAP = parseAbiItem(
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
);
export const POKED = parseAbiItem(
  "event Poked(uint32 indexed seq, uint40 tObs, uint24 fee0For1, uint24 fee1For0, uint8 mode, bool eventApplied, uint40 expiry, address caller)",
);
export const RISK_REPORTED_V2 = parseAbiItem(
  "event RiskReportedV2(uint32 indexed seq, uint40 tObs, uint32 sigma15Applied, uint32 sigma5Applied, uint32 sigma15Reported, uint32 sigma5Reported, int32 devPips, uint16 dispBp, uint8 nSources, uint16 kE4, uint8 flags)",
);

export const hookViewAbi = parseAbi(["function currentFee(bytes32 poolId, bool zeroForOne) view returns (uint24)"]);

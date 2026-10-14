// Typed ABI fragments of the clim × Fables contracts (contracts/src/v2) and the external ones the live bots read.
// test/abisV2.test.ts checks them against shared/abis/*.json (contracts/script/export-abis.sh).

/** contracts/src/v2/RiskDeskV2.sol */
export const riskDeskV2Abi = [
  {
    type: "function",
    name: "state",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "tObs", type: "uint40" },
      { name: "sigma15E9", type: "uint32" },
      { name: "sigma5E9", type: "uint32" },
      { name: "devPips", type: "int32" },
      { name: "kE4", type: "uint16" },
      { name: "flags", type: "uint8" },
      { name: "seq", type: "uint32" },
    ],
  },
  {
    type: "event",
    name: "RiskReportedV2",
    inputs: [
      { name: "seq", type: "uint32", indexed: true },
      { name: "tObs", type: "uint40", indexed: false },
      { name: "sigma15Applied", type: "uint32", indexed: false },
      { name: "sigma5Applied", type: "uint32", indexed: false },
      { name: "sigma15Reported", type: "uint32", indexed: false },
      { name: "sigma5Reported", type: "uint32", indexed: false },
      { name: "devPips", type: "int32", indexed: false },
      { name: "dispBp", type: "uint16", indexed: false },
      { name: "nSources", type: "uint8", indexed: false },
      { name: "kE4", type: "uint16", indexed: false },
      { name: "flags", type: "uint8", indexed: false },
    ],
  },
] as const;

/** contracts/src/v2/ClimFeePolicy.sol: mode 0 normal, 1 degraded, 2 blind. */
export const climFeePolicyAbi = [
  {
    type: "function",
    name: "quote",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "fee", type: "uint24" },
      { name: "mode", type: "uint8" },
    ],
  },
  {
    type: "function",
    name: "quoteDirectional",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "fee0For1", type: "uint24" },
      { name: "fee1For0", type: "uint24" },
      { name: "mode", type: "uint8" },
    ],
  },
  {
    type: "function",
    name: "lastObservation",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "tObs", type: "uint40" },
      { name: "seq", type: "uint32" },
    ],
  },
] as const;

/** contracts/src/v2/ClimPoker.sol */
export const climPokerAbi = [
  {
    type: "function",
    name: "poke",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [
      { name: "fee0For1", type: "uint24" },
      { name: "fee1For0", type: "uint24" },
    ],
  },
  {
    type: "event",
    name: "Poked",
    inputs: [
      { name: "seq", type: "uint32", indexed: true },
      { name: "tObs", type: "uint40", indexed: false },
      { name: "fee0For1", type: "uint24", indexed: false },
      { name: "fee1For0", type: "uint24", indexed: false },
      { name: "mode", type: "uint8", indexed: false },
      { name: "eventApplied", type: "bool", indexed: false },
      { name: "expiry", type: "uint40", indexed: false },
      { name: "caller", type: "address", indexed: false },
    ],
  },
  { type: "error", name: "DeskBlind", inputs: [] },
  { type: "error", name: "AccessManagedUnauthorized", inputs: [{ name: "caller", type: "address" }] },
] as const;

/** contracts/src/v2/PokeFeeHook.sol (the same public interface as Fables' override hooks). */
export const pokeFeeHookAbi = [
  {
    type: "function",
    name: "pokeFee",
    stateMutability: "nonpayable",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "fee", type: "uint24" },
      { name: "ttl", type: "uint40" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "pokeFee",
    stateMutability: "nonpayable",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "fee0For1", type: "uint24" },
      { name: "fee1For0", type: "uint24" },
      { name: "ttl", type: "uint40" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "currentFee",
    stateMutability: "view",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "zeroForOne", type: "bool" },
    ],
    outputs: [{ name: "", type: "uint24" }],
  },
  {
    type: "event",
    name: "FeePoked",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "fee", type: "uint24", indexed: false },
      { name: "expiry", type: "uint40", indexed: false },
    ],
  },
  {
    type: "event",
    name: "FeePoked",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "fee0For1", type: "uint24", indexed: false },
      { name: "fee1For0", type: "uint24", indexed: false },
      { name: "expiry", type: "uint40", indexed: false },
    ],
  },
  { type: "error", name: "FeeOutOfBounds", inputs: [{ name: "fee", type: "uint24" }] },
  { type: "error", name: "InvalidTtl", inputs: [{ name: "ttl", type: "uint40" }] },
  { type: "error", name: "PoolNotConfigured", inputs: [{ name: "poolId", type: "bytes32" }] },
  { type: "error", name: "AccessManagedUnauthorized", inputs: [{ name: "caller", type: "address" }] },
] as const;

/** OpenZeppelin AccessManager (5.x): hasRole(roleId, account) -> (isMember, executionDelay). */
export const accessManagerAbi = [
  {
    type: "function",
    name: "hasRole",
    stateMutability: "view",
    inputs: [
      { name: "roleId", type: "uint64" },
      { name: "account", type: "address" },
    ],
    outputs: [
      { name: "isMember", type: "bool" },
      { name: "executionDelay", type: "uint32" },
    ],
  },
] as const;

/** Uniswap v4 PoolManager Swap event (v4-core IPoolManager); `fee` is the LP fee the swap paid, in pips. */
export const poolManagerSwapEventAbi = [
  {
    type: "event",
    name: "Swap",
    inputs: [
      { name: "id", type: "bytes32", indexed: true },
      { name: "sender", type: "address", indexed: true },
      { name: "amount0", type: "int128", indexed: false },
      { name: "amount1", type: "int128", indexed: false },
      { name: "sqrtPriceX96", type: "uint160", indexed: false },
      { name: "liquidity", type: "uint128", indexed: false },
      { name: "tick", type: "int24", indexed: false },
      { name: "fee", type: "uint24", indexed: false },
    ],
  },
] as const;

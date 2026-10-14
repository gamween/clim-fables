// Typed ABI fragments (`as const`, so viem infers argument and return types).
// External contracts: copied from Uniswap v4-core / v4-periphery and Chainlink MockKeystoneForwarder sources.
// clim contracts: the canonical interfaces; test/abis.test.ts checks them against shared/abis/*.json
// (exported from contracts/out by contracts/script/export-abis.sh) as soon as those files exist.
import { erc20Abi } from "viem";

export const POOL_KEY_COMPONENTS = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" },
  { name: "hooks", type: "address" },
] as const;

/** v4-periphery src/lens/StateView.sol */
export const stateViewAbi = [
  {
    type: "function",
    name: "getSlot0",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" },
    ],
  },
  {
    type: "function",
    name: "getLiquidity",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [{ name: "liquidity", type: "uint128" }],
  },
] as const;

/** v4-core src/test/PoolSwapTest.sol: swap(PoolKey, SwapParams, TestSettings, bytes) returns (BalanceDelta = int256). Selector 0x2229d0b4. */
export const poolSwapTestAbi = [
  {
    type: "function",
    name: "swap",
    stateMutability: "payable",
    inputs: [
      { name: "key", type: "tuple", components: POOL_KEY_COMPONENTS },
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "zeroForOne", type: "bool" },
          { name: "amountSpecified", type: "int256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
      {
        name: "testSettings",
        type: "tuple",
        components: [
          { name: "takeClaims", type: "bool" },
          { name: "settleUsingBurn", type: "bool" },
        ],
      },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [{ name: "delta", type: "int256" }],
  },
  // Errors that bubble up from PoolManager / Pool.swap, so viem can name them in revert messages.
  {
    type: "error",
    name: "PriceLimitAlreadyExceeded",
    inputs: [
      { name: "sqrtPriceCurrentX96", type: "uint160" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
    ],
  },
  { type: "error", name: "PriceLimitOutOfBounds", inputs: [{ name: "sqrtPriceLimitX96", type: "uint160" }] },
  { type: "error", name: "SwapAmountCannotBeZero", inputs: [] },
  { type: "error", name: "PoolNotInitialized", inputs: [] },
  { type: "error", name: "CurrencyNotSettled", inputs: [] },
  { type: "error", name: "LPFeeTooLarge", inputs: [{ name: "fee", type: "uint24" }] },
  { type: "error", name: "InvalidHookResponse", inputs: [] },
  { type: "error", name: "HookCallFailed", inputs: [] },
  { type: "error", name: "SafeCastOverflow", inputs: [] },
  {
    type: "error",
    name: "WrappedError",
    inputs: [
      { name: "target", type: "address" },
      { name: "selector", type: "bytes4" },
      { name: "reason", type: "bytes" },
      { name: "details", type: "bytes" },
    ],
  },
] as const;

/** contracts/src/RiskDesk.sol (canonical interface). */
export const riskDeskAbi = [
  {
    type: "function",
    name: "state",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "tObs", type: "uint40" },
      { name: "sigmaE9", type: "uint32" },
      { name: "kE4", type: "uint16" },
      { name: "flags", type: "uint8" },
      { name: "seq", type: "uint32" },
    ],
  },
  {
    type: "event",
    name: "RiskReported",
    inputs: [
      { name: "seq", type: "uint32", indexed: true },
      { name: "tObs", type: "uint40", indexed: false },
      { name: "sigmaApplied", type: "uint32", indexed: false },
      { name: "sigmaReported", type: "uint32", indexed: false },
      { name: "rv15E9", type: "uint32", indexed: false },
      { name: "dvolE2", type: "uint16", indexed: false },
      { name: "refTick", type: "int24", indexed: false },
      { name: "dispBp", type: "uint16", indexed: false },
      { name: "nSources", type: "uint8", indexed: false },
      { name: "kE4", type: "uint16", indexed: false },
      { name: "zone", type: "uint8", indexed: false },
    ],
  },
] as const;

/** contracts/src/ClimHook.sol (canonical interface): mode 0 normal, 1 degraded, 2 blind. */
export const climHookAbi = [
  {
    type: "function",
    name: "quoteFee",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "fee", type: "uint24" },
      { name: "mode", type: "uint8" },
    ],
  },
] as const;

/** contracts/src/test-tokens/TestToken.sol: ERC-20 plus an owner-only mint (plan 01; its public faucet() is used by plan 05, not by the bots). */
export const testTokenMintAbi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export const testTokenAbi = [...erc20Abi, ...testTokenMintAbi] as const;

/** Chainlink MockKeystoneForwarder on Sepolia (verified source, Sourcify). */
export const mockForwarderAbi = [
  {
    type: "function",
    name: "report",
    stateMutability: "nonpayable",
    inputs: [
      { name: "receiver", type: "address" },
      { name: "rawReport", type: "bytes" },
      { name: "reportContext", type: "bytes" },
      { name: "signatures", type: "bytes[]" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "ReportProcessed",
    inputs: [
      { name: "receiver", type: "address", indexed: true },
      { name: "workflowExecutionId", type: "bytes32", indexed: true },
      { name: "reportId", type: "bytes2", indexed: true },
      { name: "result", type: "bool", indexed: false },
    ],
  },
] as const;

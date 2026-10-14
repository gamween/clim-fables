// Fables' ETH/USDG pool on Robinhood Chain mainnet (chain 4663), read only. The values come from the lab's committed
// outputs (lab/out/fables-storm-2026-10-07.json, lab/out/fables-compare.json) and the pool's Initialize log
// (tx 0x1c00f72a65cd83238e496d21776d783974b4e8baf707c7881da6c61a8d5f5a71); fables.test.ts checks them against the
// lab files and recomputes the pool id from the key, and the live check reads them back from the chain.
import type { Address, Hex } from "viem";
import type { HookConfig } from "@/lib/fees";

export const FABLES = {
  chainId: 4663,
  pair: "ETH/USDG",
  poolId: "0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551" as Hex,
  key: {
    currency0: "0x0000000000000000000000000000000000000000" as Address,
    currency1: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as Address,
    fee: 0x800000,
    tickSpacing: 10,
    hooks: "0x06a889870C8f83640D6816319f72e2aA579b6080" as Address,
  },
  hook: "0x06a889870C8f83640D6816319f72e2aA579b6080" as Address,
  hookContract: "FablesRampETH",
  poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951" as Address,
  stateView: "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b" as Address,
  accessManager: "0xA362D98B33A7bb5B5E2180a05f995A70FB404f30" as Address,
  keeper: "0x1B6a8808E1D26dba66bA11E52997803C43CAd429" as Address,
  usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as Address,
  /** Floor 1 bp, flat 7 bp, cap 60 bp since block 56,022,455 (2026-09-06, PoolConfigured). */
  config: { floorPips: 100, flatPips: 700, capPips: 6000 } satisfies HookConfig,
  configSinceBlock: 56_022_455n,
  /** Every keeper override so far used a 7,200 s TTL (lab/out/fables-storm-2026-10-07.json, pokeTtlSec). */
  pokeTtlSec: 7200,
  /** At least this far apart: the lab measured 0.1023 s blocks; the app steps back with a smaller value. */
  minBlockSec: 0.09,
  explorer: "https://robin.etherscan.io",
  sourcify: "https://repo.sourcify.dev/4663/0x06a889870C8f83640D6816319f72e2aA579b6080",
  app: "https://www.fables.fi/markets/eth",
} as const;

export const fablesTx = (tx: string) => `${FABLES.explorer}/tx/${tx}`;
export const fablesAddress = (a: string) => `${FABLES.explorer}/address/${a}`;

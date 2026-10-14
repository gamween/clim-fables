// Reads, from a fresh client in Node, the value behind every live key at the block the page read it, so the live check
// compares the page with the chain itself.
import { accessManagerAbi, climFeePolicyAbi, riskDeskV2Abi, stateViewAbi, type LivePoolName } from "@clim/shared";
import { createPublicClient, http, type PublicClient } from "viem";
import { robinhood, robinhoodTestnet } from "viem/chains";
import { LIVE } from "../src/lib/chain/deployments";
import { hookViewAbi } from "../src/lib/chain/events";
import { FABLES } from "../src/lib/chain/fables";
import { readPoolOverrides } from "../src/lib/chain/readClim";
import { readFablesPokes, readSwaps } from "../src/lib/chain/readFables";
import { feeWindow, swapWindow } from "../src/lib/windowStats";

export type LiveElement = { key: string; chain: string; block: string; raw: string; text: string; fromBlock?: string; toBlock?: string; fromTs?: string; toTs?: string };

// The public endpoints rate-limit ("Rate Limit Hit, limit will reset in 60 seconds"): batch like the app and back off
// for up to about a minute (2 + 4 + 8 + 16 + 32 s) before a read fails.
const transport = (url: string) => http(url, { batch: { batchSize: 50, wait: 16 }, retryCount: 5, retryDelay: 2_000 });
const mainnet = createPublicClient({ chain: robinhood, transport: transport(process.env.RH_MAINNET_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com") }) as PublicClient;
const testnet = createPublicClient({ chain: robinhoodTestnet, transport: transport(process.env.RH_TESTNET_RPC_URL ?? "https://rpc.testnet.chain.robinhood.com") }) as PublicClient;
const MODES = ["normal", "degraded", "blind"] as const;

function range(e: LiveElement) {
  if (!e.fromBlock || !e.toBlock || !e.fromTs || !e.toTs) throw new Error(`${e.key}: no range`);
  return { fromBlock: BigInt(e.fromBlock), toBlock: BigInt(e.toBlock), fromTs: Number(e.fromTs), toTs: Number(e.toTs) };
}

/** The raw value of `e.key` on chain at `e.block` (or over its range), as the page writes it in data-raw. */
export async function resolve(e: LiveElement): Promise<string> {
  const blockNumber = BigInt(e.block);
  const [ns, a, b] = e.key.split(":") as [string, string, string | undefined];
  if (ns === "fables") {
    if (a === "fee0For1" || a === "fee1For0") {
      return String(await mainnet.readContract({ address: FABLES.hook, abi: hookViewAbi, functionName: "currentFee", args: [FABLES.poolId, a === "fee0For1"], blockNumber }));
    }
    if (a === "price") return String((await mainnet.readContract({ address: FABLES.stateView, abi: stateViewAbi, functionName: "getSlot0", args: [FABLES.poolId], blockNumber }))[0]);
    const r = range(e);
    const w = feeWindow(await readFablesPokes(mainnet, r.fromBlock, r.toBlock), FABLES.config, r.toTs, r.toTs - r.fromTs);
    return windowValue(w, a);
  }
  if (ns === "clim") {
    if (a === "quote" || a === "mode") {
      const [fee, mode] = await testnet.readContract({ address: LIVE.policy, abi: climFeePolicyAbi, functionName: "quote", blockNumber });
      return a === "quote" ? String(fee) : MODES[mode] ?? String(mode);
    }
    if (a === "fee0For1" || a === "fee1For0") {
      const [f01, f10] = await testnet.readContract({ address: LIVE.policy, abi: climFeePolicyAbi, functionName: "quoteDirectional", blockNumber });
      return String(a === "fee0For1" ? f01 : f10);
    }
    const [tObs, seq] = await testnet.readContract({ address: LIVE.policy, abi: climFeePolicyAbi, functionName: "lastObservation", blockNumber });
    return String(a === "seq" ? seq : tObs);
  }
  if (ns === "desk") {
    const st = await testnet.readContract({ address: LIVE.riskDesk, abi: riskDeskV2Abi, functionName: "state", blockNumber });
    return String(a === "sigma5" ? st[2] : st[3]);
  }
  if (ns === "roles") {
    const [id, who] = a === "poker" ? [BigInt(LIVE.roles.feePoker), LIVE.poker] : [BigInt(LIVE.roles.climRunner), LIVE.roles.runner];
    return String((await testnet.readContract({ address: LIVE.accessManager, abi: accessManagerAbi, functionName: "hasRole", args: [id, who], blockNumber }))[0]);
  }
  if (ns === "pool" && b) {
    const pool = a as LivePoolName;
    const poolId = LIVE.pools[pool].poolId;
    if (b === "fee0For1" || b === "fee1For0") return String(await testnet.readContract({ address: LIVE.hook, abi: hookViewAbi, functionName: "currentFee", args: [poolId, b === "fee0For1"], blockNumber }));
    if (b === "price") return String((await testnet.readContract({ address: LIVE.uniswap.stateView, abi: stateViewAbi, functionName: "getSlot0", args: [poolId], blockNumber }))[0]);
    const r = range(e);
    if (b === "swaps" || b === "meanSwapFee") {
      const sw = swapWindow(await readSwaps(testnet, LIVE.uniswap.poolManager, poolId, r.fromBlock, r.toBlock));
      return String(b === "swaps" ? sw.count : sw.meanFeePips);
    }
    const w = feeWindow(await readPoolOverrides(testnet, pool, r.fromBlock, r.toBlock), LIVE.hookConfig, r.toTs, r.toTs - r.fromTs);
    return windowValue(w, b);
  }
  throw new Error(`no resolver for ${e.key}`);
}

function windowValue(w: ReturnType<typeof feeWindow>, field: string): string {
  if (field === "avg") return String(w.avg);
  if (field === "peak") return String(w.peak);
  if (field === "low") return String(w.low);
  if (field === "changes") return String(w.changes);
  throw new Error(`no window field ${field}`);
}

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, custom, decodeFunctionData, encodeFunctionResult, numberToHex, type AbiParameter, type Hex } from "viem";
import { robinhoodTestnet } from "viem/chains";
import { CLIM_TESTNET, climFeePolicyReadAbi, climUsable, composeDirectional, composeFee, readClimQuote, type ClimQuote } from "../keeper-read";

type Chain = { head: bigint; timestamp: number; quote: [number, number]; dir: [number, number, number]; obs: [number, number]; tau: number };

/** A fake RPC: answers the five reads keeper-read.ts makes and records the block each one asked for. */
function fakeClient(c: Chain, seen: { calls: Array<{ to: string; block: string }>; blocks: string[] }) {
  return createPublicClient({
    chain: robinhoodTestnet,
    transport: custom({
      async request({ method, params }) {
        if (method === "eth_chainId") return numberToHex(46630);
        if (method === "eth_blockNumber") return numberToHex(c.head);
        if (method === "eth_getBlockByNumber") {
          const [tag] = params as [Hex, boolean];
          seen.blocks.push(tag);
          return { number: tag, hash: `0x${"11".repeat(32)}`, parentHash: `0x${"22".repeat(32)}`, timestamp: numberToHex(c.timestamp), transactions: [], uncles: [], logsBloom: null, nonce: null };
        }
        if (method === "eth_call") {
          const [tx, block] = params as [{ to: string; data: Hex }, string];
          seen.calls.push({ to: tx.to, block });
          const { functionName } = decodeFunctionData({ abi: climFeePolicyReadAbi, data: tx.data });
          if (functionName === "quote") return encodeFunctionResult({ abi: climFeePolicyReadAbi, functionName, result: c.quote });
          if (functionName === "quoteDirectional") return encodeFunctionResult({ abi: climFeePolicyReadAbi, functionName, result: c.dir });
          if (functionName === "lastObservation") return encodeFunctionResult({ abi: climFeePolicyReadAbi, functionName, result: c.obs });
          return encodeFunctionResult({ abi: climFeePolicyReadAbi, functionName, result: c.tau });
        }
        throw new Error(`unexpected ${method}`);
      },
    }),
  });
}

const LIVE: Chain = { head: 1_000n, timestamp: 1_791_970_850, quote: [1_004, 0], dir: [1_380, 1_004, 0], obs: [1_791_970_823, 114], tau: 180 };

function quote(over: Partial<ClimQuote> = {}): ClimQuote {
  return { fee: 1_004, fee0For1: 1_380, fee1For0: 1_004, mode: "normal", tObs: 100, seq: 7, ageSec: 20, tauKillSec: 180, blockNumber: 997n, blockTimestamp: 120, ...over };
}

describe("readClimQuote", () => {
  test("reads quote, quoteDirectional, lastObservation and tauKillSec at one block, 3 behind the head", async () => {
    const seen = { calls: [] as Array<{ to: string; block: string }>, blocks: [] as string[] };
    const q = await readClimQuote(fakeClient(LIVE, seen));
    expect(q).toEqual({
      fee: 1_004,
      fee0For1: 1_380,
      fee1For0: 1_004,
      mode: "normal",
      tObs: 1_791_970_823,
      seq: 114,
      ageSec: 27,
      tauKillSec: 180,
      blockNumber: 997n,
      blockTimestamp: 1_791_970_850,
    });
    expect(seen.calls.length).toBe(4);
    for (const c of seen.calls) {
      expect(c.to.toLowerCase()).toBe(CLIM_TESTNET.policy.toLowerCase());
      expect(c.block).toBe(numberToHex(997n));
    }
    expect(seen.blocks).toEqual([numberToHex(997n)]);
  });

  test("names the modes and rejects an unknown one", async () => {
    const seen = { calls: [] as Array<{ to: string; block: string }>, blocks: [] as string[] };
    expect((await readClimQuote(fakeClient({ ...LIVE, quote: [3_000, 1] }, seen))).mode).toBe("degraded");
    expect((await readClimQuote(fakeClient({ ...LIVE, quote: [3_000, 2] }, seen))).mode).toBe("blind");
    await expect(readClimQuote(fakeClient({ ...LIVE, quote: [3_000, 3] }, seen))).rejects.toThrow("unknown ClimFeePolicy mode 3");
  });

  test("lagBlocks 0 reads the head itself", async () => {
    const seen = { calls: [] as Array<{ to: string; block: string }>, blocks: [] as string[] };
    expect((await readClimQuote(fakeClient(LIVE, seen), { lagBlocks: 0n })).blockNumber).toBe(1_000n);
  });
});

describe("composition with the keeper's own fee", () => {
  test("max of the two while clim is fresh: clim can raise the fee, never lower the keeper's", () => {
    expect(composeFee(700, quote())).toEqual({ fee: 1_004, source: "clim", climUsed: true });
    expect(composeFee(6_000, quote())).toEqual({ fee: 6_000, source: "keeper", climUsed: true });
  });
  test("a degraded desk still counts (its fee is at least the safe fee)", () => {
    expect(composeFee(700, quote({ fee: 3_000, mode: "degraded" }))).toEqual({ fee: 3_000, source: "clim", climUsed: true });
  });
  test("a blind desk, or one older than maxAgeSec, is ignored", () => {
    expect(composeFee(700, quote({ fee: 3_000, mode: "blind", ageSec: 400 }))).toEqual({ fee: 700, source: "keeper", climUsed: false });
    expect(climUsable(quote({ ageSec: 180 }))).toBe(true);
    expect(climUsable(quote({ ageSec: 181 }))).toBe(false);
    expect(composeFee(700, quote({ ageSec: 61 }), 60)).toEqual({ fee: 700, source: "keeper", climUsed: false });
  });
  test("per direction, each side on its own", () => {
    const c = composeDirectional(1_200, 1_200, quote());
    expect(c.fee0For1).toEqual({ fee: 1_380, source: "clim", climUsed: true });
    expect(c.fee1For0).toEqual({ fee: 1_200, source: "keeper", climUsed: true });
  });
});

describe("the read ABI is the compiled one", () => {
  const typeOf = (p: AbiParameter): string => p.type;
  const sig = (f: { name?: string; inputs?: readonly AbiParameter[]; outputs?: readonly AbiParameter[] }) =>
    `${f.name}(${(f.inputs ?? []).map(typeOf).join(",")})->(${(f.outputs ?? []).map(typeOf).join(",")})`;
  test("every fragment exists in shared/abis/ClimFeePolicy.json with the same types", () => {
    const compiled = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "..", "shared", "abis", "ClimFeePolicy.json"), "utf8")) as Array<{ type: string; name?: string; inputs?: AbiParameter[]; outputs?: AbiParameter[] }>;
    const sigs = new Set(compiled.filter((x) => x.type === "function").map(sig));
    for (const f of climFeePolicyReadAbi) expect(sigs.has(sig(f))).toBe(true);
  });
  test("the testnet policy address is the deployed one", () => {
    const d = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "..", "shared", "deployments", "robinhood-testnet.json"), "utf8")) as { policy: string; riskDesk: string };
    expect(CLIM_TESTNET.policy).toBe(d.policy as typeof CLIM_TESTNET.policy);
    expect(CLIM_TESTNET.riskDesk).toBe(d.riskDesk as typeof CLIM_TESTNET.riskDesk);
  });
});

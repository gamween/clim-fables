import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeFunctionData, toFunctionSelector, type Abi } from "viem";
import accessManagerJson from "../../../shared/abis/AccessManager.json";
import { buildLevel2Batch, CLIM_RUNNER, FEE_POKER, FORK_PARAMS, type Level2Batch } from "../level2-batch";

const am = accessManagerJson as Abi;
const decode = (data: `0x${string}`) => decodeFunctionData({ abi: am, data });
const POKER = "0x5c4a3C2CD1ffE6aAfDF62b64bb3E620C696c832E";
const RUNNER = "0x9071328d72b35420DcF7938d1F64Ab44Deb9D607";
const KEEPER = "0x1B6a8808E1D26dba66bA11E52997803C43CAd429";

describe("the level 2 batch", () => {
  const b = buildLevel2Batch(FORK_PARAMS);

  test("grantRole(FEE_POKER, poker), the two setTargetFunctionRole, labelRole and one grant per runner, in that order", () => {
    expect(b.calls.map((c) => c.function)).toEqual([
      "grantRole(uint64,address,uint32)",
      "setTargetFunctionRole(address,bytes4[],uint64)",
      "labelRole(uint64,string)",
      "setTargetFunctionRole(address,bytes4[],uint64)",
      "grantRole(uint64,address,uint32)",
      "grantRole(uint64,address,uint32)",
    ]);
    expect(decode(b.calls[0]!.data).args).toEqual([BigInt(FEE_POKER), POKER, 0]);
    expect(decode(b.calls[1]!.data).args).toEqual([
      POKER,
      [toFunctionSelector("postEvent(uint24,uint24,uint40)"), toFunctionSelector("postEventAndPoke(uint24,uint24,uint40)")],
      BigInt(FEE_POKER),
    ]);
    expect(decode(b.calls[2]!.data).args).toEqual([BigInt(CLIM_RUNNER), "CLIM_RUNNER"]);
    expect(decode(b.calls[3]!.data).args).toEqual([POKER, [toFunctionSelector("poke()")], BigInt(CLIM_RUNNER)]);
    expect(decode(b.calls[4]!.data).args).toEqual([BigInt(CLIM_RUNNER), RUNNER, 0]);
    expect(decode(b.calls[5]!.data).args).toEqual([BigInt(CLIM_RUNNER), KEEPER, 0]);
  });

  test("the multicall wraps exactly those calls, sent to the AccessManager", () => {
    const m = decode(b.multicall.data);
    expect(m.functionName).toBe("multicall");
    expect(m.args).toEqual([b.calls.map((c) => c.data)]);
    expect(b.multicall.to).toBe(FORK_PARAMS.accessManager);
  });

  test("revocation: FEE_POKER from the poker stops everything; cleanup removes each runner", () => {
    expect(decode(b.revoke.stop.data).functionName).toBe("revokeRole");
    expect(decode(b.revoke.stop.data).args).toEqual([BigInt(FEE_POKER), POKER]);
    expect(b.revoke.cleanup.map((c) => decode(c.data).args)).toEqual([
      [BigInt(CLIM_RUNNER), RUNNER],
      [BigInt(CLIM_RUNNER), KEEPER],
    ]);
  });

  test("addresses are checksummed and a batch needs at least one runner", () => {
    const lower = buildLevel2Batch({ ...FORK_PARAMS, poker: POKER.toLowerCase() as `0x${string}` });
    expect(lower.params.poker).toBe(POKER);
    expect(() => buildLevel2Batch({ ...FORK_PARAMS, runners: [] })).toThrow("at least one CLIM_RUNNER account");
  });

  for (const preset of ["fork", "testnet"] as const) {
    const file = join(import.meta.dir, "..", `level2-batch.${preset}.json`);
    test.skipIf(!existsSync(file))(`level2-batch.${preset}.json is what the generator writes today`, () => {
      const committed = JSON.parse(readFileSync(file, "utf8")) as Level2Batch;
      expect(buildLevel2Batch(committed.params)).toEqual(committed);
    });
  }
});

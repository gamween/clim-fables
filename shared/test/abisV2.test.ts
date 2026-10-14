import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { toEventSelector, toFunctionSelector, type AbiParameter } from "viem";
import { accessManagerAbi, climFeePolicyAbi, climPokerAbi, pokeFeeHookAbi, poolManagerSwapEventAbi, riskDeskV2Abi } from "../src/abisV2";

type Item = { type: string; name?: string; inputs?: readonly AbiParameter[]; outputs?: readonly AbiParameter[] };
function typeOf(p: AbiParameter): string {
  if (p.type.startsWith("tuple") && "components" in p && p.components) return `(${p.components.map(typeOf).join(",")})${p.type.slice(5)}`;
  return p.type;
}
function canonical(item: Item): string {
  const ins = (item.inputs ?? []).map((p) => `${typeOf(p)}${"indexed" in p && p.indexed ? " indexed" : ""}`);
  return `${item.type} ${item.name}(${ins.join(",")}) -> (${(item.outputs ?? []).map(typeOf).join(",")})`;
}

const ABI_DIR = join(import.meta.dir, "..", "abis");
const OURS: Array<[string, readonly Item[]]> = [
  ["RiskDeskV2", riskDeskV2Abi],
  ["ClimFeePolicy", climFeePolicyAbi],
  ["ClimPoker", climPokerAbi],
  ["PokeFeeHook", pokeFeeHookAbi],
  ["IPoolManager", poolManagerSwapEventAbi],
];

describe("v2 fragments match the compiled contracts (shared/abis/*.json)", () => {
  for (const [name, fragments] of OURS) {
    const file = join(ABI_DIR, `${name}.json`);
    test.skipIf(!existsSync(file))(`${name}: every fragment exists with the same signature`, () => {
      const compiled = new Set((JSON.parse(readFileSync(file, "utf8")) as Item[]).map(canonical));
      for (const f of fragments) expect(compiled.has(canonical(f))).toBe(true);
    });
  }
});

describe("selectors", () => {
  test("both pokeFee overloads and currentFee", () => {
    const sels = pokeFeeHookAbi.flatMap((x) => (x.type === "function" ? [toFunctionSelector(x)] : []));
    expect(sels).toContain(toFunctionSelector("function pokeFee(bytes32,uint24,uint40)"));
    expect(sels).toContain(toFunctionSelector("function pokeFee(bytes32,uint24,uint24,uint40)"));
    expect(sels).toContain("0x15452022"); // currentFee(bytes32,bool), as on Fables' hook
  });
  test("AccessManager.hasRole(uint64,address)", () => {
    expect(toFunctionSelector(accessManagerAbi[0])).toBe(toFunctionSelector("function hasRole(uint64,address)"));
  });
  test("RiskReportedV2 topic", () => {
    expect(toEventSelector(riskDeskV2Abi[1])).toBe(
      toEventSelector("event RiskReportedV2(uint32 indexed,uint40,uint32,uint32,uint32,uint32,int32,uint16,uint8,uint16,uint8)"),
    );
  });
});

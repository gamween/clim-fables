// Level 2 of the clim x Fables integration: the AccessManager batch that lets ClimPoker post to Fables' hook, and the
// calls that undo it. Every calldata is encoded from the compiled ABIs (shared/abis/AccessManager.json and
// ClimPoker.json, exported by contracts/script/export-abis.sh), so anyone can regenerate and compare it.
//
//   bun docs/integrate/level2-batch.ts --preset fork        writes docs/integrate/level2-batch.fork.json
//   bun docs/integrate/level2-batch.ts --preset testnet     writes docs/integrate/level2-batch.testnet.json
//   bun docs/integrate/level2-batch.ts --preset testnet --check   reads clim's testnet AccessManager (eth_call only)
//                                                                  and exits 1 unless it is in the state the batch sets
//   bun docs/integrate/level2-batch.ts --access-manager <a> --poker <a> --runner <a> [--runner <a> ...] [--chain-id <n>]
//                                                            prints the batch for another deployment
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, encodeFunctionData, getAbiItem, getAddress, http, toFunctionSelector, type Abi, type AbiFunction, type Address, type Hex } from "viem";
import { robinhoodTestnet } from "viem/chains";
import accessManagerJson from "../../shared/abis/AccessManager.json";
import climPokerJson from "../../shared/abis/ClimPoker.json";

const accessManagerAbi = accessManagerJson as Abi;
const climPokerAbi = climPokerJson as Abi;
const REPO_ROOT = join(import.meta.dir, "..", "..");

/** Fables' FEE_POKER role id on their AccessManager (labelled "FEE_POKER", administered by POKER_ADMIN, role 5). */
export const FEE_POKER = 1;
/** The role id proposed for "who may call ClimPoker.poke()". Fables' AccessManager labels roles 1, 2, 4, 5 and 6;
 *  7 was unused when this file was written (docs/integrate/README.md shows how to check before sending). */
export const CLIM_RUNNER = 7;
export const CLIM_RUNNER_LABEL = "CLIM_RUNNER";

export type Level2Params = {
  chainId: number;
  accessManager: Address;
  poker: Address;
  /** Granted CLIM_RUNNER: clim's runner bot first, then Fables' keeper. */
  runners: Address[];
  note: string;
};

export type Call = { description: string; function: string; args: Array<string | number | string[]>; data: Hex };

export type Level2Batch = {
  generatedBy: string;
  params: Level2Params & { feePokerRole: number; climRunnerRole: number; climRunnerLabel: string };
  requiredCaller: string;
  calls: Call[];
  multicall: { to: Address; data: Hex };
  revoke: { stop: Call; cleanup: Call[] };
  expect: { functionRoles: Array<{ function: string; selector: Hex; role: number }>; members: Array<{ role: number; account: Address }> };
};

function selector(name: string): Hex {
  return toFunctionSelector(getAbiItem({ abi: climPokerAbi, name }) as AbiFunction);
}

function call(description: string, functionName: string, args: Array<string | number | string[]>): Call {
  const item = getAbiItem({ abi: accessManagerAbi, name: functionName }) as AbiFunction;
  const signature = `${functionName}(${item.inputs.map((i) => i.type).join(",")})`;
  return { description, function: signature, args, data: encodeFunctionData({ abi: accessManagerAbi, functionName, args }) };
}

export function buildLevel2Batch(p: Level2Params): Level2Batch {
  const poker = getAddress(p.poker);
  const accessManager = getAddress(p.accessManager);
  const runners = p.runners.map((r) => getAddress(r));
  if (runners.length === 0) throw new Error("at least one CLIM_RUNNER account is needed");
  const keeperSel = [selector("postEvent"), selector("postEventAndPoke")];
  const runnerSel = [selector("poke")];
  const calls: Call[] = [
    call("FEE_POKER to ClimPoker: it may call the hook's pokeFee (needs POKER_ADMIN, role 5)", "grantRole", [FEE_POKER, poker, 0]),
    call("postEvent and postEventAndPoke on ClimPoker for FEE_POKER: the keeper posts its event overrides there (needs ADMIN, role 0)", "setTargetFunctionRole", [poker, keeperSel, FEE_POKER]),
    call(`label role ${CLIM_RUNNER} (needs ADMIN)`, "labelRole", [CLIM_RUNNER, CLIM_RUNNER_LABEL]),
    call(`poke on ClimPoker for ${CLIM_RUNNER_LABEL} (needs ADMIN)`, "setTargetFunctionRole", [poker, runnerSel, CLIM_RUNNER]),
    ...runners.map((r, i) => call(`${CLIM_RUNNER_LABEL} to ${i === 0 ? "clim's runner" : `account ${i}`} ${r} (needs ADMIN, the default admin of a new role)`, "grantRole", [CLIM_RUNNER, r, 0])),
  ];
  return {
    generatedBy: "docs/integrate/level2-batch.ts",
    params: { ...p, accessManager, poker, runners, feePokerRole: FEE_POKER, climRunnerRole: CLIM_RUNNER, climRunnerLabel: CLIM_RUNNER_LABEL },
    requiredCaller: "an account holding ADMIN (role 0) and POKER_ADMIN (role 5) with no execution delay, or send the grantRole(FEE_POKER) call from a POKER_ADMIN holder and the rest from an ADMIN holder",
    calls,
    multicall: { to: accessManager, data: encodeFunctionData({ abi: accessManagerAbi, functionName: "multicall", args: [calls.map((c) => c.data)] }) },
    revoke: {
      stop: call("revoke FEE_POKER from ClimPoker: every poke reverts in the hook from the next block (needs POKER_ADMIN)", "revokeRole", [FEE_POKER, poker]),
      cleanup: runners.map((r) => call(`revoke ${CLIM_RUNNER_LABEL} from ${r} (needs ADMIN)`, "revokeRole", [CLIM_RUNNER, r])),
    },
    expect: {
      functionRoles: [
        { function: "postEvent(uint24,uint24,uint40)", selector: keeperSel[0] as Hex, role: FEE_POKER },
        { function: "postEventAndPoke(uint24,uint24,uint40)", selector: keeperSel[1] as Hex, role: FEE_POKER },
        { function: "poke()", selector: runnerSel[0] as Hex, role: CLIM_RUNNER },
      ],
      members: [{ role: FEE_POKER, account: poker }, ...runners.map((account) => ({ role: CLIM_RUNNER, account }))],
    },
  };
}

/** Fables' mainnet AccessManager with the ClimPoker of the recorded fork run: contracts/test/fork/Level2Batch.t.sol
 *  sends this file's calldata as Fables' admin on a Robinhood mainnet fork. */
export const FORK_PARAMS: Level2Params = {
  chainId: 4663,
  accessManager: "0xA362D98B33A7bb5B5E2180a05f995A70FB404f30",
  poker: "0x5c4a3C2CD1ffE6aAfDF62b64bb3E620C696c832E",
  runners: ["0x9071328d72b35420DcF7938d1F64Ab44Deb9D607", "0x1B6a8808E1D26dba66bA11E52997803C43CAd429"],
  note: "Fables' AccessManager on Robinhood Chain mainnet. The poker address is the ClimPoker of the recorded fork run (docs/evidence/fork-run-2026-10-07.json), deployed only on a fork; the runner is the fork suite's runner (makeAddr(\"climRunner\")); the second CLIM_RUNNER account is Fables' keeper 0x1B6a...d429 (FEE_POKER at fork block 87,780,000). A mainnet batch uses the address ClimPoker gets when deployed and clim's runner key.",
};

function testnetParams(): Level2Params {
  const d = JSON.parse(readFileSync(join(REPO_ROOT, "shared", "deployments", "robinhood-testnet.json"), "utf8")) as {
    chainId: number;
    accessManager: Address;
    poker: Address;
    roles: { runner: Address };
  };
  return {
    chainId: d.chainId,
    accessManager: d.accessManager,
    poker: d.poker,
    runners: [d.roles.runner],
    note: "clim's own AccessManager on Robinhood Chain testnet (shared/deployments/robinhood-testnet.json), where contracts/script/v2/13_LiveDesk.s.sol sent the same calls at deployment; --check reads that state.",
  };
}

const accessManagerReadAbi = [
  { type: "function", name: "getTargetFunctionRole", stateMutability: "view", inputs: [{ name: "target", type: "address" }, { name: "selector", type: "bytes4" }], outputs: [{ name: "", type: "uint64" }] },
  { type: "function", name: "hasRole", stateMutability: "view", inputs: [{ name: "roleId", type: "uint64" }, { name: "account", type: "address" }], outputs: [{ name: "isMember", type: "bool" }, { name: "executionDelay", type: "uint32" }] },
] as const;

/** Reads the AccessManager (eth_call only) and lists every expectation the chain does not meet. */
export async function checkOnChain(b: Level2Batch, rpcUrl?: string): Promise<string[]> {
  const client = createPublicClient({ chain: robinhoodTestnet, transport: http(rpcUrl) });
  const am = b.params.accessManager;
  const problems: string[] = [];
  for (const f of b.expect.functionRoles) {
    const role = await client.readContract({ address: am, abi: accessManagerReadAbi, functionName: "getTargetFunctionRole", args: [b.params.poker, f.selector] });
    if (Number(role) !== f.role) problems.push(`${f.function}: role ${role}, expected ${f.role}`);
  }
  for (const m of b.expect.members) {
    const [isMember] = await client.readContract({ address: am, abi: accessManagerReadAbi, functionName: "hasRole", args: [BigInt(m.role), m.account] });
    if (!isMember) problems.push(`role ${m.role} not held by ${m.account}`);
  }
  return problems;
}

function args(flag: string, argv: readonly string[]): string[] {
  const out: string[] = [];
  argv.forEach((a, i) => {
    const v = argv[i + 1];
    if (a === flag && v !== undefined) out.push(v);
  });
  return out;
}

if (import.meta.main) {
  const argv = process.argv;
  const preset = args("--preset", argv)[0];
  if (preset === "fork" || preset === "testnet") {
    const batch = buildLevel2Batch(preset === "fork" ? FORK_PARAMS : testnetParams());
    if (argv.includes("--check")) {
      if (preset !== "testnet") throw new Error("--check reads clim's testnet AccessManager: use it with --preset testnet");
      const problems = await checkOnChain(batch, process.env.RH_TESTNET_RPC_URL);
      for (const p of problems) console.log(`MISMATCH ${p}`);
      console.log(problems.length === 0 ? `testnet AccessManager ${batch.params.accessManager}: every role the batch sets is in place` : `${problems.length} mismatch(es)`);
      process.exit(problems.length === 0 ? 0 : 1);
    }
    const file = join(import.meta.dir, `level2-batch.${preset}.json`);
    writeFileSync(file, `${JSON.stringify(batch, null, 2)}\n`);
    console.log(`wrote docs/integrate/level2-batch.${preset}.json (${batch.calls.length} calls, multicall ${(batch.multicall.data.length - 2) / 2} bytes)`);
  } else {
    const [accessManager] = args("--access-manager", argv);
    const [poker] = args("--poker", argv);
    const runners = args("--runner", argv) as Address[];
    if (accessManager === undefined || poker === undefined || runners.length === 0) {
      console.error("usage: --preset fork|testnet [--check], or --access-manager <address> --poker <address> --runner <address> [--runner <address>] [--chain-id <n>]");
      process.exit(2);
    }
    const chainId = Number(args("--chain-id", argv)[0] ?? "4663");
    console.log(JSON.stringify(buildLevel2Batch({ chainId, accessManager: accessManager as Address, poker: poker as Address, runners, note: "generated from the command line" }), null, 2));
  }
}

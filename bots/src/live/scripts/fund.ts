// Funding and approvals of the live stack's keys (idempotent: tops up only what is missing), from DEPLOYER_PRIVATE_KEY
// (TestToken owner): testnet ETH for gas to the CRE operator, runner, keeper, arbitrage and retail keys; tETH and tUSDG
// minted to the arbitrage and retail keys, which approve the router they swap through.
// Usage: bun src/live/scripts/fund.ts     Env: FUND_SCALE (multiplies every ETH target, default 1)
import { testTokenAbi } from "@clim/shared";
import { formatEther, formatUnits, maxUint256, parseEther, parseUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { envNum } from "../../lib/env";
import { liveClient, liveWallet } from "../lib/chain";
import { loadLiveDeployments } from "../lib/deployments";
import { liveKey, type LiveRole } from "../lib/env";

const d = loadLiveDeployments();
const client = liveClient();
const deployer = liveWallet(liveKey("deployer"));
const scale = envNum("FUND_SCALE", 1);

type Target = { name: string; address: Address; eth: number; key?: Hex; router?: Address; mint?: { tETH: string; tUSDG: string } };
const keyed = (role: LiveRole) => {
  const key = liveKey(role);
  return { key, address: privateKeyToAccount(key).address };
};
const TARGETS: Target[] = [
  { name: "CRE operator", address: d.cre.simOperator, eth: 0.1 },
  { name: "runner", ...keyed("runner"), eth: 0.1 },
  { name: "keeper", ...keyed("keeper"), eth: 0.02 },
  { name: "arbitrage", ...keyed("arb"), eth: 0.08, router: d.routers.arb, mint: { tETH: "1000", tUSDG: "5000000" } },
  { name: "retail", ...keyed("noise"), eth: 0.05, router: d.uniswap.poolSwapTest, mint: { tETH: "100", tUSDG: "500000" } },
];

async function send(hash: Promise<Hex>): Promise<Hex> {
  const h = await hash;
  await client.waitForTransactionReceipt({ hash: h });
  return h;
}

for (const t of TARGETS) {
  const want = parseEther((t.eth * scale).toFixed(6));
  const have = await client.getBalance({ address: t.address });
  if (have < want / 2n) {
    const h = await send(deployer.sendTransaction({ to: t.address, value: want - have }));
    console.log(`[fund] ${t.name} ${t.address}: +${formatEther(want - have)} ETH (${h})`);
  }
  if (t.mint && t.key && t.router) {
    for (const [sym, amount] of Object.entries(t.mint) as Array<["tETH" | "tUSDG", string]>) {
      const token = d.tokens[sym];
      const target = parseUnits(amount, token.decimals);
      const bal = await client.readContract({ address: token.address, abi: testTokenAbi, functionName: "balanceOf", args: [t.address] });
      if (bal < target / 2n) {
        const h = await send(deployer.writeContract({ address: token.address, abi: testTokenAbi, functionName: "mint", args: [t.address, target - bal] }));
        console.log(`[fund] ${t.name}: minted ${formatUnits(target - bal, token.decimals)} ${sym} (${h})`);
      }
      const allowance = await client.readContract({ address: token.address, abi: testTokenAbi, functionName: "allowance", args: [t.address, t.router] });
      if (allowance < maxUint256 / 2n) {
        const bot = liveWallet(t.key);
        const h = await send(bot.writeContract({ address: token.address, abi: testTokenAbi, functionName: "approve", args: [t.router, maxUint256] }));
        console.log(`[fund] ${t.name}: approved ${t.router} for ${sym} (${h})`);
      }
    }
  }
  console.log(`[fund] ${t.name} ${t.address} ready: ${formatEther(await client.getBalance({ address: t.address }))} ETH`);
}
console.log(`[fund] deployer ${deployer.account.address} left with ${formatEther(await client.getBalance({ address: deployer.account.address }))} ETH`);

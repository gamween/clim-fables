// A JSON-RPC endpoint in memory, for the read functions' tests: eth_blockNumber, eth_getBlockByNumber, eth_call (by
// exact calldata) and eth_getLogs (by address, block range and topic0). Unknown calls throw, so a test sees every
// request the code makes.
import {
  createPublicClient,
  custom,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  encodeFunctionResult,
  numberToHex,
  type Abi,
  type AbiEvent,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

export type FakeLog = { address: Address; topics: Hex[]; data: Hex; blockNumber: bigint; logIndex: number; transactionHash: Hex; blockTimestamp: bigint };

export function fakeLog(event: AbiEvent, args: Record<string, unknown>, meta: { address: Address; blockNumber: bigint; logIndex?: number; tx?: Hex; t: number }): FakeLog {
  const topics = encodeEventTopics({ abi: [event], eventName: event.name, args } as never) as Hex[];
  const nonIndexed = event.inputs.filter((i) => !i.indexed);
  const data = encodeAbiParameters(nonIndexed, nonIndexed.map((i) => args[i.name as string]));
  return { address: meta.address, topics, data, blockNumber: meta.blockNumber, logIndex: meta.logIndex ?? 0, transactionHash: meta.tx ?? `0x${"ab".repeat(32)}`, blockTimestamp: BigInt(meta.t) };
}

export class FakeRpc {
  head = 1000n;
  blockTime = (n: bigint) => Number(n) * 0.1;
  calls = new Map<string, Hex>();
  logs: FakeLog[] = [];
  requests: Array<{ method: string; params: unknown[] }> = [];
  getLogsRanges: Array<[bigint, bigint]> = [];

  onCall<const A extends Abi>(address: Address, abi: A, functionName: string, args: readonly unknown[], result: unknown) {
    const data = encodeFunctionData({ abi, functionName, args } as never);
    this.calls.set(`${address.toLowerCase()}:${data}`, encodeFunctionResult({ abi, functionName, result } as never));
  }

  async request({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> {
    const p = (params ?? []) as never[];
    this.requests.push({ method, params: p });
    switch (method) {
      case "eth_chainId":
        return "0x1";
      case "eth_blockNumber":
        return numberToHex(this.head);
      case "eth_getBlockByNumber": {
        const n = BigInt(p[0] as string);
        return block(n, this.blockTime(n));
      }
      case "eth_call": {
        const { to, data } = p[0] as { to: Address; data: Hex };
        const r = this.calls.get(`${to.toLowerCase()}:${data}`);
        if (r === undefined) throw new Error(`unexpected eth_call to ${to} ${data.slice(0, 10)}`);
        return r;
      }
      case "eth_getLogs": {
        const f = p[0] as { address: Address; fromBlock: Hex; toBlock: Hex; topics?: Array<Hex | Hex[] | null> };
        const from = BigInt(f.fromBlock);
        const to = BigInt(f.toBlock);
        this.getLogsRanges.push([from, to]);
        const t0 = f.topics?.[0];
        const t0s = t0 === undefined || t0 === null ? null : Array.isArray(t0) ? t0 : [t0];
        const t1 = f.topics?.[1] ?? null;
        return this.logs
          .filter((l) => l.address.toLowerCase() === f.address.toLowerCase() && l.blockNumber >= from && l.blockNumber <= to)
          .filter((l) => t0s === null || t0s.includes(l.topics[0] as Hex))
          .filter((l) => t1 === null || (Array.isArray(t1) ? t1 : [t1]).includes(l.topics[1] as Hex))
          .map((l) => ({
            address: l.address,
            topics: l.topics,
            data: l.data,
            blockNumber: numberToHex(l.blockNumber),
            blockHash: `0x${"11".repeat(32)}`,
            blockTimestamp: numberToHex(l.blockTimestamp),
            logIndex: numberToHex(l.logIndex),
            transactionHash: l.transactionHash,
            transactionIndex: "0x0",
            removed: false,
          }));
      }
      default:
        throw new Error(`unexpected ${method}`);
    }
  }

  client(): PublicClient {
    return createPublicClient({ transport: custom({ request: (a) => this.request(a) }) }) as PublicClient;
  }
}

function block(n: bigint, t: number) {
  return {
    number: numberToHex(n),
    hash: `0x${n.toString(16).padStart(64, "0")}`,
    parentHash: `0x${"00".repeat(32)}`,
    timestamp: numberToHex(BigInt(Math.floor(t))),
    nonce: "0x0000000000000000",
    difficulty: "0x0",
    gasLimit: "0x0",
    gasUsed: "0x0",
    miner: `0x${"00".repeat(20)}`,
    extraData: "0x",
    logsBloom: `0x${"00".repeat(256)}`,
    transactionsRoot: `0x${"00".repeat(32)}`,
    stateRoot: `0x${"00".repeat(32)}`,
    receiptsRoot: `0x${"00".repeat(32)}`,
    sha3Uncles: `0x${"00".repeat(32)}`,
    size: "0x0",
    totalDifficulty: "0x0",
    transactions: [],
    uncles: [],
  };
}

"use client";
import type { PublicClient } from "viem";
import { Skeleton } from "@/components/ui/kit";
import type { History } from "@/hooks/useLogHistory";
import { usePoll } from "@/hooks/usePoll";
import { blockTimes } from "@/lib/chain/blockTimes";
import type { SwapRow } from "@/lib/chain/decode";
import { SwapsTable } from "./parts";

/** The newest `limit` swaps of a window, with their block times. */
export function RecentSwaps({ history, client, txUrl, limit = 10 }: { history: History<SwapRow> | null; client: () => PublicClient; txUrl: (tx: string) => string; limit?: number }) {
  const rows = history ? [...history.items].reverse().slice(0, limit) : [];
  const key = rows.map((r) => r.block.toString()).join(",");
  const times = usePoll(() => blockTimes(client(), rows.map((r) => r.block)), 30_000, key);
  if (!history) return <Skeleton width={300} />;
  return <SwapsTable swaps={rows} times={times.data} nowTs={history.toTs} txUrl={txUrl} />;
}

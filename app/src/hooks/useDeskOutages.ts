"use client";
import snapshot from "@/generated/outages.json";
import { testnetClient } from "@/lib/chain/clients";
import { readDeskReports } from "@/lib/chain/readClim";
import { laggedHead, withRetry } from "@/lib/chain/retry";
import { mergeOutages, type OutageSnapshot, type ShownOutage } from "@/lib/outages";
import { usePoll } from "./usePoll";

const SNAPSHOT = snapshot as OutageSnapshot;

/** The recorded windows, then the reports since the snapshot's last scanned block, read once a minute. */
export function useDeskOutages() {
  return usePoll<{ windows: ShownOutage[]; gapSec: number; scannedToBlock: number }>(
    async () => {
      const client = testnetClient();
      const head = laggedHead(await withRetry(() => client.getBlockNumber({ cacheTime: 0 })));
      const nowSec = Number((await withRetry(() => client.getBlock({ blockNumber: head }))).timestamp);
      const reports = await readDeskReports(client, BigInt(SNAPSHOT.scannedToBlock) + 1n, head);
      return { windows: mergeOutages(SNAPSHOT, reports.map((r) => ({ seq: r.seq, tObs: r.tObs })), nowSec), gapSec: SNAPSHOT.gapSec, scannedToBlock: SNAPSHOT.scannedToBlock };
    },
    60_000,
    "outages",
  );
}

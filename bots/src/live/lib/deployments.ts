// Loads shared/deployments/robinhood-testnet.json (plan 03 Task 12) through the shared parser.
import { parseLiveDeployments, type LiveDeployments } from "@clim/shared";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
export const LIVE_DEPLOYMENTS_PATH = join(REPO_ROOT, "shared", "deployments", "robinhood-testnet.json");

export function loadLiveDeployments(path: string = LIVE_DEPLOYMENTS_PATH): LiveDeployments {
  return parseLiveDeployments(JSON.parse(readFileSync(path, "utf8")));
}

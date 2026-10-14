#!/usr/bin/env bash
# The recorded fork run (simulation only). Usage: npm run demo:fork
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; source .env; set +a
: "${RH_MAINNET_RPC_URL:?set RH_MAINNET_RPC_URL (archive RPC) in contracts/.env}"
BLOCK=$(jq -r .forkBlock ../docs/evidence/fork-reports-2026-10-07.json)
forge script script/v2/ForkRun.s.sol:ForkRun --fork-url "$RH_MAINNET_RPC_URL" --fork-block-number "$BLOCK" -vv
jq '{sigmaEstimator, etaE4, pokes: (.pokedPips | length), minPokedPips: (.pokedPips | min), maxPokedPips: (.pokedPips | max), swaps: (.swapFeePips | length), swapReverts}' \
  ../docs/evidence/fork-run-2026-10-07.json

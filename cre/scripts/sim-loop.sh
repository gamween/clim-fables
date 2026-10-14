#!/usr/bin/env bash
# Runs the clim risk desk in local CRE simulation every INTERVAL seconds (default 30).
# Builds the WASM once, then reuses it with --wasm, so runs do not recompile.
# Usage (from cre/): [ENV_FILE=.env.replay] [CRE_BIN=/absolute/path/to/cre] scripts/sim-loop.sh <target> [--broadcast]
# ENV_FILE: the .env file holding CRE_ETH_PRIVATE_KEY, passed to the CLI as -e (unset: the CLI's own cre/.env).
# CRE_BIN: the CRE CLI to run (unset: `cre` from PATH); the launchd desk job passes the absolute path (plan 03 Task 23).
# The replay desk has its own operator key in cre/.env.replay (plan 01 Task 18).
# Output: full log in cre/logs/, USER LOG lines echoed to the terminal. Stop with Ctrl+C.
set -euo pipefail
cd "$(dirname "$0")/.."
# The CLI prints local time labeled "Z" (friction row 19): run it in UTC so transcripts match block times.
export TZ=UTC
TARGET="${1:?usage: scripts/sim-loop.sh <target> [--broadcast]}"
BROADCAST="${2:-}"
INTERVAL="${INTERVAL:-30}"
ENV_FILE="${ENV_FILE:-}"
CRE="${CRE_BIN:-cre}"
# Absolute path: simulate resolves a relative --wasm from the workflow folder (risk-desk/), build -o from here.
WASM="$PWD/risk-desk/binary.wasm"
mkdir -p logs
LOG="logs/sim-$(date -u +%Y%m%dT%H%M%SZ)-${TARGET}${BROADCAST:+-broadcast}.log"
"$CRE" workflow build ./risk-desk -o "$WASM"
echo "target=${TARGET} broadcast=${BROADCAST:-no} env=${ENV_FILE:-.env} interval=${INTERVAL}s cre=${CRE} log=${LOG}"
while true; do
  START=$(date +%s)
  echo "=== $(date -u +%FT%TZ)" | tee -a "$LOG"
  "$CRE" workflow simulate risk-desk --wasm "$WASM" --non-interactive --trigger-index 0 \
    --target "$TARGET" ${BROADCAST} ${ENV_FILE:+-e "$ENV_FILE"} 2>&1 | tee -a "$LOG" | grep -E "USER LOG|rror|✗" || true
  ELAPSED=$(( $(date +%s) - START ))
  if (( ELAPSED < INTERVAL )); then sleep $(( INTERVAL - ELAPSED )); fi
done

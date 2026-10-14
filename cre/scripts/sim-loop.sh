#!/usr/bin/env bash
# Runs the clim risk desk in local CRE simulation, one report every INTERVAL seconds (default 30).
# Builds the WASM once, then reuses it with --wasm, so runs do not recompile.
# Usage (from cre/): [ENV_FILE=.env.replay] [CRE_BIN=/absolute/path/to/cre] scripts/sim-loop.sh <target> [--broadcast]
# ENV_FILE: the .env file holding CRE_ETH_PRIVATE_KEY, passed to the CLI as -e (unset: the CLI's own cre/.env).
# CRE_BIN: the CRE CLI to run (unset: `cre` from PATH); the launchd desk job passes the absolute path (plan 03 Task 23).
# The replay desk has its own operator key in cre/.env.replay (plan 01 Task 18).
# Output: full log in cre/logs/, USER LOG lines echoed to the terminal. Stop with Ctrl+C.
# Pacing: a report's tObs is the clock when the simulator fires the trigger, after the CLI's start-up (1 s on an idle
# Mac; 1 to 39 s measured on 2026-10-14 under load), and the desk rejects a tObs less than MIN_GAP (20 s) after the
# last one. So the next run starts INTERVAL after the last report's tObs minus the median start-up of the last five
# runs, never less than MIN_GAP + 2 s after that tObs: a fast start after a slow one can no longer fall inside MIN_GAP.

# RiskDeskV2.MIN_GAP (contracts/src/v2/RiskDeskV2.sol; the workflow skips such a report before sending it).
MIN_GAP=20

# anchor_tobs <file of the run's USER LOG lines>: the tObs the next report must clear. The run's own tObs if it sent a
# report, else the desk's last tObs as the run read it; nothing if the run printed neither.
anchor_tobs() {
  if grep -q "Write report transaction succeeded" "$1"; then
    sed -nE 's/.*consensus: .* tObs=([0-9]+).*/\1/p' "$1" | tail -n 1
  else
    sed -nE 's/.*desk before: seq=[0-9]+ tObs=([0-9]+).*/\1/p' "$1" | tail -n 1
  fi
}

# startup_sec <run start, epoch s> <file>: the run's tObs minus its start (nothing without a consensus line).
startup_sec() {
  local t
  t=$(sed -nE 's/.*consensus: .* tObs=([0-9]+).*/\1/p' "$2" | tail -n 1)
  if [[ -n "$t" ]]; then echo $(( t - $1 )); fi
}

# median_of <n>...: the median (the lower one of an even count); nothing for no argument.
median_of() {
  if (( $# > 0 )); then printf '%s\n' "$@" | sort -n | awk '{ v[NR] = $1 } END { print v[int((NR + 1) / 2)] }'; fi
}

# next_start <run start> <anchor tObs or ""> <lead> <interval> <min gap>: when the next run starts (epoch s).
# anchor + interval - lead, the lead capped to [0, interval - min gap - 2], so the next tObs (never before its run's start)
# is at least min gap + 2 s after the anchor. Without an anchor: interval after this run's start.
next_start() {
  local start=$1 anchor=$2 lead=$3 interval=$4 min_gap=$5 max_lead
  if [[ -z "$anchor" ]]; then echo $(( start + interval )); return; fi
  max_lead=$(( interval - min_gap - 2 ))
  if (( max_lead < 0 )); then max_lead=0; fi
  if (( lead > max_lead )); then lead=$max_lead; fi
  if (( lead < 0 )); then lead=0; fi
  echo $(( anchor + interval - lead ))
}

main() {
  set -euo pipefail
  cd "$(dirname "$0")/.."
  # The CLI prints local time labeled "Z" (friction row 19): run it in UTC so transcripts match block times.
  export TZ=UTC
  local TARGET="${1:?usage: scripts/sim-loop.sh <target> [--broadcast]}"
  local BROADCAST="${2:-}"
  local INTERVAL="${INTERVAL:-30}"
  local ENV_FILE="${ENV_FILE:-}"
  local CRE="${CRE_BIN:-cre}"
  # Absolute path: simulate resolves a relative --wasm from the workflow folder (risk-desk/), build -o from here.
  local WASM="$PWD/risk-desk/binary.wasm"
  mkdir -p logs
  local LOG="logs/sim-$(date -u +%Y%m%dT%H%M%SZ)-${TARGET}${BROADCAST:+-broadcast}.log"
  local RUN
  RUN=$(mktemp -t sim-loop)
  trap 'rm -f "$RUN"' EXIT
  "$CRE" workflow build ./risk-desk -o "$WASM"
  echo "target=${TARGET} broadcast=${BROADCAST:-no} env=${ENV_FILE:-.env} interval=${INTERVAL}s cre=${CRE} log=${LOG}"
  local START ANCHOR UP LEAD NEXT WAIT STARTUPS=""
  while true; do
    START=$(date +%s)
    echo "=== $(date -u +%FT%TZ)" | tee -a "$LOG"
    "$CRE" workflow simulate risk-desk --wasm "$WASM" --non-interactive --trigger-index 0 \
      --target "$TARGET" ${BROADCAST} ${ENV_FILE:+-e "$ENV_FILE"} 2>&1 | tee -a "$LOG" | grep -E "USER LOG|rror|✗" | tee "$RUN" || true
    ANCHOR=$(anchor_tobs "$RUN")
    UP=$(startup_sec "$START" "$RUN")
    if [[ -n "$UP" ]]; then STARTUPS=$(echo $STARTUPS "$UP" | awk '{ for (i = (NF > 5 ? NF - 4 : 1); i <= NF; i++) printf "%s ", $i }'); fi
    LEAD=$(median_of $STARTUPS)
    NEXT=$(next_start "$START" "$ANCHOR" "${LEAD:-0}" "$INTERVAL" "$MIN_GAP")
    echo "pace: tObs ${ANCHOR:-unknown}, start-up ${UP:-unknown} s (median ${LEAD:-0} s), next run $(date -u -r "$NEXT" +%FT%TZ)" | tee -a "$LOG"
    WAIT=$(( NEXT - $(date +%s) ))
    if (( WAIT > 0 )); then sleep "$WAIT"; fi
  done
}

# Run the loop when executed; sourcing only defines the functions above (cre/risk-desk/sim-loop.test.ts).
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi

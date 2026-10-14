#!/usr/bin/env bash
# Verifies every contract of shared/deployments/robinhood-testnet.json on Sourcify and on the Robinhood Chain testnet
# Blockscout (https://explorer.testnet.chain.robinhood.com), with the constructor arguments recorded at deployment.
# Usage: contracts/script/v2/verify-live.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DEP=../shared/deployments/robinhood-testnet.json
BLOCKSCOUT=https://explorer.testnet.chain.robinhood.com/api/
FAILED=0
while read -r NAME ADDR ID ARGS; do
  echo "=== ${NAME} ${ADDR} (${ID##*:})"
  forge verify-contract "$ADDR" "$ID" --chain 46630 --constructor-args "$ARGS" --verifier sourcify --watch \
    || { echo "sourcify: ${NAME} FAILED"; FAILED=1; }
  forge verify-contract "$ADDR" "$ID" --chain 46630 --constructor-args "$ARGS" \
    --verifier blockscout --verifier-url "$BLOCKSCOUT" --watch \
    || { echo "blockscout: ${NAME} FAILED"; FAILED=1; }
done < <(jq -r '.verify | to_entries[] | "\(.key) \(.value.address) \(.value.contract) \(.value.args)"' "$DEP")
exit "$FAILED"

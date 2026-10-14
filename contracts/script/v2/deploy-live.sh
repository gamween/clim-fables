#!/usr/bin/env bash
# Deploys clim's live reference stack (plan 03): tokens and routers, AccessManager and PokeFeeHook, pools D/K/F with
# liquidity, RiskDeskV2 + ClimFeePolicy + ClimPoker with the roles, then writes shared/deployments/robinhood-testnet.json
# (chain 46630) or shared/deployments/anvil.json (a local fork run as chain 31337).
# Usage: contracts/script/v2/deploy-live.sh <rpc-url>     (FROM=12 resumes at step 12 after a failure)
# Env: PRIVATE_KEY (contracts/.env, loaded by forge), SIM_OPERATOR, RUNNER_ADDRESS, KEEPER_ADDRESS, INIT_ETH_USD;
#      optional LIQ_TETH (default 1000), MINT_TETH, MINT_TUSDG.
set -euo pipefail
cd "$(dirname "$0")/../.."
RPC="${1:?usage: script/v2/deploy-live.sh <rpc-url>}"
CHAIN=$(cast chain-id --rpc-url "$RPC")
if [ "$CHAIN" = "4663" ]; then
  echo "refusing: chain 4663 is Robinhood Chain mainnet" >&2
  exit 1
fi
: "${SIM_OPERATOR:?export SIM_OPERATOR (bun run live:keys --exports)}"
: "${RUNNER_ADDRESS:?export RUNNER_ADDRESS}"
: "${KEEPER_ADDRESS:?export KEEPER_ADDRESS}"
: "${INIT_ETH_USD:?export INIT_ETH_USD (whole dollars)}"
FROM="${FROM:-10}"
for step in 10_LiveTokens:LiveTokens 11_LiveAccessHook:LiveAccessHook 12_LivePools:LivePools 13_LiveDesk:LiveDesk; do
  n="${step%%_*}"
  if [ "$n" -lt "$FROM" ]; then continue; fi
  echo "=== chain ${CHAIN}: ${step%%:*}"
  forge script "script/v2/${step%%:*}.s.sol:${step##*:}" --rpc-url "$RPC" --broadcast --slow --gas-estimate-multiplier 200 -v
done
echo "=== chain ${CHAIN}: 14_LiveWriteDeployments"
forge script script/v2/14_LiveWriteDeployments.s.sol:LiveWriteDeployments --rpc-url "$RPC" -v
if [ "$CHAIN" = "46630" ]; then OUT=../shared/deployments/robinhood-testnet.json; else OUT=../shared/deployments/anvil.json; fi
jq '{chainId, hook, riskDesk, policy, poker, pools: (.pools | map_values(.poolId))}' "$OUT"

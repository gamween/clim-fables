#!/usr/bin/env bash
# Copies the ABIs that cre/, bots/ and app/ consume from Foundry artifacts to shared/abis/.
# Run from anywhere: contracts/script/export-abis.sh
set -euo pipefail
cd "$(dirname "$0")/.."
forge build >/dev/null
OUT=../shared/abis
mkdir -p "$OUT"
for artifact in \
  RiskDesk.sol/RiskDesk \
  IRiskDesk.sol/IRiskDesk \
  ClimHook.sol/ClimHook \
  RiskDeskV2.sol/RiskDeskV2 \
  IRiskDeskV2.sol/IRiskDeskV2 \
  ClimFeePolicy.sol/ClimFeePolicy \
  ClimPoker.sol/ClimPoker \
  PokeFeeHook.sol/PokeFeeHook \
  IOverrideFeeHook.sol/ISymmetricPokeHook \
  IOverrideFeeHook.sol/IDirectionalPokeHook \
  TestToken.sol/TestToken \
  TestTokenDecimals.sol/TestTokenDecimals \
  IPoolManager.sol/IPoolManager \
  IStateView.sol/IStateView \
  PoolSwapTest.sol/PoolSwapTest \
  PoolModifyLiquidityTest.sol/PoolModifyLiquidityTest; do
  name="${artifact##*/}"
  jq '.abi' "out/${artifact}.json" > "${OUT}/${name}.json"
  echo "${OUT}/${name}.json"
done

#!/usr/bin/env bash
# End-to-end smoke test of the live stack on a local anvil fork of Robinhood Chain testnet (chain 31337), after
# deploy-live.sh: one desk report through the MockKeystoneForwarder (as the CRE operator), ClimPoker.poke() (as the
# runner), one keeper poke on K (1,480 pips, 7,200 s), then a small swap each way on D, K and F, printing the fee each
# swap paid (the last field of PoolManager's Swap event). Fork only: it impersonates the stack's addresses.
# Usage: contracts/script/v2/live-smoke.sh [rpc-url, default http://127.0.0.1:8545]
set -euo pipefail
cd "$(dirname "$0")/../.."
RPC="${1:-http://127.0.0.1:8545}"
if [ "$(cast chain-id --rpc-url "$RPC")" != "31337" ]; then
  echo "live-smoke.sh runs on a local fork (chain 31337) only" >&2
  exit 1
fi
DEP=../shared/deployments/anvil.json
j() { jq -r "$1" "$DEP"; }
DESK=$(j .riskDesk); POLICY=$(j .policy); POKER=$(j .poker); HOOK=$(j .hook); FWD=$(j .cre.mockForwarder)
OP=$(j .cre.simOperator); RUNNER=$(j .roles.runner); KEEPER=$(j .roles.keeper); DEPLOYER=$(j .deployer)
ROUTER=$(j .uniswap.poolSwapTest); PM=$(j .uniswap.poolManager)
for A in "$OP" "$RUNNER" "$KEEPER" "$DEPLOYER"; do
  cast rpc anvil_impersonateAccount "$A" --rpc-url "$RPC" >/dev/null
  cast rpc anvil_setBalance "$A" 0x8AC7230489E80000 --rpc-url "$RPC" >/dev/null
done
send() { cast send "$@" --unlocked --rpc-url "$RPC" --json; }
gas() { cast to-dec "$(jq -r .gasUsed)"; }

NOW=$(cast block latest --field timestamp --rpc-url "$RPC")
REPORT=$(cast abi-encode "f(uint40,uint32,uint32,int32,uint16,uint8,uint16)" "$NOW" 85475 85475 1200 3 4 10000)
RAW=$(cast concat-hex "0x01$(printf '%0216d' 0)" "$REPORT")
echo "report gasUsed $(send "$FWD" "report(address,bytes,bytes,bytes[])" "$DESK" "$RAW" 0x "[]" --from "$OP" | gas)"
echo "desk state: $(cast call "$DESK" 'state()(uint40,uint32,uint32,int32,uint16,uint8,uint32)' --rpc-url "$RPC" | tr '\n' ' ')"
echo "policy quoteDirectional: $(cast call "$POLICY" 'quoteDirectional()(uint24,uint24,uint8)' --rpc-url "$RPC" | tr '\n' ' ')"
echo "poke gasUsed $(send "$POKER" "poke()" --from "$RUNNER" | gas)"
echo "keeper poke gasUsed $(send "$HOOK" "pokeFee(bytes32,uint24,uint40)" "$(j .pools.K.poolId)" 1480 7200 --from "$KEEPER" | gas)"

for T in "$(j .tokens.tETH.address)" "$(j .tokens.tUSDG.address)"; do
  send "$T" "approve(address,uint256)" "$ROUTER" "$(cast max-uint)" --from "$DEPLOYER" >/dev/null
done
SWAP_TOPIC=$(cast sig-event "Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)")
PM_LC=$(echo "$PM" | tr 'A-F' 'a-f')
if [ "$(j .pools.D.token0IsEth)" = "true" ]; then A0=-1000000000000000; A1=-2500000; else A0=-2500000; A1=-1000000000000000; fi
MIN=4295128740
MAX=1461446703485210103287273052203988822378723970341
swap_fee() { # $1 PoolKey tuple, $2 zeroForOne, $3 amountSpecified (negative: exact input), $4 price limit
  send "$ROUTER" "swap((address,address,uint24,int24,address),(bool,int256,uint160),(bool,bool),bytes)" \
    "$1" "($2,$3,$4)" "(false,false)" 0x --from "$DEPLOYER" |
    jq -r --arg pm "$PM_LC" --arg t "$SWAP_TOPIC" \
      '.logs[] | select((.address | ascii_downcase) == $pm and .topics[0] == $t) | .data' |
    python3 -c "import sys; print(int(sys.stdin.read().strip()[-64:], 16))"
}
for P in D K F; do
  KEY="($(j .pools.$P.key.currency0),$(j .pools.$P.key.currency1),$(j .pools.$P.key.fee),$(j .pools.$P.key.tickSpacing),$(j .pools.$P.key.hooks))"
  ID=$(j .pools.$P.poolId)
  F01=$(cast call "$HOOK" 'currentFee(bytes32,bool)(uint24)' "$ID" true --rpc-url "$RPC")
  F10=$(cast call "$HOOK" 'currentFee(bytes32,bool)(uint24)' "$ID" false --rpc-url "$RPC")
  echo "$P currentFee zeroForOne $F01 oneForZero $F10 | swap paid zeroForOne $(swap_fee "$KEY" true "$A0" "$MIN") oneForZero $(swap_fee "$KEY" false "$A1" "$MAX")"
done

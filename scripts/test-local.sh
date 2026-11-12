#!/usr/bin/env bash
# Runs the TypeScript test suites against a fresh local Anvil chain with the real contracts deployed
# (no mocked clients or stub RPCs). Starts Anvil on 5546 and stops it on exit.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=5546
RPC="http://127.0.0.1:$PORT"
anvil --port $PORT --chain-id 31337 --silent &
ANVIL=$!
trap 'kill $ANVIL 2>/dev/null || true' EXIT
for i in $(seq 1 30); do cast block-number --rpc-url $RPC >/dev/null 2>&1 && break; sleep 0.3; done
for a in $(node -e "const a=require('./deployments/accounts.json').addresses;console.log(Object.values(a).join(' '))"); do
  cast rpc anvil_setBalance "$a" 0x56BC75E2D63100000 --rpc-url $RPC >/dev/null
done
export XORV_NETWORK=test XORV_RPC=$RPC XORV_DEPLOYMENT=deployments/test.json
node scripts/deploy.ts >/dev/null
node scripts/setup-providers.ts >/dev/null
node scripts/gas-station.ts >/dev/null
echo "local chain ready: $(node -e "console.log(require('./deployments/test.json').contracts.market)")"
node --test --test-concurrency=1 packages/sdk/test/*.test.ts packages/eerc/test/*.test.ts packages/gateway/test/*.test.ts

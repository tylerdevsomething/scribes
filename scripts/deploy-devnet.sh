#!/usr/bin/env bash
# Deploys or upgrades the Scribes program with the dev key. Run inside WSL after scripts/build.sh.
#   bash scripts/deploy-devnet.sh            # devnet (RPC_DEVNET from .env, never printed)
#   bash scripts/deploy-devnet.sh localnet   # the local validator
# On an upgrade to a larger program, the program account is extended first.
set -euo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd "$(dirname "$0")/.."
if [ "${1:-devnet}" = localnet ]; then RPC=http://127.0.0.1:8899
else RPC=$(tr -d '\r' < .env | sed -n 's/^RPC_DEVNET=//p'); fi
[ -n "$RPC" ] || { echo "RPC_DEVNET missing from .env"; exit 1; }
KEY=/mnt/c/Users/Admin/scribes-keys/writer-dev.json
ID=$(solana address -k /mnt/c/Users/Admin/scribes-keys/program-scribes-2.json)
hide() { sed -E 's/api-key=[0-9a-f-]+/api-key=***/g'; }

if solana program show "$ID" --url "$RPC" >/dev/null 2>&1; then
  HAVE=$(solana program show "$ID" --url "$RPC" | sed -n 's/^Data Length: \([0-9]*\).*/\1/p')
  NEED=$(stat -c %s target/deploy/scribes.so)
  if [ "$NEED" -gt "$HAVE" ]; then
    echo "extending the program account by $((NEED - HAVE)) bytes"
    solana program extend "$ID" $((NEED - HAVE)) --url "$RPC" --keypair "$KEY" 2>&1 | hide
  fi
fi
solana program deploy --url "$RPC" --keypair "$KEY" \
  --program-id /mnt/c/Users/Admin/scribes-keys/program-scribes-2.json \
  --with-compute-unit-price 10000 target/deploy/scribes.so 2>&1 | hide

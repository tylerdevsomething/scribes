#!/usr/bin/env bash
# Deploys (or upgrades) the Scribes program on devnet with the dev key. Run inside WSL after scripts/build.sh.
# The RPC URL is read from .env (RPC_DEVNET) and never printed.
set -euo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd "$(dirname "$0")/.."
RPC=$(tr -d '\r' < .env | sed -n 's/^RPC_DEVNET=//p')
[ -n "$RPC" ] || { echo "RPC_DEVNET missing from .env"; exit 1; }
solana program deploy --url "$RPC" \
  --keypair /mnt/c/Users/Admin/scribes-keys/writer-dev.json \
  --program-id /mnt/c/Users/Admin/scribes-keys/program-scribes.json \
  --with-compute-unit-price 10000 target/deploy/scribes.so 2>&1 | sed -E 's/api-key=[0-9a-f-]+/api-key=***/g'

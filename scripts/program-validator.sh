#!/usr/bin/env bash
# A throwaway validator for the program checks (port 18999), with the Scribes program preloaded and the
# dev key as its upgrade authority. Separate from scripts/localnet.sh so its data is never touched.
# Run inside WSL, then: node tools/program-check.ts --rpc http://127.0.0.1:18999 --key <writer-dev.json>
set -euo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd "$(dirname "$0")/.."
AUTH=$(solana address -k /mnt/c/Users/Admin/scribes-keys/writer-dev.json)
exec solana-test-validator --reset --quiet --ledger /tmp/scribes-program-check \
  --rpc-port 18999 --faucet-port 19990 --gossip-port 18991 --dynamic-port-range 19100-19200 \
  --upgradeable-program E6BMZvTkKXnEF8dDfBBBmeBZptu2ZZUa66CJ1jvLpVmq target/deploy/scribes.so "$AUTH"

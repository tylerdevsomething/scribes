#!/usr/bin/env bash
# A throwaway validator for the program checks (port 18999), with the Scribes program preloaded (dev key
# as upgrade authority) and the ink program cloned from mainnet. Separate from scripts/localnet.sh so its
# data is never touched. Run inside WSL, then:
#   node tools/program-check.ts --rpc http://127.0.0.1:18999 --key <writer-dev.json>
set -euo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd "$(dirname "$0")/.."
AUTH=$(solana address -k /mnt/c/Users/Admin/scribes-keys/writer-dev.json)
exec solana-test-validator --reset --quiet --ledger /tmp/scribes-program-check \
  --rpc-port 18999 --faucet-port 19990 --gossip-port 18991 --dynamic-port-range 19100-19200 \
  --url https://api.mainnet-beta.solana.com \
  --clone-upgradeable-program noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV \
  --upgradeable-program E6BMZvTkKXnEF8dDfBBBmeBZptu2ZZUa66CJ1jvLpVmq target/deploy/scribes.so "$AUTH"

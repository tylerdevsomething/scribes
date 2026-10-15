#!/usr/bin/env bash
# Local validator with the ink program (SPL Noop) cloned from mainnet and the Scribes program preloaded
# (dev key as upgrade authority). Run inside WSL after scripts/build.sh.
# Keeps the whole transaction history: by default the validator purges old slots, and chunks live there.
set -euo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd "$(dirname "$0")/.."
AUTH=$(solana address -k /mnt/c/Users/Admin/scribes-keys/writer-dev.json)
exec solana-test-validator --reset --quiet --ledger /tmp/scribes-localnet --limit-ledger-size 500000000 \
  --url https://api.mainnet-beta.solana.com \
  --clone-upgradeable-program noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV \
  --upgradeable-program 6BRHHJARif6TZJKjuJr8k7vFTr9gUxp7C5KaGMZBRBRD target/deploy/scribes.so "$AUTH"

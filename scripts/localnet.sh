#!/usr/bin/env bash
# Local validator with the ink program (SPL Noop) cloned from mainnet. Run inside WSL.
# Keeps the whole transaction history: by default the validator purges old slots, and chunks live there.
set -euo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
exec solana-test-validator --reset --quiet --ledger /tmp/scribes-localnet --limit-ledger-size 500000000 \
  --url https://api.mainnet-beta.solana.com \
  --clone-upgradeable-program noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV

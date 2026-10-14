#!/usr/bin/env bash
# Local validator with the ink program (SPL Noop) cloned from mainnet. Run inside WSL.
set -euo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
exec solana-test-validator --reset --quiet --ledger /tmp/scribes-localnet \
  --url https://api.mainnet-beta.solana.com \
  --clone-upgradeable-program noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV

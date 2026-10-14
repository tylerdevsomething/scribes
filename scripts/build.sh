#!/usr/bin/env bash
# Builds the Scribes program. Run inside WSL from anywhere.
# The program keypair lives outside the repo; it is copied in for the build only.
set -euo pipefail
. "$HOME/.cargo/env"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd "$(dirname "$0")/.."
mkdir -p target/deploy
cp /mnt/c/Users/Admin/scribes-keys/program-scribes.json target/deploy/scribes-keypair.json
# Solana's platform tools bundle an older Cargo; resolve dependencies to versions it can build.
if [ ! -f Cargo.lock ]; then
  CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS=fallback cargo +stable generate-lockfile
  cargo +stable update -p blake3 --precise 1.5.5
fi
anchor build
ls -l target/deploy/*.so target/idl/*.json

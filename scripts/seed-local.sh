#!/usr/bin/env bash
# Fresh local chain with test data. Run from the repo root in Git Bash (Windows) or any POSIX shell.
#   bash scripts/seed-local.sh
# Needs a fresh local validator already running. Start it in its own long-running terminal, with its
# output in a file inside WSL (a closed pipe stalls it, and WSL stops background processes on exit):
#   wsl -d Ubuntu -- bash -c "bash /mnt/c/git/scribes/scripts/localnet.sh > /tmp/scribes-localnet.log 2>&1"
# Then seeds: airdrop, program settings, 2.5% sale fee, a stand-in test token (verification open), three scribes.
set -euo pipefail
K="${KEY:-$HOME/scribes-keys/writer-dev.json}"
R=http://127.0.0.1:8899
until curl -s -X POST $R -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getAccountInfo","params":["6BRHHJARif6TZJKjuJr8k7vFTr9gUxp7C5KaGMZBRBRD",{"encoding":"base64","dataSlice":{"offset":0,"length":0}}]}' 2>/dev/null | grep -q executable; do sleep 2; done
G=$(curl -s -X POST $R -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getGenesisHash"}' | sed -E 's/.*"result":"([^"]{12}).*/\1/')
find .cache/journal -mindepth 1 -maxdepth 1 -type d ! -name EtWTRABZaYq6 -exec rm -rf {} +  # old local journals (keep devnet's)
rm -rf .cache/indexer
cli() { node tools/cli.ts "$@" 2>&1 | grep -v bigint; }
cli airdrop --key "$K" --rpc $R --sol 100
cli init --key "$K" --rpc $R
cli market --key "$K" --rpc $R --fee-bps 250
cli test-token --key "$K" --rpc $R --burn 10
for p in mott wren; do cli inscribe --key "$K" --rpc $R --personality examples/$p.json --model .cache/models/stories260K.gguf --rps 300 | grep -E "born:|rror"; done
cli inscribe --key "$K" --rpc $R --personality examples/sable.json --bound anthropic:claude-opus-5-5 | grep -E "born:|rror"
echo "seeded local chain (genesis $G)"

# Scribes

Inscribe your agent on Solana. Every byte on-chain. Open it anywhere and it runs.

Work in progress — milestone 1: write a scribe's files to chain as chunk transactions, rebuild them,
check every hash, and run the agent in a browser.

| Path | What |
|---|---|
| `lib/src/chunk.ts` | Chunk format (one ~1 KB chunk per transaction) |
| `lib/src/chain.ts` | Writing files to chain and rebuilding them (only chunks signed by the file's writer count) |
| `lib/src/manifest.ts` | Manifest: every file with its hash, and the brain binding (inscribed or bound) |
| `lib/src/personality.ts` | Personality JSON and the system prompt built from it |
| `lib/src/gguf.ts` | GGUF reader and check (only real model files are run) |
| `tools/cli.ts` | `keygen`, `airdrop`, `inscribe`, `rebuild` |
| `tools/names-check.ts` | Banned-names check, run before every commit |

Requires Node ≥ 23.6 (runs TypeScript directly).

```sh
npm install
npm test
npm run typecheck
npm run names
```

Local validator (WSL): `bash scripts/localnet.sh`. Keys live outside the repo.

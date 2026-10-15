# Scribes

Inscribe your agent on Solana. Every byte on-chain. Open it anywhere and it runs.

Work in progress: inscribing, rebuilding and running scribes, the Scribes program, the indexer, and the
website (gallery, scribe pages with chat, one-signature inscribing) work on a local validator.

| Path | What |
|---|---|
| `lib/src/chunk.ts` | Chunk format (one ~1 KB chunk per transaction) |
| `lib/src/chain.ts` | Writing files to chain and rebuilding them (only chunks signed by the file's writer count) |
| `lib/src/manifest.ts` | Manifest: every file with its hash, and the brain binding (inscribed or bound) |
| `lib/src/personality.ts` | Personality JSON and the system prompt built from it |
| `lib/src/gguf.ts` | GGUF reader and check (only real model files are run) |
| `tools/cli.ts` | `keygen`, `airdrop`, `inscribe`, `rebuild` |
| `lib/src/rarity.ts` | Attributes in buckets, rarity scores and ranks (shared by indexer and site) |
| `lib/src/registry.ts` | Client for the Scribes program |
| `programs/scribes` | Anchor program: birth (owner + writer), Autograph and model royalty, verify (signed pass + token burn), give, market, bounties; no close |
| `indexer/src` | Follows the program, rebuilds and checks every scribe, ranks them; API; create flow (uploads → check → one-signature checkout → inscription) |
| `site/` | Website: gallery, scribe pages (wake: inscribed brain in the browser, or bound brain with your own key), inscribe, scribe brief |
| `tools/program-check.ts` | 23 program rules and refusals on a throwaway validator |
| `tools/create-check.ts` | The whole create flow as a new user |
| `tools/names-check.ts` | Banned-names check, run before every commit |

Requires Node ≥ 23.6 (runs TypeScript directly).

```sh
npm install
npm test
npm run typecheck
npm run names
```

Keys live outside the repo.

## Try it on a local validator

```sh
bash scripts/localnet.sh                       # in WSL: validator with the ink program cloned from mainnet
node tools/cli.ts keygen   --out <keys>/writer-dev.json
node tools/cli.ts airdrop  --key <keys>/writer-dev.json --rpc http://127.0.0.1:8899 --sol 100
node tools/cli.ts inscribe --key <keys>/writer-dev.json --rpc http://127.0.0.1:8899 \
  --personality examples/mott.json --model <model.gguf> --rps 200
node tools/cli.ts rebuild  --rpc http://127.0.0.1:8899 --link <scribe link>   # → .cache/files
npm run runner                                 # http://localhost:5175/#link=<scribe link>
```

Then the program, the server and the site:

```sh
bash scripts/build.sh                          # in WSL: build the program (scripts/localnet.sh preloads it)
node tools/cli.ts init --key <keys>/writer-dev.json --rpc http://127.0.0.1:8899
node indexer/src/main.ts --rpc http://127.0.0.1:8899 --writer <keys>/writer-dev.json   # :8790
npm run site                                   # http://localhost:5180
```

`inscribe` writes the personality, the model, the official runtime (wllama: llama.cpp compiled to
WASM) and the manifest, and prints the scribe link. Files already inscribed by the same writer are
skipped (journals in `.cache/journal`, so an interrupted run resumes).

The runner reads the manifest and personality straight from chain, takes the large files from the
cache or rebuilds them from chain ("Rebuild every file from chain"), refuses any file whose sha256
does not match the manifest, checks the model is a real GGUF, then starts the inscribed runtime.

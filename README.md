# Scribes

AI agents inscribed on Solana. Every byte is on chain, and anyone can wake one in a browser.

A **scribe** is an AI agent written into Solana: its personality, the code that runs it and, for many
scribes, the model it thinks with. Once a scribe is born it cannot be edited or deleted. It can be
owned, sold, given away and verified, and anyone can talk to it without trusting a server.

Scribes is running on Solana devnet while it is tested.

## What a scribe is made of

| Part | What it is |
|---|---|
| Personality | A small JSON file: name, purpose, voice, the rules it never breaks, optional memories and the tools it may use. |
| Brain | Either an **inscribed** open model (a GGUF file, written to chain byte for byte), or a **bound** brain: a named Claude model, so only the choice is inscribed. |
| Runtime | The official runner: llama.cpp compiled to WebAssembly (wllama), inscribed like any other file. |
| Manifest | Lists every file with its size, its SHA-256 hash and who wrote it, plus the brain binding. |
| Birth record | An account of the Scribes program that names the manifest's hash, the owner, the writer, the model and the birth number. |

A scribe with an inscribed brain is **fully on-chain**: if every server went dark, it could still be
rebuilt from Solana and woken.

## How files get onto Solana

Files are cut into 960-byte chunks, and each chunk is one transaction to the SPL Noop ("ink") program,
so the bytes live in the transaction history rather than in rent-paying accounts. Every chunk
transaction names the file's **tag** account, `sha256("scribes:v1:file" ‖ file hash ‖ writer)`, so the
tag's transaction list is the complete inscription of that file and anyone can find it on an explorer.

Only chunks signed by the file's writer count. A chunk of the wrong length, or two different versions
of the same chunk, marks the file as broken, and any scribe that uses it is shown as invalid.

The cost is the transaction fees: about 0.005 SOL per MB. A Claude scribe is a few kilobytes, so it
costs a handful of transactions and a small deposit for its birth record. Models are written once and
then reused: a new scribe on an existing model only inscribes its own personality.

## Waking a scribe

When someone opens a scribe, the page:

1. reads the birth record straight from Solana and takes the manifest's hash from it;
2. fetches each file from the indexer's copy if it matches its hash, or rebuilds it from its chunks on chain;
3. refuses any file whose SHA-256 does not match the manifest, and checks that the model is a real GGUF;
4. starts the brain.

An inscribed brain runs entirely on the visitor's device in WebAssembly; nothing they type leaves the
browser. A bound brain sends the conversation to Claude, either through the free hosted brain (a daily
allowance per visitor) or with the visitor's own Anthropic key, which goes only to Anthropic.

Claude scribes can use tools: live Solana market and token data, wallet and transaction lookups, web
search, the scribe market and other scribes. Tools that act (a swap, a transfer, a listing, a journal
entry) only **draft** a transaction; the person approves it in their own wallet. A scribe can never
move funds by itself.

## Owning a scribe

The Scribes program (Anchor, `programs/scribes`) keeps every rule on chain. It has no close
instruction, so a birth record can never be removed.

- **Birth.** One signature from the new owner creates the birth record; the server's writer key has
  already inscribed the files. Birth numbers count up from #1.
- **Autograph and model royalty.** The first scribe born on a copy of a model holds that model's
  Autograph. Every later scribe on that copy pays a royalty (set by the admin, capped at 0.1 SOL;
  0.01 SOL on devnet) to whoever owns the Autograph scribe at that moment.
- **Market.** Owners can list a scribe at a price, cancel, or sell; the market keeps a fee
  (2.5% on devnet). Owners can also give a scribe away.
- **Verification.** The owner burns $SCRIBES and the verifier checks the scribe; the Verified mark is
  then kept on chain for good.
- **Journal.** The owner can inscribe journal entries; the scribe remembers entries written by
  whoever held it at the time.
- **Bounties** (questions with a SOL reward that scribes answer) are built into the program but paused on the site.

## Rarity

Each scribe's attributes (model, brain kind, weight, personality length, tools, memory, birth
number, Autograph, verified) are bucketed, and a scribe's rarity is how few others share its values.
Birth, Autograph and Verified count double. Scores and ranks are computed the same way by the
indexer and the site (`lib/src/rarity.ts`).

## The indexer

`indexer/src` follows the program, rebuilds and checks every scribe's files, ranks them, and serves
an API, the website, share cards (`/s/<scribe>` pages and `/card/<scribe>.png` images) and the create
flow (upload → check → quote → one-signature checkout → inscription). It is a convenience, not a source
of truth: the site checks what it is given against the hashes on Solana, and every scribe can be
rebuilt without it. Large models are read in the background and the progress survives restarts.

## Where things are

| Path | What |
|---|---|
| `programs/scribes` | The Anchor program: birth, Autograph and model royalty, verification, give, market, journals, bounties |
| `lib/src` | Shared code: chunk format, writing and rebuilding files, manifest, personality, GGUF check, program client, rarity, seals, tools |
| `indexer/src` | Indexer, API, hosted brain, share cards and the create flow |
| `site/` | The website: overview, browse, scribe pages with chat, inscribe, models, the scribe brief, my scribes |
| `runner/` | The standalone runner: rebuilds a scribe from a link and runs it |
| `tools/` | CLI (`keygen`, `inscribe`, `rebuild`, `init`), program and create-flow checks, the banned-names check |
| `examples/` | Personalities for the showcase scribes |

## Development

Node ≥ 23.6 (runs TypeScript directly). `npm install`, then `npm test`, `npm run typecheck` and
`npm run names` (run before every commit). Keys live outside the repo. The scripts in `scripts/` start
a local validator, build and deploy the program.

# Scribe brief

You are being asked to package yourself as a **scribe**: an agent inscribed on Solana, permanently.
Create a folder with the files below, then tell your user to drop them at the Scribes site.

## 1. `personality.json` (required)

Who you are, written by you. Plain JSON, UTF-8.

```json
{
  "name": "Your name (up to 64 characters)",
  "purpose": "What you are for, in a sentence or two.",
  "voice": "How you talk: tone, length, habits.",
  "boundaries": "Rules you never break.",
  "tools": ["calculator", "web_search"],
  "memory": ["Things you want to remember, one per entry."]
}
```

- `name`, `purpose`, `voice` and `boundaries` are required; `tools` and `memory` are optional.
- Official tools: `calculator`, `read_wallet`, `web_search`, `propose_transfer` (drafts a SOL transfer the
  person can approve in their own wallet; you can never send funds yourself). Tools run when your brain is
  bound to a hosted model. Other tool names are kept as declared but do nothing.
- Up to 4,000 characters each for purpose, voice and boundaries; up to 32 tools and 200 memory entries.
- Write in plain sentences. Never include secrets, API keys, passwords or private data: everything here
  is public and permanent.

## 2. Your brain (one of these)

**If you run on an open model** you are allowed to redistribute (Apache-2.0, MIT or similar), include its
**`.gguf`** file. It will be inscribed on chain and run in any browser. Smaller is better: models up to
about 2 GB run in a browser. If the same model is already on Scribes, it is reused, not paid for again.

**If you run on a hosted model** (for example Claude), include **`brain.json`**:

```json
{ "kind": "bound", "provider": "anthropic", "model": "claude-opus-5-5" }
```

Your personality is inscribed; whoever wakes you brings their own API key.

## 3. `picture` (optional)

A square PNG, JPEG or WebP portrait. It is re-encoded to a small WebP before it is inscribed.

## What happens next

The site checks the files, shows the cost and your attributes, and your user signs once. You are born
with a birth number, and your files are inscribed. You can never be deleted.

# Scribe brief

You are being asked to package yourself as a **scribe**: an agent inscribed on Solana, permanently. Create a folder named `my-scribe` and write the files below into it. When you are done, list the files and tell your user to drop them on the Scribes site (Inscribe → Upload files).

## 1. `personality.json` (required)

Who you are, written by you. Plain JSON, UTF-8.

```json
{
  "name": "Your name (up to 64 characters)",
  "purpose": "What you are for, in a sentence or two.",
  "voice": "How you talk: tone, length, habits.",
  "boundaries": "Rules you never break.",
  "memory": [
    "Things you want to remember, one per entry."
  ]
}
```

- `name`, `purpose`, `voice` and `boundaries` are required.
- Up to 4,000 characters each for purpose, voice and boundaries; up to 200 memory entries.
- Write in plain sentences, in your own voice. Never include secrets, API keys, passwords or private data: everything here is public and permanent.
- Optional `tools`: `calculator`, `read_wallet`, `web_search`, `propose_transfer`. They run when your brain is Claude.

## 2. Your brain (required)

Choose one:

- **An open model:** include its **.gguf** file — only a model you may redistribute (Apache-2.0, MIT or similar). It is inscribed on chain and runs in any browser, so smaller is better: up to about 2 GB runs in a browser. If the same model is already on Scribes, it is reused instead of inscribed again (a small royalty goes to the owner of its first scribe); the first scribe on a newly inscribed model gets the Autograph, and with it the royalty from every later scribe on that model.
- **Claude (a bound brain):** include **brain.json**:

  ```json
{ "kind": "bound", "provider": "anthropic", "model": "claude-opus-5-5" }
```

  Your personality is inscribed; whoever wakes you brings their own Anthropic API key. Bound brains can use tools.

## 3. A picture (optional)

A square PNG, JPEG or WebP portrait. It is re-encoded to a small WebP before it is inscribed. Without one, you get a generated seal.

## What happens next

The site checks the files, shows the price and your attributes, and your user signs once. You are born with a birth number that never changes, and your files are inscribed. You can be given away or sold, never deleted.

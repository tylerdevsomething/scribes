// Scribes command line (devnet/localnet tooling for M1).
//
//   node tools/cli.ts keygen   --out <keypair.json>
//   node tools/cli.ts airdrop  --key <keypair.json> --rpc <url> [--sol 2]
//   node tools/cli.ts inscribe --key <keypair.json> --rpc <url> --personality <file.json>
//                              (--model <file.gguf> | --bound <provider>:<model>) [--rps 10] [--price 0] [--send-also <rpc,rpc>]
//   node tools/cli.ts rebuild  --link <scribes:v1:...> --rpc <url> [--out .cache/files]
//   node tools/cli.ts init     --key <upgrade authority.json> --rpc <url> [--verifier <pk>] [--fee-receiver <pk>] [--fee <lamports>] [--royalty 0.01]
//   node tools/cli.ts market   --key <admin.json> --rpc <url> --fee-bps 250
//   node tools/cli.ts test-token --key <admin.json> --rpc <url> [--burn 10] [--verifier <pk>] [--mint <existing mint> | --mint-authority <pk>] [--to <pk> --amount 100]   (not mainnet)
//   node tools/cli.ts give     --key <owner.json> --rpc <url> --scribe <address> --to <pk>
//   node tools/cli.ts handover --key <admin.json> --rpc <url> --admin <pk> [--fee-receiver <pk>]   (settings stay as they are otherwise)
//   (inscribe registers the scribe with the program at the end; --no-birth skips that)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { fileTag, readFile, writeFile } from '../lib/src/chain.ts';
import { chunkCount } from '../lib/src/chunk.ts';
import { sha256Hex } from '../lib/src/bytes.ts';
import { readGguf } from '../lib/src/gguf.ts';
import { decodeManifest, encodeManifest, formatLink, parseLink, type Brain, type FileRef, type Manifest, type Role } from '../lib/src/manifest.ts';
import { parsePersonality } from '../lib/src/personality.ts';
import { runtimeFiles } from '../indexer/src/runtime.ts';
import { ZERO_SHA, birthInstruction, giveInstruction, configAddress, marketAddress, readSettings, scribeAddress, scribesProgram, settingsArg } from '../lib/src/registry.ts';
import { TOKEN_2022_PROGRAM_ID, createMint, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';

function args(): Record<string, string> {
  const out: Record<string, string> = {};
  const a = process.argv.slice(3);
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith('--')) throw new Error(`unexpected argument ${a[i]}`);
    out[a[i].slice(2)] = a[i + 1]?.startsWith('--') || a[i + 1] === undefined ? 'true' : a[++i];
  }
  return out;
}
function need(a: Record<string, string>, k: string): string {
  if (!a[k] || a[k] === 'true') throw new Error(`--${k} is required`);
  return a[k];
}
function loadKey(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))));
}


const sol = (lamports: number) => (lamports / LAMPORTS_PER_SOL).toFixed(6);

// Chunks a file still needs, going by its journal (the fee check should not charge for what is already written).
async function chunksLeft(conn: Connection, key: Keypair, bytes: Uint8Array): Promise<number> {
  const path = `.cache/journal/${(await conn.getGenesisHash()).slice(0, 12)}/${key.publicKey.toBase58()}-${await sha256Hex(bytes)}.json`;
  const total = chunkCount(bytes.length);
  if (!existsSync(path)) return total;
  const j = JSON.parse(readFileSync(path, 'utf8'));
  return j.complete ? 0 : total - j.done.length;
}

async function inscribeOne(conn: Connection, key: Keypair, role: Role, name: string, bytes: Uint8Array, a: Record<string, string>): Promise<FileRef> {
  const sha = await sha256Hex(bytes);
  const ref: FileRef = { role, name, size: bytes.length, sha256: sha, writer: key.publicKey.toBase58() };
  // Journals are per network (genesis hash): a file on one network says nothing about another.
  const dir = `.cache/journal/${(await conn.getGenesisHash()).slice(0, 12)}`;
  mkdirSync(dir, { recursive: true });
  const journalPath = `${dir}/${ref.writer}-${sha}.json`;
  let journal = existsSync(journalPath) ? JSON.parse(readFileSync(journalPath, 'utf8')) : { done: [] as number[], complete: false };
  // A journal is only a shortcut: if the chain has nothing under this file's tag, start over.
  if (journal.done.length) {
    const seen = await conn.getSignaturesForAddress(await fileTag(sha, key.publicKey), { limit: 1 }, 'confirmed');
    if (!seen.length) journal = { done: [], complete: false };
  }
  const total = chunkCount(bytes.length);
  if (journal.complete) {
    console.log(`  ${name}: already inscribed (${total} chunks)`);
    return ref;
  }
  const done = new Set<number>(journal.done);
  const save = () => writeFileSync(journalPath, JSON.stringify({ done: [...done], complete: done.size === total }));
  const timer = setInterval(save, 5000);
  const t0 = Date.now();
  let last = 0;
  try {
    const r = await writeFile(conn, key, bytes, {
      rps: Number(a.rps ?? 10),
      microLamports: Number(a.price ?? 0),
      senders: (a['send-also'] ?? '').split(',').filter(Boolean).map((u) => new Connection(u, 'confirmed')),
      done,
      onProgress: (p) => {
        if (Date.now() - last < 2000 && p.done !== p.total) return;
        last = Date.now();
        const rate = (p.done - journal.done.length) / ((Date.now() - t0) / 1000);
        process.stdout.write(`\r  ${name}: ${p.done}/${p.total} chunks · ${p.inFlight} in flight · ${p.resent} resent · ${rate.toFixed(1)}/s   `);
      },
    });
    process.stdout.write('\n');
    console.log(`  ${name}: ${r.chunks} chunks in ${((Date.now() - t0) / 1000).toFixed(0)} s, ${r.resent} resent`);
  } finally {
    clearInterval(timer);
    save();
  }
  return ref;
}

async function main() {
  const cmd = process.argv[2];
  const a = args();
  if (cmd === 'keygen') {
    const out = need(a, 'out');
    if (existsSync(out)) throw new Error(`${out} already exists; refusing to overwrite a key`);
    const k = Keypair.generate();
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(Array.from(k.secretKey)));
    console.log(`new key ${k.publicKey.toBase58()} written to ${out}`);
  } else if (cmd === 'airdrop') {
    const conn = new Connection(need(a, 'rpc'), 'confirmed');
    const key = loadKey(need(a, 'key'));
    const sig = await conn.requestAirdrop(key.publicKey, Number(a.sol ?? 2) * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, 'confirmed');
    console.log(`balance ${sol(await conn.getBalance(key.publicKey))} SOL`);
  } else if (cmd === 'inscribe') {
    const conn = new Connection(need(a, 'rpc'), 'confirmed');
    const key = loadKey(need(a, 'key'));
    const personalityBytes = new Uint8Array(readFileSync(need(a, 'personality')));
    parsePersonality(new TextDecoder().decode(personalityBytes));

    const parts: { role: Role; name: string; bytes: Uint8Array }[] = [{ role: 'personality', name: 'personality.json', bytes: personalityBytes }];
    let brain: Brain;
    if (a.model) {
      const model = new Uint8Array(readFileSync(a.model));
      const info = readGguf(model);
      console.log(`model: ${info.name ?? basename(a.model)} · ${info.architecture} · ${(info.parameters / 1e6).toFixed(0)}M parameters`);
      parts.push({ role: 'model', name: basename(a.model), bytes: model });
      for (const r of runtimeFiles()) parts.push({ role: 'runtime', name: r.name, bytes: r.bytes });
      brain = { kind: 'inscribed', model: await sha256Hex(model) };
    } else {
      const [provider, ...rest] = need(a, 'bound').split(':');
      brain = { kind: 'bound', provider, model: rest.join(':') };
    }

    let chunks = 1;
    for (const p of parts) chunks += await chunksLeft(conn, key, p.bytes);
    const before = await conn.getBalance(key.publicKey);
    const fee = 5000 + Math.ceil((Number(a.price ?? 0) * 10_000) / 1e6);
    console.log(`writer ${key.publicKey.toBase58()} · balance ${sol(before)} SOL`);
    console.log(`about ${chunks} transactions left · about ${sol(chunks * fee)} SOL in fees`);
    if (before < chunks * fee) throw new Error('not enough SOL for the fees');

    const files: FileRef[] = [];
    for (const p of parts) files.push(await inscribeOne(conn, key, p.role, p.name, p.bytes, a));
    const manifest: Manifest = { format: 'scribes:v1:manifest', brain, files };
    const mbytes = encodeManifest(manifest);
    const mref = await inscribeOne(conn, key, 'personality', 'manifest.json', mbytes, a);
    const after = await conn.getBalance(key.publicKey);
    console.log(`spent ${sol(before - after)} SOL`);
    console.log(`\nscribe link: ${formatLink({ writer: mref.writer, sha256: mref.sha256, size: mref.size })}`);
    if (a['no-birth'] !== 'true') {
      const program = scribesProgram(conn);
      const scribe = scribeAddress(key.publicKey, mref.sha256);
      if (await conn.getAccountInfo(scribe)) {
        console.log(`scribe ${scribe.toBase58()} is already born`);
      } else {
        const ix = await birthInstruction(program, {
          owner: key.publicKey, writer: key.publicKey, manifestSha: mref.sha256, manifestSize: mref.size,
          modelSha: brain.kind === 'inscribed' ? brain.model : ZERO_SHA,
          modelWriter: brain.kind === 'inscribed' ? key.publicKey : null, // every file here is this key's
        });
        const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [key], { commitment: 'confirmed' });
        const s = await program.account.scribe.fetch(scribe);
        console.log(`born: scribe ${scribe.toBase58()} · #${s.birthNumber.toNumber() + 1}${s.autograph ? ' · Autograph' : ''} · ${sig}`);
      }
    }
  } else if (cmd === 'init') {
    const conn = new Connection(need(a, 'rpc'), 'confirmed');
    const key = loadKey(need(a, 'key'));
    const program = scribesProgram(conn);
    const programData = PublicKey.findProgramAddressSync([program.programId.toBuffer()], new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'))[0];
    const settings = settingsArg({
      admin: key.publicKey,
      verifier: new PublicKey(a.verifier ?? key.publicKey.toBase58()),
      feeReceiver: new PublicKey(a['fee-receiver'] ?? key.publicKey.toBase58()),
      birthFee: Number(a.fee ?? 0),
      burnMint: PublicKey.default,
      burnAmount: 0n,
      modelRoyalty: Math.round(Number(a.royalty ?? '0.01') * LAMPORTS_PER_SOL),
    });
    const ix = await program.methods.initialize(settings)
      .accountsPartial({ payer: key.publicKey, config: configAddress(), program: program.programId, programData }).instruction();
    const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [key], { commitment: 'confirmed' });
    console.log(`settings created: ${configAddress().toBase58()} · ${sig}`);
  } else if (cmd === 'market') {
    const conn = new Connection(need(a, 'rpc'), 'confirmed');
    const key = loadKey(need(a, 'key'));
    const program = scribesProgram(conn);
    const bps = Number(need(a, 'fee-bps'));
    const ix = await program.methods.setMarket(bps).accountsPartial({ admin: key.publicKey, config: configAddress(), market: marketAddress() }).instruction();
    const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [key], { commitment: 'confirmed' });
    console.log(`sale fee set to ${bps / 100}% · ${sig}`);
  } else if (cmd === 'test-token') {
    // A stand-in for $SCRIBE on localnet/devnet: a Token-2022 mint (6 decimals) the admin can mint,
    // set as the burn mint, so verification can be tested before the real token exists.
    const conn = new Connection(need(a, 'rpc'), 'confirmed');
    if ((await conn.getGenesisHash()) === '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') throw new Error('not on mainnet');
    const key = loadKey(need(a, 'key'));
    const program = scribesProgram(conn);
    const current = await readSettings(program);
    let mint: PublicKey;
    if (a.mint) mint = new PublicKey(a.mint); // an existing test token (e.g. after a redeploy)
    else if (current.burnMint) mint = new PublicKey(current.burnMint);
    else {
      mint = await createMint(conn, key, new PublicKey(a['mint-authority'] ?? key.publicKey.toBase58()), null, 6, undefined, { commitment: 'confirmed' }, TOKEN_2022_PROGRAM_ID); // --mint-authority: e.g. the hosted faucet's key
      console.log(`test token mint ${mint.toBase58()}`);
    }
    const burn = BigInt(a.burn ?? '10') * 1_000_000n;
    const settings = settingsArg({
      admin: key.publicKey, verifier: new PublicKey(a.verifier ?? current.verifier), feeReceiver: new PublicKey(current.feeReceiver),
      birthFee: current.birthFee, burnMint: mint, burnAmount: burn, modelRoyalty: current.modelRoyalty,
    });
    const ix = await program.methods.setSettings(settings).accountsPartial({ admin: key.publicKey, config: configAddress() }).instruction();
    await sendAndConfirmTransaction(conn, new Transaction().add(ix), [key], { commitment: 'confirmed' });
    console.log(`verification open: burns ${burn / 1_000_000n} test tokens · verifier ${a.verifier ?? current.verifier}`);
    if (a.to) {
      const ata = await getOrCreateAssociatedTokenAccount(conn, key, mint, new PublicKey(a.to), false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID);
      await mintTo(conn, key, mint, ata.address, key, BigInt(a.amount ?? '100') * 1_000_000n, [], { commitment: 'confirmed' }, TOKEN_2022_PROGRAM_ID);
      console.log(`minted ${a.amount ?? '100'} test tokens to ${a.to}`);
    }
  } else if (cmd === 'give') {
    const conn = new Connection(need(a, 'rpc'), 'confirmed');
    const key = loadKey(need(a, 'key'));
    const ix = await giveInstruction(scribesProgram(conn), key.publicKey, need(a, 'scribe'), new PublicKey(need(a, 'to')));
    const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [key], { commitment: 'confirmed' });
    console.log(`given to ${a.to} · ${sig}`);
  } else if (cmd === 'handover') {
    // Hands the settings to a new admin (e.g. a multisig); every other setting is kept as it is.
    const conn = new Connection(need(a, 'rpc'), 'confirmed');
    const key = loadKey(need(a, 'key'));
    const program = scribesProgram(conn);
    const c = await readSettings(program);
    const admin = new PublicKey(need(a, 'admin'));
    const settings = settingsArg({
      admin, verifier: new PublicKey(c.verifier), feeReceiver: new PublicKey(a['fee-receiver'] ?? c.feeReceiver),
      birthFee: c.birthFee, burnMint: c.burnMint ? new PublicKey(c.burnMint) : PublicKey.default, burnAmount: BigInt(c.burnAmount), modelRoyalty: c.modelRoyalty,
    });
    const ix = await program.methods.setSettings(settings).accountsPartial({ admin: key.publicKey, config: configAddress() }).instruction();
    const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [key], { commitment: 'confirmed' });
    console.log(`admin is now ${admin.toBase58()}${a['fee-receiver'] ? `, fees go to ${a['fee-receiver']}` : ''} · ${sig}`);
  } else if (cmd === 'rebuild') {
    const conn = new Connection(need(a, 'rpc'), 'confirmed');
    const link = parseLink(need(a, 'link'));
    const out = a.out ?? '.cache/files';
    mkdirSync(out, { recursive: true });
    const t0 = Date.now();
    const progress = (name: string) => (p: { done: number; total: number }) =>
      process.stdout.write(`\r  ${name}: ${p.done}/${p.total} chunks   `);
    const mbytes = await readFile(conn, link, { onProgress: progress('manifest') });
    process.stdout.write('\n');
    const manifest = decodeManifest(mbytes);
    writeFileSync(join(out, link.sha256), mbytes);
    for (const f of manifest.files) {
      const bytes = await readFile(conn, f, { concurrency: Number(a.concurrency ?? 8), onProgress: progress(f.name) });
      process.stdout.write('\n');
      if (f.role === 'model') readGguf(bytes);
      writeFileSync(join(out, f.sha256), bytes);
    }
    console.log(`rebuilt and checked ${manifest.files.length + 1} files in ${((Date.now() - t0) / 1000).toFixed(0)} s → ${out}`);
  } else {
    console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1).join('\n').split(/\n(?!\/\/)/)[0]);
    process.exit(cmd ? 1 : 0);
  }
}

// Exit explicitly: confirmation subscriptions keep a websocket open after the work is done.
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

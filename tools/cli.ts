// Scribes command line (devnet/localnet tooling for M1).
//
//   node tools/cli.ts keygen   --out <keypair.json>
//   node tools/cli.ts airdrop  --key <keypair.json> --rpc <url> [--sol 2]
//   node tools/cli.ts inscribe --key <keypair.json> --rpc <url> --personality <file.json>
//                              (--model <file.gguf> | --bound <provider>:<model>) [--rps 10] [--price 0]
//   node tools/cli.ts rebuild  --link <scribes:v1:...> --rpc <url> [--out .cache/files]
//   node tools/cli.ts init     --key <upgrade authority.json> --rpc <url> [--verifier <pk>] [--fee-receiver <pk>] [--fee <lamports>]
//   (inscribe registers the scribe with the program at the end; --no-birth skips that)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { fileTag, readFile, writeFile } from '../lib/src/chain.ts';
import { chunkCount } from '../lib/src/chunk.ts';
import { sha256Hex } from '../lib/src/bytes.ts';
import { readGguf } from '../lib/src/gguf.ts';
import { decodeManifest, encodeManifest, formatLink, parseLink, type Brain, type FileRef, type Manifest, type Role } from '../lib/src/manifest.ts';
import { parsePersonality } from '../lib/src/personality.ts';
import { ZERO_SHA, birthInstruction, configAddress, scribeAddress, scribesProgram, settingsArg } from '../lib/src/registry.ts';

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

// The official runtime: wllama (llama.cpp compiled to WASM), the exact files from the installed package.
function runtimeFiles(): { name: string; bytes: Uint8Array }[] {
  const require = createRequire(import.meta.url);
  const dir = join(dirname(require.resolve('@wllama/wllama/package.json')), 'esm');
  return [
    { name: 'wllama.js', bytes: new Uint8Array(readFileSync(join(dir, 'index.min.js'))) },
    { name: 'wllama.wasm', bytes: new Uint8Array(readFileSync(join(dir, 'wasm', 'wllama.wasm'))) },
  ];
}

const sol = (lamports: number) => (lamports / LAMPORTS_PER_SOL).toFixed(6);

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

    const chunks = parts.reduce((n, p) => n + chunkCount(p.bytes.length), 0) + 1;
    const before = await conn.getBalance(key.publicKey);
    const fee = 5000 + Math.ceil((Number(a.price ?? 0) * 10_000) / 1e6);
    console.log(`writer ${key.publicKey.toBase58()} · balance ${sol(before)} SOL`);
    console.log(`about ${chunks} transactions · about ${sol(chunks * fee)} SOL in fees`);
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
      const scribe = scribeAddress(mref.sha256);
      if (await conn.getAccountInfo(scribe)) {
        console.log(`scribe ${scribe.toBase58()} is already born`);
      } else {
        const ix = await birthInstruction(program, {
          owner: key.publicKey, writer: key.publicKey, manifestSha: mref.sha256, manifestSize: mref.size,
          modelSha: brain.kind === 'inscribed' ? brain.model : ZERO_SHA,
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
    });
    const ix = await program.methods.initialize(settings)
      .accountsPartial({ payer: key.publicKey, config: configAddress(), program: program.programId, programData }).instruction();
    const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [key], { commitment: 'confirmed' });
    console.log(`settings created: ${configAddress().toBase58()} · ${sig}`);
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

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

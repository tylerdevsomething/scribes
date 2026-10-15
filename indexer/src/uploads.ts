// The create flow, server side: upload → bot checks → quote → one-signature checkout → inscription.
//
// The user signs one transaction: it pays the inscription cost to the server's writer and registers the
// scribe (birth), co-signed by the writer. Only once that transaction is confirmed does the server write
// the files. Files already on chain (the official runtime, a model someone inscribed before) are reused,
// not written or charged again.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { sha256Hex } from '../../lib/src/bytes.ts';
import { chunkCount } from '../../lib/src/chunk.ts';
import { writeFile, FileCollector } from '../../lib/src/chain.ts';
import { readGguf } from '../../lib/src/gguf.ts';
import { encodeManifest, formatLink, type Brain, type FileRef, type Manifest, type Role, decodeManifest } from '../../lib/src/manifest.ts';
import { parsePersonality, wordCount } from '../../lib/src/personality.ts';
import { birthInstruction, configAddress, modelRecord, scribeAddress, scribesProgram, ZERO_SHA } from '../../lib/src/registry.ts';
import { traits } from '../../lib/src/rarity.ts';
import type { Indexer } from './indexer.ts';

export const LIMITS: Record<string, number> = {
  personality: 64 * 1024,
  'model-ref': 64, // the sha256 of a model already on Scribes
  brain: 4 * 1024,
  picture: 8 * 1024 * 1024, // before re-encoding
  model: 2 * 1024 * 1024 * 1024,
};
const FEE_PER_CHUNK = 5000;
const SCRIBE_ACCOUNT_BYTES = 8 + 191; // discriminator + Scribe (programs/scribes)
const MODEL_RECORD_BYTES = 8 + 113; // discriminator + ModelMark: created by a model copy's first scribe
const PICTURE_MAX = 100 * 1024;

// A file of the new scribe. A reused file (already on chain) may have no bytes here, only its size.
interface Part { role: Role; name: string; size: number; bytes: Uint8Array | null; sha256: string; reusedFrom: string | null }

export interface Quote {
  chunks: number; // chunk transactions the server will send
  inscriptionLamports: number; // paid to the writer, covers those fees
  recordRentLamports: number; // the scribe's on-chain record (paid by the owner in the birth)
  birthFeeLamports: number;
  modelRecordRentLamports: number; // the model copy's record, for its first scribe (the Autograph)
  royaltyLamports: number; // to the owner of the model's Autograph scribe, for later scribes on it
  networkFeeLamports: number; // the checkout transaction itself (two signatures)
  totalLamports: number;
}

export interface CheckReport {
  ok: boolean;
  problems: string[];
  name: string | null;
  brain: Brain | null;
  files: { role: Role; name: string; size: number; sha256: string; reused: boolean }[];
  attributes: Record<string, string> | null;
  model: { name: string | null; architecture: string | null; parameters: number } | null;
  quote: Quote | null;
  link: string | null;
  scribe: string | null;
}

type Phase =
  | { phase: 'uploading' }
  | { phase: 'checked'; report: CheckReport }
  | { phase: 'awaiting-signature'; report: CheckReport; owner: string; tx: string; lastValid: number }
  | { phase: 'inscribing'; report: CheckReport; owner: string; done: number; total: number }
  | { phase: 'done'; report: CheckReport; owner: string; signature: string }
  | { phase: 'failed'; error: string };

export class Uploads {
  private dir: string;
  private sessions = new Map<string, Phase>();
  private queue: (() => Promise<void>)[] = [];
  private running = false;
  private conn: Connection;
  private writer: Keypair;
  private indexer: Indexer;
  private runtime: { name: string; bytes: Uint8Array }[];
  private rps: number;

  constructor(opts: { conn: Connection; writer: Keypair; indexer: Indexer; dir: string; runtime: { name: string; bytes: Uint8Array }[]; rps: number }) {
    this.conn = opts.conn;
    this.writer = opts.writer;
    this.indexer = opts.indexer;
    this.dir = opts.dir;
    this.runtime = opts.runtime;
    this.rps = opts.rps;
    mkdirSync(this.dir, { recursive: true });
    // Sessions survive restarts: a paid scribe that was mid-inscription carries on.
    for (const id of readdirSync(this.dir)) {
      const p = join(this.dir, id, 'session.json');
      if (!existsSync(p)) continue;
      const s = JSON.parse(readFileSync(p, 'utf8')) as Phase & { signature?: string };
      this.sessions.set(id, s);
      if (s.phase === 'inscribing') this.enqueue(() => this.inscribe(id, s.signature!));
    }
  }

  private set(id: string, s: Phase & { signature?: string }) {
    this.sessions.set(id, s);
    writeFileSync(join(this.dir, id, 'session.json'), JSON.stringify(s));
  }

  create(): string {
    const id = randomBytes(12).toString('hex');
    mkdirSync(join(this.dir, id), { recursive: true });
    this.set(id, { phase: 'uploading' });
    return id;
  }

  status(id: string): Phase | null { return this.sessions.get(id) ?? null; }

  private folder(id: string): string {
    if (!/^[0-9a-f]{24}$/.test(id) || !this.sessions.has(id)) throw new Error('no such upload');
    return join(this.dir, id);
  }

  put(id: string, role: string, name: string, bytes: Uint8Array) {
    const s = this.sessions.get(id);
    if (!s || (s.phase !== 'uploading' && s.phase !== 'checked')) throw new Error('this upload can no longer change');
    if (!(role in LIMITS)) throw new Error(`unknown part "${role}"`);
    if (bytes.length === 0 || bytes.length > LIMITS[role]) throw new Error(`${role} must be 1 byte to ${LIMITS[role]} bytes`);
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(name)) throw new Error('bad file name');
    const dir = this.folder(id);
    for (const f of readdirSync(dir)) if (f.startsWith(`${role}--`)) rmSync(join(dir, f)); // one file per part
    writeFileSync(join(dir, `${role}--${name}`), bytes);
    this.set(id, { phase: 'uploading' });
  }

  // Files the chain already has, by sha256: the writer who inscribed them completely.
  private async existing(sha: string, size: number): Promise<string | null> {
    const known = this.indexer.completeFile(sha);
    if (known) return known;
    // The server's own writer may have inscribed it without any scribe pointing at it yet (the runtime).
    const c = new FileCollector({ sha256: sha, size, writer: this.writer.publicKey.toBase58() });
    await c.poll(this.conn, { concurrency: 16 });
    return c.complete ? this.writer.publicKey.toBase58() : null;
  }

  async check(id: string): Promise<CheckReport> {
    const dir = this.folder(id);
    const problems: string[] = [];
    const parts: Part[] = [];
    const files = readdirSync(dir).map((f) => ({ role: f.split('--')[0], name: f.split('--').slice(1).join('--'), path: join(dir, f) }));
    const get = (role: string) => files.find((f) => f.role === role);

    // Personality (required).
    let name: string | null = null;
    let words = 0, tools = 0, memory = 0;
    const p = get('personality');
    if (!p) problems.push('Personality: missing (personality.json)');
    else {
      const bytes = new Uint8Array(readFileSync(p.path));
      try {
        const pers = parsePersonality(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        name = pers.name; words = wordCount(pers); tools = pers.tools?.length ?? 0; memory = pers.memory?.length ?? 0;
        parts.push({ role: 'personality', name: 'personality.json', size: bytes.length, bytes, sha256: await sha256Hex(bytes), reusedFrom: null });
      } catch (e) {
        problems.push(`Personality: ${(e as Error).message}`);
      }
    }

    // Brain: an inscribed model, or a binding to a hosted one.
    let brain: Brain | null = null;
    let model: CheckReport['model'] = null;
    const m = get('model'), b = get('brain'), ref = get('model-ref');
    if ([m, b, ref].filter(Boolean).length > 1) problems.push('Brain: give one of a model file, a model already on Scribes, or a brain binding');
    else if (ref) {
      // A model already on Scribes: nothing is uploaded or written, the manifest points at it.
      const sha = readFileSync(ref.path, 'utf8').trim();
      const known = this.indexer.models().find((x) => x.sha256 === sha);
      if (!known) problems.push('Model: that model is not on Scribes (or not complete yet)');
      else {
        model = { name: known.name, architecture: known.architecture, parameters: known.parameters };
        parts.push({ role: 'model', name: known.fileName, size: known.size, bytes: null, sha256: sha, reusedFrom: known.writer });
        for (const r of this.runtime) {
          const rsha = await sha256Hex(r.bytes);
          parts.push({ role: 'runtime', name: r.name, size: r.bytes.length, bytes: r.bytes, sha256: rsha, reusedFrom: await this.existing(rsha, r.bytes.length) });
        }
        brain = { kind: 'inscribed', model: sha };
      }
    } else if (m) {
      const bytes = new Uint8Array(readFileSync(m.path));
      try {
        const info = readGguf(bytes);
        model = { name: info.name, architecture: info.architecture, parameters: info.parameters };
        const sha = await sha256Hex(bytes);
        parts.push({ role: 'model', name: m.name.endsWith('.gguf') ? m.name : `${m.name}.gguf`, size: bytes.length, bytes, sha256: sha, reusedFrom: await this.existing(sha, bytes.length) });
        for (const r of this.runtime) {
          const rsha = await sha256Hex(r.bytes);
          parts.push({ role: 'runtime', name: r.name, size: r.bytes.length, bytes: r.bytes, sha256: rsha, reusedFrom: await this.existing(rsha, r.bytes.length) });
        }
        brain = { kind: 'inscribed', model: sha };
      } catch (e) {
        problems.push(`Model: ${(e as Error).message}`);
      }
    } else if (b) {
      try {
        const j = JSON.parse(readFileSync(b.path, 'utf8'));
        if (j.kind !== 'bound' || typeof j.provider !== 'string' || typeof j.model !== 'string') throw new Error('brain.json must be {"kind":"bound","provider":"…","model":"…"}');
        brain = { kind: 'bound', provider: j.provider, model: j.model };
      } catch (e) {
        problems.push(`Brain: ${(e as Error).message}`);
      }
    } else {
      problems.push('Brain: missing (a .gguf model, or brain.json binding a hosted model)');
    }

    // Picture (optional): decoded and re-encoded, so only plain pixels are ever inscribed.
    const pic = get('picture');
    if (pic) {
      try {
        let out = await sharp(readFileSync(pic.path), { limitInputPixels: 40_000_000 }).rotate().resize(512, 512, { fit: 'cover' }).webp({ quality: 80 }).toBuffer();
        for (let q = 70; out.length > PICTURE_MAX && q >= 30; q -= 10) {
          out = await sharp(out).resize(384, 384).webp({ quality: q }).toBuffer();
        }
        if (out.length > PICTURE_MAX) throw new Error('could not get it under 100 KB');
        const bytes = new Uint8Array(out);
        writeFileSync(join(dir, 'picture.webp'), bytes);
        parts.push({ role: 'picture', name: 'picture.webp', size: bytes.length, bytes, sha256: await sha256Hex(bytes), reusedFrom: null });
      } catch (e) {
        problems.push(`Picture: not a readable image (${(e as Error).message})`);
      }
    }

    const report: CheckReport = {
      ok: false, problems, name, brain, model, quote: null, link: null, scribe: null, attributes: null,
      files: parts.map((x) => ({ role: x.role, name: x.name, size: x.size, sha256: x.sha256, reused: x.reusedFrom !== null })),
    };
    if (problems.length || !brain) { this.set(id, { phase: 'checked', report }); return report; }

    // The manifest: every file with its writer (reused files keep the writer who inscribed them).
    const me = this.writer.publicKey.toBase58();
    const manifest: Manifest = {
      format: 'scribes:v1:manifest', brain,
      files: parts.map((x) => ({ role: x.role, name: x.name, size: x.size, sha256: x.sha256, writer: x.reusedFrom ?? me })),
    };
    const mbytes = encodeManifest(manifest);
    const msha = await sha256Hex(mbytes);
    if (await this.conn.getAccountInfo(scribeAddress(me, msha))) {
      problems.push('This exact scribe is already born');
      this.set(id, { phase: 'checked', report });
      return report;
    }
    writeFileSync(join(dir, 'manifest.json'), mbytes);

    const chunks = parts.filter((x) => !x.reusedFrom).reduce((n, x) => n + chunkCount(x.size), 0) + chunkCount(mbytes.length);
    const program = scribesProgram(this.conn);
    const config = await program.account.config.fetch(configAddress());
    const rent = await this.conn.getMinimumBalanceForRentExemption(SCRIBE_ACCOUNT_BYTES);
    // An inscribed model: the first scribe on this copy is its Autograph (and creates its record); later
    // ones pay the royalty to the Autograph's owner.
    const modelFile = brain.kind === 'inscribed' ? manifest.files.find((f) => f.sha256 === brain.model)! : null;
    const mark = modelFile ? await modelRecord(program, modelFile.sha256, modelFile.writer) : null;
    const autograph = !!modelFile && !mark;
    const markRent = autograph ? await this.conn.getMinimumBalanceForRentExemption(MODEL_RECORD_BYTES) : 0;
    const royalty = mark ? config.modelRoyalty.toNumber() : 0;
    const inscription = Math.ceil(chunks * FEE_PER_CHUNK * 1.1) + 10_000; // 10% for resends
    const birthFee = config.birthFee.toNumber();
    const network = 2 * 5000;
    report.quote = {
      chunks, inscriptionLamports: inscription, recordRentLamports: rent, birthFeeLamports: birthFee, modelRecordRentLamports: markRent,
      royaltyLamports: royalty, networkFeeLamports: network, totalLamports: inscription + rent + birthFee + markRent + royalty + network,
    };
    report.link = formatLink({ writer: me, sha256: msha, size: mbytes.length });
    report.scribe = scribeAddress(me, msha).toBase58();
    report.attributes = traits({
      address: report.scribe, birthNumber: config.births.toNumber(), autograph, verified: false,
      brain: brain.kind, model: brain.kind === 'inscribed' ? brain.model : `${brain.provider}:${brain.model}`,
      weightBytes: brain.kind === 'inscribed' ? parts.find((x) => x.role === 'model')!.size : null,
      personalityWords: words, tools, memory,
    });
    report.ok = true;
    this.set(id, { phase: 'checked', report });
    return report;
  }

  // Builds the one transaction the user signs: payment to the writer + birth (co-signed by the writer).
  async checkout(id: string, ownerKey: string): Promise<{ tx: string; scribe: string }> {
    const s = this.sessions.get(id);
    if (!s || s.phase !== 'checked' || !s.report.ok || !s.report.quote) throw new Error('check the upload first');
    const owner = new PublicKey(ownerKey);
    const dir = this.folder(id);
    const mbytes = new Uint8Array(readFileSync(join(dir, 'manifest.json')));
    const msha = await sha256Hex(mbytes);
    const brain = s.report.brain!;
    const manifest = decodeManifest(mbytes);
    const birth = await birthInstruction(scribesProgram(this.conn), {
      owner, writer: this.writer.publicKey, manifestSha: msha, manifestSize: mbytes.length,
      modelSha: brain.kind === 'inscribed' ? brain.model : ZERO_SHA,
      modelWriter: brain.kind === 'inscribed' ? manifest.files.find((f) => f.sha256 === brain.model)!.writer : null,
    });
    const { blockhash, lastValidBlockHeight } = await this.conn.getLatestBlockhash('confirmed');
    const tx = new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight })
      .add(SystemProgram.transfer({ fromPubkey: owner, toPubkey: this.writer.publicKey, lamports: s.report.quote.inscriptionLamports }))
      .add(birth);
    tx.partialSign(this.writer);
    const b64 = tx.serialize({ requireAllSignatures: false }).toString('base64');
    this.set(id, { phase: 'awaiting-signature', report: s.report, owner: ownerKey, tx: b64, lastValid: lastValidBlockHeight });
    return { tx: b64, scribe: s.report.scribe! };
  }

  // The user sent the signed transaction. Once it is confirmed on chain, the files are written.
  async submitted(id: string, signature: string): Promise<void> {
    const s = this.sessions.get(id);
    if (!s || s.phase !== 'awaiting-signature') throw new Error('nothing is waiting for a signature');
    const tx = await this.waitForTx(signature, s.lastValid);
    // It must be exactly the transaction we built: same payment, same birth.
    const expected = Transaction.from(Buffer.from(s.tx, 'base64')).compileMessage().serialize();
    const got = tx.transaction.message.serialize();
    if (!Buffer.from(got).equals(expected) || tx.meta?.err) throw new Error('that transaction is not this checkout');
    const total = s.report.quote!.chunks;
    this.set(id, { phase: 'inscribing', report: s.report, owner: s.owner, done: 0, total, signature });
    this.enqueue(() => this.inscribe(id, signature));
  }

  private async waitForTx(signature: string, lastValid: number) {
    for (;;) {
      const tx = await this.conn.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
      if (tx) return tx;
      if ((await this.conn.getBlockHeight('confirmed')) > lastValid) throw new Error('the transaction expired before it was confirmed');
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  private enqueue(job: () => Promise<void>) {
    this.queue.push(job);
    if (this.running) return;
    this.running = true;
    (async () => {
      while (this.queue.length) await this.queue.shift()!();
      this.running = false;
    })();
  }

  private async inscribe(id: string, signature: string) {
    const s = this.sessions.get(id);
    if (!s || s.phase !== 'inscribing') return;
    const dir = this.folder(id);
    try {
      const mbytes = new Uint8Array(readFileSync(join(dir, 'manifest.json')));
      const manifest = JSON.parse(new TextDecoder().decode(mbytes)) as Manifest;
      const me = this.writer.publicKey.toBase58();
      const byRole = (f: FileRef): Uint8Array => {
        if (f.role === 'runtime') return this.runtime.find((r) => r.name === f.name)!.bytes;
        const file = readdirSync(dir).find((x) => x.startsWith(`${f.role}--`))!;
        if (f.role === 'picture') return new Uint8Array(readFileSync(join(dir, 'picture.webp')));
        return new Uint8Array(readFileSync(join(dir, file)));
      };
      let base = 0;
      const writeOne = async (bytes: Uint8Array) => {
        await writeFile(this.conn, this.writer, bytes, {
          rps: this.rps,
          onProgress: (p) => this.sessions.set(id, { ...s, done: base + p.done }), // memory only; disk on phase changes
        });
        base += chunkCount(bytes.length);
      };
      for (const f of manifest.files) {
        if (f.writer !== me) continue; // reused from another writer
        if (await this.existing(f.sha256, f.size) === me) continue; // already written (resumed job)
        const bytes = byRole(f);
        if ((await sha256Hex(bytes)) !== f.sha256) throw new Error(`${f.name} changed since the check`);
        await writeOne(bytes);
      }
      await writeOne(mbytes);
      this.set(id, { phase: 'done', report: s.report, owner: s.owner, signature });
    } catch (e) {
      this.set(id, { phase: 'failed', error: (e as Error).message });
    }
  }


  // Uploads that never reached checkout are removed after a day.
  sweep() {
    const day = 24 * 3600 * 1000;
    for (const id of readdirSync(this.dir)) {
      const s = this.sessions.get(id);
      const p = join(this.dir, id);
      if (s && s.phase !== 'uploading' && s.phase !== 'checked') continue;
      if (Date.now() - statSync(p).mtimeMs > day) { rmSync(p, { recursive: true, force: true }); this.sessions.delete(id); }
    }
  }
}


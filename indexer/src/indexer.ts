// The indexer: follows the Scribes program, rebuilds every scribe's files from chain, reads their
// attributes and ranks them. Everything it serves can be recomputed by anyone from chain alone.
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Connection } from '@solana/web3.js';
import { FileCollector } from '../../lib/src/chain.ts';
import { decodeUtf8 } from '../../lib/src/bytes.ts';
import { decodeManifest, formatLink, type Manifest } from '../../lib/src/manifest.ts';
import { parsePersonality, wordCount, type Personality } from '../../lib/src/personality.ts';
import { readGguf, type GgufInfo } from '../../lib/src/gguf.ts';
import { rankAll, type Ranked, type ScribeFacts } from '../../lib/src/rarity.ts';
import { decodeJournal, journalTag } from '../../lib/src/journal.ts';
import { INK_PROGRAM } from '../../lib/src/chain.ts';
import { PublicKey } from '@solana/web3.js';
import { allListings, allScribes, marketFeeBps, scribesProgram, ZERO_SHA, type ListingRecord, type ScribeRecord } from '../../lib/src/registry.ts';

export type Status =
  | { state: 'inscribing'; done: number; total: number } // chunks found so far, over all files
  | { state: 'complete' }
  | { state: 'invalid'; reason: string }; // a file broke a rule (bad manifest, not a real model…)

export interface ScribeView extends ScribeRecord {
  link: string;
  status: Status;
  name: string | null;
  purpose: string | null;
  brain: Manifest['brain'] | null;
  model: { name: string | null; architecture: string | null; parameters: number; bytes: number } | null;
  files: Manifest['files'];
  rarity: Ranked | null;
  hidden: boolean;
  listing: { price: number; seller: string } | null; // only a live listing (its seller still owns the scribe)
  journal: JournalEntry[]; // entries signed by whoever owned the scribe at the time, oldest first
}

export interface JournalEntry { text: string; slot: number; signature: string; signer: string }

interface Entry {
  record: ScribeRecord;
  manifest: FileCollector;
  decoded: Manifest | null;
  files: Map<string, FileCollector>; // by sha256
  personality: Personality | null;
  gguf: GgufInfo | null;
  invalid: string | null;
}

export interface ModelInfo {
  sha256: string; size: number; writer: string; fileName: string;
  name: string | null; architecture: string | null; parameters: number;
  scribes: number; firstScribe: string;
}

export class Indexer {
  private entries = new Map<string, Entry>();
  private collectors = new Map<string, FileCollector>(); // shared: the same file under many scribes is read once
  private ranks = new Map<string, Ranked>();
  private hidden = new Set<string>();
  private listings = new Map<string, ListingRecord>();
  private journals = new Map<string, { newest?: string; raw: JournalEntry[] }>();
  private ownerAt: ((scribe: string, slot: number) => string | null) | null = null;
  feeBps: number | null = null;
  private conn: Connection;
  private cacheDir: string;
  syncedAt = 0;

  constructor(conn: Connection, cacheDir: string) {
    this.conn = conn;
    this.cacheDir = cacheDir;
    mkdirSync(join(cacheDir, 'files'), { recursive: true });
  }

  setHidden(list: string[]) { this.hidden = new Set(list); }
  setOwnerHistory(f: (scribe: string, slot: number) => string | null) { this.ownerAt = f; }

  private collector(ref: { sha256: string; size: number; writer: string }): FileCollector {
    const key = `${ref.writer}:${ref.sha256}`;
    let c = this.collectors.get(key);
    if (!c) { c = new FileCollector(ref); this.collectors.set(key, c); }
    return c;
  }

  filePath(sha: string): string { return join(this.cacheDir, 'files', sha); }

  // Loads a complete, checked file (from the disk cache if it is already there).
  private async load(c: FileCollector): Promise<Uint8Array> {
    const path = this.filePath(c.ref.sha256);
    if (existsSync(path)) {
      const b = new Uint8Array(readFileSync(path));
      if (b.length === c.ref.size) return b;
    }
    const b = await c.bytes();
    writeFileSync(path, b);
    return b;
  }

  // One pass: new scribes, progress on unfinished ones, then ranks.
  async sync(): Promise<void> {
    const program = scribesProgram(this.conn);
    const records = await allScribes(program);
    this.listings = new Map((await allListings(program)).map((l) => [l.scribe, l]));
    this.feeBps = await marketFeeBps(program);
    for (const r of records) {
      const e = this.entries.get(r.address);
      if (e) { e.record = r; continue; } // owner and verified can change
      this.entries.set(r.address, {
        record: r, manifest: this.collector({ sha256: r.manifestSha, size: r.manifestSize, writer: r.writer }),
        decoded: null, files: new Map(), personality: null, gguf: null, invalid: null,
      });
    }
    for (const e of this.entries.values()) {
      if (e.invalid) continue;
      try {
        await this.advance(e);
      } catch (err) {
        e.invalid = (err as Error).message;
      }
    }
    for (const e of this.entries.values()) {
      if (e.invalid) continue;
      try { await this.syncJournal(e.record.address); } catch { /* try again next pass */ }
    }
    this.rank();
    this.syncedAt = Date.now();
  }

  // New journal entries for one scribe (only transactions newer than the last pass are read).
  private async syncJournal(address: string): Promise<void> {
    const j = this.journals.get(address) ?? { raw: [] };
    this.journals.set(address, j);
    const tag = await journalTag(new PublicKey(address));
    const sigs = await this.conn.getSignaturesForAddress(tag, { until: j.newest, limit: 1000 }, 'confirmed');
    if (!sigs.length) return;
    for (const s of [...sigs].reverse()) {
      if (s.err) continue;
      const tx = await this.conn.getTransaction(s.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
      if (!tx || tx.meta?.err) continue;
      const keys = tx.transaction.message.staticAccountKeys;
      for (const ix of tx.transaction.message.compiledInstructions) {
        if (!keys[ix.programIdIndex]?.equals(INK_PROGRAM) || !ix.accountKeyIndexes.some((k) => keys[k]?.equals(tag))) continue;
        const text = decodeJournal(ix.data);
        if (text) j.raw.push({ text, slot: s.slot, signature: s.signature, signer: keys[0].toBase58() });
      }
    }
    j.newest = sigs[0].signature;
  }

  private journal(r: ScribeRecord): JournalEntry[] {
    const raw = this.journals.get(r.address)?.raw ?? [];
    // Only whoever held the scribe when the entry was written can teach it.
    return raw.filter((x) => x.signer === (this.ownerAt ? this.ownerAt(r.address, x.slot) : r.owner));
  }

  private async advance(e: Entry): Promise<void> {
    if (!e.decoded) {
      await e.manifest.poll(this.conn, { concurrency: 8 });
      if (!e.manifest.complete) return;
      const m = decodeManifest(await this.load(e.manifest));
      const model = m.brain.kind === 'inscribed' ? m.brain.model : ZERO_SHA;
      if (model !== e.record.modelSha) throw new Error('the manifest names a different model than the birth record');
      for (const f of m.files) e.files.set(f.sha256, this.collector(f));
      e.decoded = m;
    }
    for (const c of e.files.values()) {
      if (c.complete) continue;
      await c.poll(this.conn, { concurrency: 16 });
    }
    if (![...e.files.values()].every((c) => c.complete)) return;
    const m = e.decoded;
    if (!e.personality) {
      const p = m.files.find((f) => f.role === 'personality')!;
      e.personality = parsePersonality(decodeUtf8(await this.load(e.files.get(p.sha256)!)));
    }
    if (m.brain.kind === 'inscribed' && !e.gguf) {
      const model = m.brain.model;
      e.gguf = readGguf(await this.load(e.files.get(model)!)); // not a real model → invalid scribe
    }
    for (const c of e.files.values()) await this.load(c); // everything checked and cached
  }

  private facts(e: Entry): ScribeFacts | null {
    if (!e.decoded || !e.personality || e.invalid) return null;
    const m = e.decoded;
    if ([...e.files.values()].some((c) => !c.complete)) return null;
    const modelFile = m.brain.kind === 'inscribed' ? m.files.find((f) => f.sha256 === (m.brain as { model: string }).model) : null;
    return {
      address: e.record.address,
      birthNumber: e.record.birthNumber,
      autograph: e.record.autograph,
      verified: e.record.verified,
      brain: m.brain.kind,
      model: m.brain.kind === 'inscribed' ? m.brain.model : `${m.brain.provider}:${m.brain.model}`,
      weightBytes: modelFile ? modelFile.size : null,
      personalityWords: wordCount(e.personality),
      tools: e.personality.tools?.length ?? 0,
      memory: e.personality.memory?.length ?? 0,
    };
  }

  private rank() {
    const facts = [...this.entries.values()].map((e) => this.facts(e)).filter((f): f is ScribeFacts => f !== null);
    this.ranks = rankAll(facts);
  }

  private view(e: Entry): ScribeView {
    const r = e.record;
    let status: Status;
    if (e.invalid) status = { state: 'invalid', reason: e.invalid };
    else if (this.ranks.has(r.address)) status = { state: 'complete' };
    else {
      const all = [e.manifest, ...e.files.values()];
      status = { state: 'inscribing', done: all.reduce((n, c) => n + c.found, 0), total: all.reduce((n, c) => n + c.total, 0) };
    }
    const modelFile = e.decoded?.brain.kind === 'inscribed' ? e.decoded.files.find((f) => f.sha256 === (e.decoded!.brain as { model: string }).model) : null;
    return {
      ...r,
      link: formatLink({ writer: r.writer, sha256: r.manifestSha, size: r.manifestSize }),
      status,
      name: e.personality?.name ?? null,
      purpose: e.personality?.purpose ?? null,
      brain: e.decoded?.brain ?? null,
      model: e.gguf && modelFile ? { name: e.gguf.name, architecture: e.gguf.architecture, parameters: e.gguf.parameters, bytes: modelFile.size } : null,
      files: e.decoded?.files ?? [],
      rarity: this.ranks.get(r.address) ?? null,
      hidden: this.hidden.has(r.address),
      listing: this.liveListing(r),
      journal: this.journal(r),
    };
  }

  private liveListing(r: ScribeRecord): ScribeView['listing'] {
    const l = this.listings.get(r.address);
    return l && l.seller === r.owner ? { price: l.price, seller: l.seller } : null;
  }

  list(): ScribeView[] {
    return [...this.entries.values()].map((e) => this.view(e)).sort((a, b) => a.birthNumber - b.birthNumber);
  }

  get(address: string): ScribeView | null {
    const e = this.entries.get(address);
    return e ? this.view(e) : null;
  }

  // The scribe's parsed personality, once its files are complete.
  personality(address: string): Personality | null {
    return this.entries.get(address)?.personality ?? null;
  }

  // Every model inscribed completely by some valid scribe, with how many scribes use it (for reuse).
  models(): ModelInfo[] {
    const out = new Map<string, ModelInfo>();
    for (const e of [...this.entries.values()].sort((a, b) => a.record.birthNumber - b.record.birthNumber)) {
      if (e.invalid || !e.decoded || !e.gguf || e.decoded.brain.kind !== 'inscribed') continue;
      const sha = e.decoded.brain.model;
      const f = e.decoded.files.find((x) => x.sha256 === sha)!;
      if (!e.files.get(sha)?.complete) continue;
      const m = out.get(sha);
      if (m) { m.scribes++; continue; }
      out.set(sha, {
        sha256: sha, size: f.size, writer: f.writer, fileName: f.name,
        name: e.gguf.name, architecture: e.gguf.architecture, parameters: e.gguf.parameters,
        scribes: 1, firstScribe: e.record.address,
      });
    }
    return [...out.values()].sort((a, b) => b.scribes - a.scribes);
  }

  // The writer of a complete, checked copy of this file on chain, if any (so uploads can reuse it).
  completeFile(sha: string): string | null {
    for (const c of this.collectors.values()) if (c.ref.sha256 === sha && c.complete) return c.ref.writer;
    return null;
  }

  // A file is served only if it belongs to a valid, complete scribe that is not hidden.
  servable(sha: string): boolean {
    for (const e of this.entries.values()) {
      if (e.invalid || this.hidden.has(e.record.address) || !this.ranks.has(e.record.address)) continue;
      if (e.record.manifestSha === sha || e.decoded?.files.some((f) => f.sha256 === sha)) return true;
    }
    return false;
  }
}

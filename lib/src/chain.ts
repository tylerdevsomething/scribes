// Writing files to Solana as chunk transactions, and reading them back.
//
// Each chunk is one instruction to the ink program (SPL Noop for now: it accepts any bytes and does
// nothing). The instruction names the file's tag as a read-only account, so every chunk of a file can
// be listed with getSignaturesForAddress(tag). Only chunks signed by the file's writer count: anyone
// can name a tag, nobody else can sign as its writer.
import {
  ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
  type Commitment, type TransactionSignature,
} from '@solana/web3.js';
import { concat, fromHex, sha256, sha256Hex, utf8 } from './bytes.ts';
import { CHUNK_BYTES, chunkCount, chunkSlice, decodeChunk, encodeChunk } from './chunk.ts';

export const INK_PROGRAM = new PublicKey('noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV');
export const CHUNK_COMPUTE_UNITS = 10_000;

export async function fileTag(sha256hex: string, writer: PublicKey): Promise<PublicKey> {
  return new PublicKey(await sha256(concat(utf8.encode('scribes:v1:file'), fromHex(sha256hex), writer.toBytes())));
}

export function chunkTransaction(opts: {
  writer: PublicKey; tag: PublicKey; index: number; bytes: Uint8Array; blockhash: string;
  microLamports: number; program?: PublicKey;
}): Transaction {
  const tx = new Transaction({ feePayer: opts.writer, recentBlockhash: opts.blockhash });
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: CHUNK_COMPUTE_UNITS }));
  if (opts.microLamports > 0) tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: opts.microLamports }));
  tx.add(new TransactionInstruction({
    programId: opts.program ?? INK_PROGRAM,
    keys: [{ pubkey: opts.tag, isSigner: false, isWritable: false }],
    data: Buffer.from(encodeChunk(opts.index, opts.bytes)),
  }));
  return tx;
}

export interface Progress { done: number; total: number }

// ---- reading ----------------------------------------------------------------------------------

export interface ReadOptions {
  program?: PublicKey;
  concurrency?: number;
  commitment?: 'confirmed' | 'finalized';
  onProgress?: (p: Progress) => void;
}

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>, stop: () => boolean): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length && !stop()) await fn(items[next++]);
  }));
}

async function retry<T>(fn: () => Promise<T>, tries = 6): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
}

export interface FileRefLike { sha256: string; size: number; writer: string }

// Gathers one file's chunks from chain. poll() can be called again and again while the file is still
// being inscribed: each call only reads transactions newer than the last one it saw.
export class FileCollector {
  readonly ref: FileRefLike;
  readonly total: number;
  found = 0;
  private chunks: (Uint8Array | undefined)[];
  private newest: string | undefined;
  private writer: PublicKey;
  private tag: PublicKey | undefined;
  private program: PublicKey;

  constructor(ref: FileRefLike, program: PublicKey = INK_PROGRAM) {
    this.ref = ref;
    this.total = chunkCount(ref.size);
    this.chunks = new Array(this.total);
    this.writer = new PublicKey(ref.writer);
    this.program = program;
  }

  get complete(): boolean { return this.found === this.total; }

  async poll(conn: Connection, opts: { concurrency?: number; commitment?: 'confirmed' | 'finalized'; onProgress?: (p: Progress) => void } = {}): Promise<void> {
    if (this.complete) return;
    const commitment = opts.commitment ?? 'confirmed';
    this.tag ??= await fileTag(this.ref.sha256, this.writer);
    const tag = this.tag;
    const sigs: TransactionSignature[] = [];
    let top: string | undefined;
    for (let before: string | undefined; ;) {
      const page = await retry(() => conn.getSignaturesForAddress(tag, { before, until: this.newest, limit: 1000 }, commitment));
      top ??= page[0]?.signature;
      for (const s of page) if (!s.err) sigs.push(s.signature);
      if (page.length < 1000) break;
      before = page[page.length - 1].signature;
    }
    await pool(sigs, opts.concurrency ?? 8, async (sig) => {
      const tx = await retry(() => conn.getTransaction(sig, { commitment, maxSupportedTransactionVersion: 0 }));
      if (!tx || tx.meta?.err) return;
      const msg = tx.transaction.message;
      const keys = msg.staticAccountKeys;
      if (!keys[0].equals(this.writer)) return; // not signed by the writer: ignored
      for (const ix of msg.compiledInstructions) {
        if (!keys[ix.programIdIndex]?.equals(this.program)) continue;
        if (!ix.accountKeyIndexes.some((k) => keys[k]?.equals(tag))) continue;
        const c = decodeChunk(ix.data);
        if (!c || c.index >= this.total) continue;
        const want = c.index === this.total - 1 ? this.ref.size - c.index * CHUNK_BYTES : CHUNK_BYTES;
        if (c.bytes.length !== want) throw new Error(`chunk ${c.index} has the wrong length`);
        const have = this.chunks[c.index];
        if (have) {
          if (have.length !== c.bytes.length || have.some((v, i) => v !== c.bytes[i])) {
            throw new Error(`the writer signed two different versions of chunk ${c.index}`);
          }
          continue;
        }
        this.chunks[c.index] = c.bytes.slice();
        this.found++;
        opts.onProgress?.({ done: this.found, total: this.total });
      }
    }, () => this.complete);
    if (top) this.newest = top;
  }

  // The whole file, checked against its size and sha256.
  async bytes(): Promise<Uint8Array> {
    if (!this.complete) throw new Error(`only ${this.found} of ${this.total} chunks are on chain`);
    const file = concat(...(this.chunks as Uint8Array[]));
    if (file.length !== this.ref.size) throw new Error('rebuilt file has the wrong size');
    if ((await sha256Hex(file)) !== this.ref.sha256) throw new Error('rebuilt file does not match its sha256');
    return file;
  }
}

// Rebuilds a file from chain and checks it against its size and sha256.
export async function readFile(conn: Connection, ref: FileRefLike, opts: ReadOptions = {}): Promise<Uint8Array> {
  const c = new FileCollector(ref, opts.program);
  await c.poll(conn, opts);
  return c.bytes();
}

// ---- writing ----------------------------------------------------------------------------------

export interface WriteOptions {
  program?: PublicKey;
  rps?: number; // transactions sent per second
  maxInFlight?: number;
  microLamports?: number;
  done?: Set<number>; // chunk indices already confirmed (resume)
  onConfirmed?: (index: number) => void;
  onProgress?: (p: Progress & { inFlight: number; resent: number }) => void;
  commitment?: Commitment;
}

// Sends every chunk of a file and returns once each one is confirmed. A chunk whose transaction
// expires unconfirmed is sent again; a chunk confirmed twice is harmless (same bytes, same index).
export async function writeFile(conn: Connection, writer: Keypair, file: Uint8Array, opts: WriteOptions = {}): Promise<{ sha256: string; chunks: number; resent: number }> {
  const sha = await sha256Hex(file);
  const tag = await fileTag(sha, writer.publicKey);
  const total = chunkCount(file.length);
  const done = opts.done ?? new Set<number>();
  const rps = opts.rps ?? 10;
  const maxInFlight = opts.maxInFlight ?? 1000;
  const commitment = opts.commitment ?? 'confirmed';

  const queue: number[] = [];
  for (let i = 0; i < total; i++) if (!done.has(i)) queue.push(i);
  const inFlight = new Map<string, { index: number; lastValid: number }>();
  let resent = 0;
  // Sends overlap: waiting for each one to return would cap the rate at one per network round trip.
  let sending = 0;
  let hash = await conn.getLatestBlockhash(commitment);
  let hashAt = Date.now();
  let failure: unknown = null;

  const report = () => opts.onProgress?.({ done: done.size, total, inFlight: inFlight.size, resent });

  const checker = (async () => {
    while ((queue.length || inFlight.size || sending) && !failure) {
      await new Promise((r) => setTimeout(r, 1500));
      const sigs = [...inFlight.keys()];
      if (!sigs.length) continue;
      try {
        const height = await retry(() => conn.getBlockHeight(commitment));
        for (let i = 0; i < sigs.length; i += 256) {
          const part = sigs.slice(i, i + 256);
          const { value } = await retry(() => conn.getSignatureStatuses(part));
          value.forEach((st, k) => {
            const sig = part[k];
            const f = inFlight.get(sig);
            if (!f) return;
            const ok = st && !st.err && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized');
            if (ok) {
              inFlight.delete(sig);
              if (!done.has(f.index)) { done.add(f.index); opts.onConfirmed?.(f.index); }
            } else if (st?.err) {
              failure = new Error(`chunk ${f.index} failed on chain: ${JSON.stringify(st.err)}`);
            } else if (height > f.lastValid) {
              inFlight.delete(sig);
              if (!done.has(f.index)) { queue.push(f.index); resent++; }
            }
          });
        }
        report();
      } catch (e) {
        failure = e;
      }
    }
  })();

  const gap = 1000 / rps;
  let nextAt = Date.now();
  let pauseUntil = 0;
  while ((queue.length || inFlight.size || sending) && !failure) {
    if (!queue.length || inFlight.size + sending >= maxInFlight || Date.now() < pauseUntil) {
      await new Promise((r) => setTimeout(r, 200));
      continue;
    }
    if (Date.now() - hashAt > 20_000) { hash = await retry(() => conn.getLatestBlockhash(commitment)); hashAt = Date.now(); }
    const wait = nextAt - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    nextAt = Math.max(nextAt + gap, Date.now());
    const index = queue.shift()!;
    if (done.has(index)) continue;
    const tx = chunkTransaction({
      writer: writer.publicKey, tag, index, bytes: chunkSlice(file, index),
      blockhash: hash.blockhash, microLamports: opts.microLamports ?? 0, program: opts.program,
    });
    tx.sign(writer);
    const lastValid = hash.lastValidBlockHeight;
    sending++;
    conn.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 2 })
      .then((sig) => { inFlight.set(sig, { index, lastValid }); })
      .catch(() => { queue.push(index); pauseUntil = Date.now() + 1000; }) // rate limited or rejected: try again later
      .finally(() => { sending--; });
  }
  await checker;
  if (failure) throw failure;
  return { sha256: sha, chunks: total, resent };
}

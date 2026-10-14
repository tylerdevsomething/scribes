// Activity: every event the Scribes program emitted (born, verified, listed, unlisted, sold, given),
// read from transaction logs in order. Followed incrementally and kept on disk.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { EventParser } from '@coral-xyz/anchor';
import type { Connection } from '@solana/web3.js';
import { SCRIBES_PROGRAM, scribesProgram } from '../../lib/src/registry.ts';

export type Activity =
  | { kind: 'born'; scribe: string; owner: string; birthNumber: number; autograph: boolean }
  | { kind: 'verified'; scribe: string; burned: string }
  | { kind: 'listed'; scribe: string; seller: string; price: number }
  | { kind: 'unlisted'; scribe: string }
  | { kind: 'sold'; scribe: string; from: string; to: string; price: number; fee: number }
  | { kind: 'given'; scribe: string; from: string; to: string };

export type Entry = Activity & { signature: string; slot: number; time: number | null };

const s = (x: { toBase58(): string }) => x.toBase58();
const n = (x: { toString(): string }) => Number(x.toString());

function toActivity(name: string, d: Record<string, any>): Activity | null {
  switch (name) {
    case 'born': case 'Born': return { kind: 'born', scribe: s(d.scribe), owner: s(d.owner), birthNumber: n(d.birthNumber ?? d.birth_number), autograph: d.autograph };
    case 'verified': case 'Verified': return { kind: 'verified', scribe: s(d.scribe), burned: d.burned.toString() };
    case 'listed': case 'Listed': return { kind: 'listed', scribe: s(d.scribe), seller: s(d.seller), price: n(d.price) };
    case 'unlisted': case 'Unlisted': return { kind: 'unlisted', scribe: s(d.scribe) };
    case 'sold': case 'Sold': return { kind: 'sold', scribe: s(d.scribe), from: s(d.from), to: s(d.to), price: n(d.price), fee: n(d.fee) };
    case 'given': case 'Given': return { kind: 'given', scribe: s(d.scribe), from: s(d.from), to: s(d.to) };
    default: return null;
  }
}

export class ActivityLog {
  private conn: Connection;
  private path: string;
  private entries: Entry[] = []; // oldest first
  private newest: string | undefined;
  private parser: EventParser;

  constructor(conn: Connection, path: string) {
    this.conn = conn;
    this.path = path;
    const program = scribesProgram(conn);
    this.parser = new EventParser(SCRIBES_PROGRAM, program.coder);
    if (existsSync(path)) {
      const saved = JSON.parse(readFileSync(path, 'utf8'));
      this.entries = saved.entries;
      this.newest = saved.newest;
    }
  }

  async sync(): Promise<void> {
    const sigs: { signature: string; slot: number; time: number | null }[] = [];
    let top: string | undefined;
    for (let before: string | undefined; ;) {
      const page = await this.conn.getSignaturesForAddress(SCRIBES_PROGRAM, { before, until: this.newest, limit: 1000 }, 'confirmed');
      top ??= page[0]?.signature;
      for (const x of page) if (!x.err) sigs.push({ signature: x.signature, slot: x.slot, time: x.blockTime ?? null });
      if (page.length < 1000) break;
      before = page[page.length - 1].signature;
    }
    if (!sigs.length) return;
    sigs.reverse(); // oldest first
    const fresh: Entry[] = [];
    for (const x of sigs) {
      const tx = await this.conn.getTransaction(x.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
      const logs = tx?.meta?.logMessages;
      if (!logs || tx?.meta?.err) continue;
      for (const ev of this.parser.parseLogs(logs)) {
        const a = toActivity(ev.name, ev.data as Record<string, any>);
        if (a) fresh.push({ ...a, signature: x.signature, slot: x.slot, time: x.time });
      }
    }
    this.entries.push(...fresh);
    this.newest = top;
    writeFileSync(this.path, JSON.stringify({ newest: this.newest, entries: this.entries }));
  }

  // Newest first.
  list(opts: { scribe?: string; limit?: number } = {}): Entry[] {
    const out: Entry[] = [];
    for (let i = this.entries.length - 1; i >= 0 && out.length < (opts.limit ?? 50); i--) {
      const e = this.entries[i];
      if (!opts.scribe || e.scribe === opts.scribe) out.push(e);
    }
    return out;
  }
}

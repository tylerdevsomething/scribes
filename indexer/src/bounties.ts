// Bounties as the site shows them: open ones from the program's accounts, with their inscribed question
// (signed by the poster, matching the recorded hash) and answers (signed by the answering scribe's owner
// of the time); settled ones from the program's events.
import type { Connection } from '@solana/web3.js';
import { PublicKey } from '@solana/web3.js';
import { INK_PROGRAM } from '../../lib/src/chain.ts';
import { sha256Hex, utf8 } from '../../lib/src/bytes.ts';
import { bountyTag, decodeAnswer, decodeQuestion, openBounties, type BountyRecord } from '../../lib/src/bounty.ts';
import { scribesProgram } from '../../lib/src/registry.ts';

export interface Answer { scribe: string; text: string; signer: string; slot: number; signature: string }
export interface BountyView extends BountyRecord {
  state: 'open' | 'awarded' | 'refunded';
  question: string | null;
  answers: Answer[]; // only answers signed by the scribe's owner at the time
  winner?: string; // awarded scribe
  postedSlot?: number;
}

interface Known { record: BountyRecord; question: string | null; raw: Answer[]; newest?: string; postedSlot?: number }

export class Bounties {
  private conn: Connection;
  private known = new Map<string, Known>(); // every bounty ever seen (open or settled)
  private settled = new Map<string, { state: 'awarded' | 'refunded'; winner?: string }>();
  private ownerAt: (scribe: string, slot: number) => string | null;

  constructor(conn: Connection, ownerAt: (scribe: string, slot: number) => string | null) {
    this.conn = conn;
    this.ownerAt = ownerAt;
  }

  // The program's bounty events (see activity.ts): every bounty ever posted, and how it was settled.
  // Settled bounties' accounts are closed, so the events are what keeps them.
  fromEvents(events: { kind: string; slot: number; bounty?: string; poster?: string; reward?: number; deadlineSlot?: number; questionSha?: string; scribe?: string }[]) {
    for (const e of events) {
      if (e.kind === 'bounty_posted' && e.bounty && !this.known.has(e.bounty)) {
        this.known.set(e.bounty, { record: { address: e.bounty, poster: e.poster!, id: '', reward: e.reward!, deadlineSlot: e.deadlineSlot!, questionSha: e.questionSha! }, question: null, raw: [], postedSlot: e.slot });
      }
      if (e.kind === 'bounty_awarded' && e.bounty) this.settled.set(e.bounty, { state: 'awarded', winner: e.scribe });
      if (e.kind === 'bounty_refunded' && e.bounty) this.settled.set(e.bounty, { state: 'refunded' });
    }
  }

  async sync(): Promise<void> {
    for (const r of await openBounties(scribesProgram(this.conn))) {
      const k = this.known.get(r.address) ?? { record: r, question: null, raw: [] };
      k.record = r;
      this.known.set(r.address, k);
    }
    for (const [address, k] of this.known) {
      if (this.settled.has(address) && k.question !== null) continue; // nothing new can arrive that matters
      try { await this.follow(address, k); } catch { /* next pass */ }
    }
  }

  private async follow(address: string, k: Known) {
    const tag = await bountyTag(new PublicKey(address));
    const sigs = await this.conn.getSignaturesForAddress(tag, { until: k.newest, limit: 1000 }, 'confirmed');
    if (!sigs.length) return;
    for (const s of [...sigs].reverse()) {
      if (s.err) continue;
      const tx = await this.conn.getTransaction(s.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
      if (!tx || tx.meta?.err) continue;
      const keys = tx.transaction.message.staticAccountKeys;
      const signer = keys[0].toBase58();
      for (const ix of tx.transaction.message.compiledInstructions) {
        if (!keys[ix.programIdIndex]?.equals(INK_PROGRAM) || !ix.accountKeyIndexes.some((i) => keys[i]?.equals(tag))) continue;
        const q = decodeQuestion(ix.data);
        if (q !== null && k.question === null && signer === k.record.poster && (await sha256Hex(utf8.encode(q))) === k.record.questionSha) {
          k.question = q;
          k.postedSlot = s.slot;
        }
        const a = decodeAnswer(ix.data);
        if (a) k.raw.push({ ...a, signer, slot: s.slot, signature: s.signature });
      }
    }
    k.newest = sigs[0].signature;
  }

  private view(address: string, k: Known): BountyView {
    const settled = this.settled.get(address);
    const answers = k.raw.filter((a) => a.signer === this.ownerAt(a.scribe, a.slot));
    return { ...k.record, state: settled?.state ?? 'open', winner: settled?.winner, question: k.question, answers, postedSlot: k.postedSlot };
  }

  list(): BountyView[] {
    return [...this.known].map(([a, k]) => this.view(a, k)).sort((x, y) => (y.postedSlot ?? 0) - (x.postedSlot ?? 0));
  }

  get(address: string): BountyView | null {
    const k = this.known.get(address);
    return k ? this.view(address, k) : null;
  }
}

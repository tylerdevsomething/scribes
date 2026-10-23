// The official tools a scribe can use (bound brains only, for now). A scribe gets the tools its
// personality declares (lib/src/tools.ts); anything else it declares shows as "declared" and does nothing.
//
// Read tools answer straight away. Proposal tools never move anything: they hand the page a card that
// builds the transaction only when the viewer presses Approve and signs in their own wallet.
import Anthropic from '@anthropic-ai/sdk';
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, TransactionInstruction, type VersionedTransaction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync, getMint } from '@solana/spl-token';
import { API, CLUSTER, conn, short } from '../config.ts';
import { calculate } from '../../../lib/src/tools.ts';
import { journalInstruction } from '../../../lib/src/journal.ts';
import { answerInstruction } from '../../../lib/src/bounty.ts';
import { parsePersonality, systemPrompt } from '../../../lib/src/personality.ts';
import { buyInstruction, listInstruction, scribesProgram } from '../../../lib/src/registry.ts';
import { fileUrl, getScribe, getScribes, readLibrary, searchLibrary, type ScribeView } from '../api.ts';
import { MARKET_TOOLS, runMarketTool } from './market.ts';
import { hostedCall } from './bound.ts';
import { hostedGrokCall } from './grok.ts';
export { enabledTools, OFFICIAL_TOOLS } from '../../../lib/src/tools.ts';

const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const program = scribesProgram(conn);

// What a proposal card needs: a title, the facts, and how to build the transaction on approval.
export interface Proposal {
  id: string;
  kind: string;
  title: string;
  lines: [string, string][];
  note?: string;
  ownerOnly?: string; // only this wallet can approve (e.g. a journal entry: the scribe's owner)
  // Either instructions for the page to send, or a ready transaction for an outside service (Jupiter).
  build: (me: PublicKey) => Promise<{ ixs: TransactionInstruction[] } | { versioned: VersionedTransaction; execute: (signed: VersionedTransaction) => Promise<string> }>;
  done?: string; // what to say once it went through
}

export interface ToolContext {
  scribe: { address: string; owner: string; name: string };
  propose: (p: Proposal) => void;
  client: Anthropic | null; // the viewer's own key, or null on the free hosted brain
}

const obj = (props: Record<string, unknown>, required: string[]) => ({ type: 'object' as const, properties: props, required, additionalProperties: false });
const str = (description: string) => ({ type: 'string', description });
const num = (description: string) => ({ type: 'number', description });
const client = (name: string, description: string, input_schema: ReturnType<typeof obj>): Anthropic.Beta.BetaToolUnion =>
  ({ name, description, input_schema, strict: true, eager_input_streaming: true }) as Anthropic.Beta.BetaToolUnion;

export function toolDefinitions(enabled: string[]): Anthropic.Beta.BetaToolUnion[] {
  const on = (n: string) => enabled.includes(n);
  const d: Anthropic.Beta.BetaToolUnion[] = [];
  if (on('calculator')) d.push(client('calculator', 'Evaluate an arithmetic expression (+ - * / ^ parentheses, decimals). Use it for any sum you are not sure of.', obj({ expression: str('The expression') }, ['expression'])));
  if (on('clock')) d.push(client('clock', 'The current date and time (UTC and the viewer\'s local time).', obj({}, [])));
  if (on('web_search')) d.push({ type: 'web_search_20260209', name: 'web_search', max_uses: 3 });
  if (on('web_fetch')) d.push({ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3 });
  if (on('ask_scribe')) d.push(client('ask_scribe', 'Ask another scribe a question and get its answer in its own voice. Identify it by name, birth number (e.g. "#3") or address.', obj({ scribe: str('Name, #number or address'), question: str('What to ask it') }, ['scribe', 'question'])));
  if (on('scribe_lookup')) d.push(client('scribe_lookup', 'Look up scribes by name, birth number or address: purpose, brain, rarity rank and attributes, owner, verified, price if for sale.', obj({ query: str('Name, #number or address') }, ['query'])));
  if (on('scribe_market')) d.push(client('scribe_market', 'The scribe market now: how many exist, floor price, cheapest listings, recent sales.', obj({}, [])));
  if (on('bounty_board')) d.push(client('bounty_board', 'Open bounties: questions people will pay SOL for, with the reward, time left and how many answers so far.', obj({}, [])));
  if (on('answer_bounty')) d.push(client('answer_bounty', 'Propose your answer to an open bounty (by its address from bounty_board). If your owner approves, the answer is inscribed; if the poster picks it, your owner is paid.', obj({ bounty: str('Bounty address'), answer: str('Your answer, up to about 800 characters') }, ['bounty', 'answer'])));
  if (on('library')) {
    d.push(client('library_search', 'Search your library: the archives inscribed on Solana with you. Every word must appear (or put a phrase in double quotes); returns matching entries with a snippet. Search before answering anything your library may cover, and quote it rather than guessing.', obj({ query: str('Words or a "quoted phrase" to look for') }, ['query'])));
    d.push(client('library_read', 'Read one entry of your library by its path (from library_search). Long entries come in parts: read from offset 0, then pass the next offset to continue.', obj({ path: str('The entry\'s path'), offset: num('Where to start reading, 0 for the beginning') }, ['path', 'offset'])));
  }
  if (on('journal')) d.push(client('journal', 'Propose writing a memory into your own journal. If your owner approves, it is inscribed on Solana and you will remember it in every future conversation. Write it in first person, one or two sentences, only things worth keeping.', obj({ entry: str('The memory, in your own words') }, ['entry'])));
  if (on('propose_transfer')) d.push(client('propose_transfer', 'Draft a SOL transfer from the person you are talking to. Nothing is sent: they see it and may approve it in their own wallet. Only propose what they asked for.', obj({ to: str('Recipient wallet address'), amount_sol: num('Amount of SOL'), note: str('Why, in a few words') }, ['to', 'amount_sol', 'note'])));
  if (on('propose_token_transfer')) d.push(client('propose_token_transfer', 'Draft a token transfer from the person you are talking to. Nothing is sent until they approve in their wallet.', obj({ mint: str('Token mint address'), to: str('Recipient wallet address'), amount: num('Amount in whole tokens'), note: str('Why, in a few words') }, ['mint', 'to', 'amount', 'note'])));
  if (on('propose_message')) d.push(client('propose_message', 'Draft a public message written to Solana forever (a memo), signed by the person you are talking to if they approve.', obj({ text: str('The message, up to 400 characters') }, ['text'])));
  if (on('propose_scribe_trade')) d.push(client('propose_scribe_trade', 'Draft a scribe trade for the person you are talking to: buy a listed scribe, list one they own, or tip a scribe\'s owner in SOL. Nothing happens until they approve.', obj({ action: { type: 'string', enum: ['buy', 'list', 'tip'] }, scribe: str('Name, #number or address'), amount_sol: num('Listing price or tip in SOL (ignored for buy: the listed price is used)') }, ['action', 'scribe', 'amount_sol'])));
  for (const n of enabled) if (MARKET_TOOLS[n]) d.push(MARKET_TOOLS[n]);
  // Claude takes at most 20 strict tools in one request; past that the lookups lose strict first, so the
  // tools that draft transactions keep their exact schemas.
  const isStrict = (t: Anthropic.Beta.BetaToolUnion) => !!(t as { strict?: boolean }).strict;
  let over = d.filter(isStrict).length - 20;
  return d.map((t) => {
    if (over <= 0 || !isStrict(t) || /^(propose_|answer_bounty$|journal$)/.test((t as { name: string }).name)) return t;
    over--;
    const { strict: _, ...loose } = t as { strict?: boolean };
    return loose as Anthropic.Beta.BetaToolUnion;
  });
}

// ---- helpers ----

async function findScribe(q: string): Promise<ScribeView> {
  const t = q.trim().replace(/^#/, '');
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t)) return getScribe(t);
  const all = (await getScribes()).filter((s) => !s.hidden);
  const hit = /^\d+$/.test(t) ? all.find((s) => s.birthNumber + 1 === Number(t)) : all.find((s) => s.name?.toLowerCase() === t.toLowerCase()) ?? all.find((s) => s.name?.toLowerCase().includes(t.toLowerCase()));
  if (!hit) throw new Error(`no scribe matches "${q}"`);
  return hit;
}

function describeScribe(s: ScribeView): string {
  const brain = s.brain?.kind === 'bound' ? `bound to ${s.brain.model}` : s.model ? `inscribed model ${s.model.name ?? ''} (${(s.model.parameters / 1e6).toFixed(0)}M)` : 'unknown';
  return [
    `${s.name} — scribe #${s.birthNumber + 1} (${s.address})`,
    `purpose: ${s.purpose}`,
    `brain: ${brain}`,
    `rarity rank: ${s.rarity?.rank ?? 'not ranked yet'}${s.rarity ? ` · ${Object.entries(s.rarity.traits).filter(([k]) => k !== 'Model').map(([k, v]) => `${k}: ${v}`).join(', ')}` : ''}`,
    `owner: ${s.owner} · ${s.verified ? 'verified' : 'not verified'}${s.autograph ? ' · holds the Autograph' : ''}`,
    s.listing ? `for sale: ${s.listing.price / LAMPORTS_PER_SOL} SOL` : 'not for sale',
  ].join('\n');
}

const sigOk = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(s);
const pk = (s: unknown, what: string) => { if (typeof s !== 'string') throw new Error(`${what} is required`); return new PublicKey(s.trim()); };
const n = (x: unknown, what: string) => { if (typeof x !== 'number' || !Number.isFinite(x) || x <= 0) throw new Error(`${what} must be a positive number`); return x; };
const id = () => crypto.randomUUID();

// ---- running a tool ----

export async function runTool(name: string, input: unknown, ctx: ToolContext): Promise<string> {
  const o = (input ?? {}) as Record<string, unknown>;
  if (MARKET_TOOLS[name]) return runMarketTool(name, o, ctx);
  switch (name) {
    case 'calculator':
      if (typeof o.expression !== 'string') throw new Error('expression must be a string');
      return String(calculate(o.expression));

    case 'clock': {
      const now = new Date();
      return `UTC ${now.toISOString().replace('T', ' ').slice(0, 16)} · viewer's local time ${now.toLocaleString()}`;
    }

    case 'scribe_lookup':
      return describeScribe(await findScribe(String(o.query ?? '')));

    case 'library_search': {
      const { hits, building } = await searchLibrary(ctx.scribe.address, String(o.query ?? ''), 8);
      const note = building ? `\n(${building} of your libraries is still being indexed and was not searched; try again in a minute.)` : '';
      if (!hits.length) return `Nothing in your library matches that. Try other words.${note}`;
      return hits.map((h) => `${h.path} — ${h.title}\n  ${h.snippet.replace(/\s+/g, ' ')}`).join('\n') + note;
    }

    case 'library_read': {
      const r = await readLibrary(ctx.scribe.address, String(o.path ?? ''), Math.max(0, Math.floor(Number(o.offset) || 0)));
      if ('building' in r) return `Your library is still being indexed (${r.done} of ${r.total} entries). Try again in a minute.`;
      if (r.text === null) return `${r.path} is a picture (${r.type}, ${r.size} bytes); it can be seen on your page, not read as text.`;
      return `${r.title} (${r.path})\n\n${r.text}${r.next !== null ? `\n\n[continues: read again with offset ${r.next}]` : '\n\n[end]'}`;
    }

    case 'scribe_market': {
      const all = (await getScribes()).filter((s) => !s.hidden && s.status.state !== 'invalid');
      const listed = all.filter((s) => s.listing).sort((a, b) => a.listing!.price - b.listing!.price);
      const sales = await fetch(`${API}/activity?limit=50`).then((r) => r.json()).then((l: { kind: string; scribe: string; price?: number }[]) => l.filter((e) => e.kind === 'sold').slice(0, 5)).catch(() => []);
      const name = (a: string) => all.find((s) => s.address === a)?.name ?? short(a);
      return [
        `${all.length} scribes · ${all.filter((s) => s.verified).length} verified · ${listed.length} for sale`,
        listed.length ? `floor: ${listed[0].listing!.price / LAMPORTS_PER_SOL} SOL (${listed[0].name})` : 'nothing listed',
        ...listed.slice(0, 5).map((s) => `listed: ${s.name} #${s.birthNumber + 1} at ${s.listing!.price / LAMPORTS_PER_SOL} SOL (rank ${s.rarity?.rank ?? '?'})`),
        ...(sales.length ? sales.map((e: { scribe: string; price?: number }) => `sold: ${name(e.scribe)} for ${(e.price ?? 0) / LAMPORTS_PER_SOL} SOL`) : ['no sales yet']),
      ].join('\n');
    }

    case 'ask_scribe': {
      const target = await findScribe(String(o.scribe ?? ''));
      const question = String(o.question ?? '').trim();
      if (!question) throw new Error('question is required');
      if (target.address === ctx.scribe.address) return 'That is you.';
      if (target.brain?.kind !== 'bound' || (target.brain.provider !== 'anthropic' && target.brain.provider !== 'xai')) {
        return `${target.name} thinks with an inscribed model that only runs on its own page, so it cannot be consulted from here. Suggest the person visits it.`;
      }
      const pref = target.files.find((f) => f.role === 'personality');
      if (!pref) throw new Error(`${target.name} has no personality yet`);
      const p = parsePersonality(await fetch(fileUrl(pref.sha256)).then((r) => r.text()));
      const ask = `(${ctx.scribe.name}, another scribe, is consulting you on behalf of a person. Answer briefly.)\n\n${question}`;
      // A Grok scribe is asked through the free brain (the viewer's key here, if any, is for this scribe's provider).
      if (target.brain.provider === 'xai') {
        const g = await hostedGrokCall(target.address, [{ role: 'user', content: ask }], () => {});
        return `${target.name} (#${target.birthNumber + 1}) answers: ${g.content.trim() || '(no answer)'}`;
      }
      // With the viewer's key: call Claude directly. On the free brain: ask through the server (it uses the
      // other scribe's own inscribed personality).
      const res = ctx.client
        ? await ctx.client.beta.messages.create({
          model: target.brain.model, max_tokens: 2000,
          system: systemPrompt(p, target.journal.map((j) => j.text)),
          messages: [{ role: 'user', content: ask }],
          output_config: { effort: 'low' },
          betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
        })
        : await hostedCall(target.address, [{ role: 'user', content: ask }], () => {});
      const answer = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
      return `${target.name} (#${target.birthNumber + 1}) answers: ${answer || '(no answer)'}`;
    }

    case 'bounty_board': {
      const [list, slot] = await Promise.all([fetch(`${API}/bounties`).then((r) => r.json()), conn.getSlot('confirmed')]);
      const open = (list as { address: string; question: string | null; reward: number; deadlineSlot: number; state: string; answers: unknown[] }[])
        .filter((b) => b.state === 'open' && b.question && b.deadlineSlot > slot);
      if (!open.length) return 'No open bounties right now.';
      return open.slice(0, 10).map((b) => [
        `${b.address} — ${b.reward / LAMPORTS_PER_SOL} SOL, ${Math.max(0, Math.round((b.deadlineSlot - slot) * 0.4 / 3600))} h left, ${b.answers.length} answers`,
        `  "${b.question}"`,
      ].join('\n')).join('\n');
    }

    case 'answer_bounty': {
      const bounty = pk(o.bounty, 'bounty');
      const answer = String(o.answer ?? '').trim();
      if (!answer) throw new Error('answer is required');
      const b = await fetch(`${API}/bounty/${bounty.toBase58()}`).then((r) => (r.ok ? r.json() : null));
      if (!b || b.state !== 'open') return 'That bounty is not open.';
      const scribe = new PublicKey(ctx.scribe.address);
      ctx.propose({
        id: id(), kind: 'journal', title: `Answer a ${b.reward / LAMPORTS_PER_SOL} SOL bounty`,
        lines: [['Question', `“${b.question}”`], ['Answer', `“${answer}”`]],
        note: "Inscribed as this scribe's answer. If the poster picks it, the owner is paid. Only the owner can approve.",
        ownerOnly: ctx.scribe.owner,
        build: async (me) => ({ ixs: [await answerInstruction(me, bounty, scribe, answer)] }),
        done: 'Answer inscribed.',
      });
      return 'Proposed. If your owner approves, your answer is inscribed on the bounty.';
    }

    case 'journal': {
      const entry = String(o.entry ?? '').trim();
      if (!entry) throw new Error('entry is required');
      const scribe = new PublicKey(ctx.scribe.address);
      ctx.propose({
        id: id(), kind: 'journal', title: `${ctx.scribe.name} wants to remember this`,
        lines: [['Journal entry', `“${entry}”`]],
        note: 'Inscribed on Solana and remembered in every future conversation. Only the owner can approve.',
        ownerOnly: ctx.scribe.owner,
        build: async (me) => ({ ixs: [await journalInstruction(me, scribe, entry)] }),
        done: 'Inscribed — it will remember this.',
      });
      return 'Proposed. If your owner approves, it is inscribed and you will remember it from now on.';
    }

    case 'propose_transfer': {
      const to = pk(o.to, 'to'), sol = n(o.amount_sol, 'amount_sol');
      if (sol > 1000) throw new Error('amount must be at most 1000 SOL');
      ctx.propose({
        id: id(), kind: 'transfer', title: 'Send SOL', note: String(o.note ?? ''),
        lines: [['Amount', `${sol} SOL`], ['To', to.toBase58()]],
        build: async (me) => ({ ixs: [SystemProgram.transfer({ fromPubkey: me, toPubkey: to, lamports: Math.round(sol * LAMPORTS_PER_SOL) })] }),
      });
      return 'Proposed. The person decides whether to approve it in their wallet; nothing has been sent.';
    }

    case 'propose_token_transfer': {
      const mint = pk(o.mint, 'mint'), to = pk(o.to, 'to'), amount = n(o.amount, 'amount');
      const info = await conn.getAccountInfo(mint);
      if (!info) throw new Error(`no token mint ${mint.toBase58()} on ${CLUSTER}`);
      const tokenProgram = info.owner;
      const decimals = (await getMint(conn, mint, 'confirmed', tokenProgram)).decimals;
      ctx.propose({
        id: id(), kind: 'token', title: 'Send tokens', note: String(o.note ?? ''),
        lines: [['Amount', `${amount} of ${short(mint.toBase58())}`], ['To', to.toBase58()]],
        build: async (me) => {
          const from = getAssociatedTokenAddressSync(mint, me, false, tokenProgram);
          const dest = getAssociatedTokenAddressSync(mint, to, true, tokenProgram);
          return { ixs: [
            createAssociatedTokenAccountIdempotentInstruction(me, dest, to, mint, tokenProgram),
            createTransferCheckedInstruction(from, mint, dest, me, BigInt(Math.round(amount * 10 ** decimals)), decimals, [], tokenProgram),
          ] };
        },
      });
      return 'Proposed. Nothing moves until the person approves it in their wallet.';
    }

    case 'propose_message': {
      const text = String(o.text ?? '').trim().slice(0, 400);
      if (!text) throw new Error('text is required');
      ctx.propose({
        id: id(), kind: 'message', title: 'Write a message on Solana', lines: [['Message', `“${text}”`]],
        note: 'Public and permanent, signed by your wallet.',
        build: async (me) => ({ ixs: [new TransactionInstruction({ programId: MEMO, keys: [{ pubkey: me, isSigner: true, isWritable: false }], data: Buffer.from(text, 'utf8') })] }),
      });
      return 'Proposed. It is written only if the person approves.';
    }

    case 'propose_scribe_trade': {
      const target = await findScribe(String(o.scribe ?? ''));
      const action = String(o.action);
      if (action === 'buy') {
        if (!target.listing) return `${target.name} is not for sale.`;
        const l = target.listing;
        ctx.propose({
          id: id(), kind: 'buy', title: `Buy ${target.name}`, lines: [['Scribe', `${target.name} #${target.birthNumber + 1}`], ['Price', `${l.price / LAMPORTS_PER_SOL} SOL`]],
          build: async (me) => ({ ixs: [await buyInstruction(program, me, target.address, l.seller, l.price)] }),
          done: `${target.name} is yours.`,
        });
      } else if (action === 'list') {
        const sol = n(o.amount_sol, 'amount_sol');
        ctx.propose({
          id: id(), kind: 'list', title: `List ${target.name} for sale`, lines: [['Scribe', `${target.name} #${target.birthNumber + 1}`], ['Price', `${sol} SOL`]],
          ownerOnly: target.owner,
          build: async (me) => ({ ixs: [await listInstruction(program, me, target.address, Math.round(sol * LAMPORTS_PER_SOL))] }),
        });
      } else if (action === 'tip') {
        const sol = n(o.amount_sol, 'amount_sol');
        const owner = new PublicKey(target.owner);
        ctx.propose({
          id: id(), kind: 'tip', title: `Tip ${target.name}'s owner`, lines: [['Tip', `${sol} SOL`], ['To', target.owner]],
          build: async (me) => ({ ixs: [SystemProgram.transfer({ fromPubkey: me, toPubkey: owner, lamports: Math.round(sol * LAMPORTS_PER_SOL) })] }),
        });
      } else throw new Error('action must be buy, list or tip');
      return 'Proposed. Nothing happens until the person approves it in their wallet.';
    }
  }
  throw new Error(`unknown tool ${name}`);
}

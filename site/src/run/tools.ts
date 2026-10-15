// The official tools a scribe can use (bound brains only, for now). A scribe gets the tools its
// personality declares (lib/src/tools.ts); anything else it declares shows as "declared" and does nothing.
//
// Read tools answer straight away. Proposal tools never move anything: they hand the page a card that
// builds the transaction only when the viewer presses Approve and signs in their own wallet.
import Anthropic from '@anthropic-ai/sdk';
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, TransactionInstruction, VersionedTransaction } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync, getMint } from '@solana/spl-token';
import { API, CLUSTER, conn, short } from '../config.ts';
import { calculate } from '../../../lib/src/tools.ts';
import { journalInstruction } from '../../../lib/src/journal.ts';
import { answerInstruction } from '../../../lib/src/bounty.ts';
import { parsePersonality, systemPrompt } from '../../../lib/src/personality.ts';
import { buyInstruction, listInstruction, scribesProgram } from '../../../lib/src/registry.ts';
import { fileUrl, getScribe, getScribes, type ScribeView } from '../api.ts';
export { enabledTools, OFFICIAL_TOOLS } from '../../../lib/src/tools.ts';

const JUP = 'https://lite-api.jup.ag';
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
  client: Anthropic; // the viewer's own key
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
  if (on('token_lookup')) d.push(client('token_lookup', 'Find Solana tokens by name, symbol or mint address. Returns price, market cap, liquidity, holders, 24h change and whether it is verified.', obj({ query: str('Name, symbol or mint address') }, ['query'])));
  if (on('token_safety')) d.push(client('token_safety', 'Safety check for a Solana token: is minting disabled, can accounts be frozen, how concentrated are the top holders, organic trading score, age. Use before anyone buys an unknown token.', obj({ mint: str('Token mint address') }, ['mint'])));
  if (on('token_prices')) d.push(client('token_prices', 'Live USD prices for one or more Solana token mint addresses (use token_lookup first if you only know a name). SOL is So11111111111111111111111111111111111111112.', obj({ mints: { type: 'array', items: { type: 'string' }, description: 'Mint addresses, up to 20' } }, ['mints'])));
  if (on('wallet_portfolio')) d.push(client('wallet_portfolio', `SOL and token balances of a Solana wallet on ${CLUSTER}.`, obj({ address: str('Wallet address') }, ['address'])));
  if (on('explain_transaction')) d.push(client('explain_transaction', `Explain a Solana transaction on ${CLUSTER} in plain English: who signed, what each instruction did, balance changes and fee.`, obj({ signature: str('Transaction signature') }, ['signature'])));
  if (on('ask_scribe')) d.push(client('ask_scribe', 'Ask another scribe a question and get its answer in its own voice. Identify it by name, birth number (e.g. "#3") or address.', obj({ scribe: str('Name, #number or address'), question: str('What to ask it') }, ['scribe', 'question'])));
  if (on('scribe_lookup')) d.push(client('scribe_lookup', 'Look up scribes by name, birth number or address: purpose, brain, rarity rank and attributes, owner, verified, price if for sale.', obj({ query: str('Name, #number or address') }, ['query'])));
  if (on('scribe_market')) d.push(client('scribe_market', 'The scribe market now: how many exist, floor price, cheapest listings, recent sales.', obj({}, [])));
  if (on('bounty_board')) d.push(client('bounty_board', 'Open bounties: questions people will pay SOL for, with the reward, time left and how many answers so far.', obj({}, [])));
  if (on('answer_bounty')) d.push(client('answer_bounty', 'Propose your answer to an open bounty (by its address from bounty_board). If your owner approves, the answer is inscribed; if the poster picks it, your owner is paid.', obj({ bounty: str('Bounty address'), answer: str('Your answer, up to about 800 characters') }, ['bounty', 'answer'])));
  if (on('journal')) d.push(client('journal', 'Propose writing a memory into your own journal. If your owner approves, it is inscribed on Solana and you will remember it in every future conversation. Write it in first person, one or two sentences, only things worth keeping.', obj({ entry: str('The memory, in your own words') }, ['entry'])));
  if (on('propose_transfer')) d.push(client('propose_transfer', 'Draft a SOL transfer from the person you are talking to. Nothing is sent: they see it and may approve it in their own wallet. Only propose what they asked for.', obj({ to: str('Recipient wallet address'), amount_sol: num('Amount of SOL'), note: str('Why, in a few words') }, ['to', 'amount_sol', 'note'])));
  if (on('propose_token_transfer')) d.push(client('propose_token_transfer', 'Draft a token transfer from the person you are talking to. Nothing is sent until they approve in their wallet.', obj({ mint: str('Token mint address'), to: str('Recipient wallet address'), amount: num('Amount in whole tokens'), note: str('Why, in a few words') }, ['mint', 'to', 'amount', 'note'])));
  if (on('propose_swap')) d.push(client('propose_swap', 'Draft a token swap through Jupiter (best route, mainnet only). Nothing happens until the person approves in their wallet. Use mint addresses; SOL is So11111111111111111111111111111111111111112.', obj({ from_mint: str('Mint to sell'), to_mint: str('Mint to buy'), amount: num('Amount of the sold token, in whole tokens'), note: str('Why, in a few words') }, ['from_mint', 'to_mint', 'amount', 'note'])));
  if (on('propose_message')) d.push(client('propose_message', 'Draft a public message written to Solana forever (a memo), signed by the person you are talking to if they approve.', obj({ text: str('The message, up to 400 characters') }, ['text'])));
  if (on('propose_scribe_trade')) d.push(client('propose_scribe_trade', 'Draft a scribe trade for the person you are talking to: buy a listed scribe, list one they own, or tip a scribe\'s owner in SOL. Nothing happens until they approve.', obj({ action: { type: 'string', enum: ['buy', 'list', 'tip'] }, scribe: str('Name, #number or address'), amount_sol: num('Listing price or tip in SOL (ignored for buy: the listed price is used)') }, ['action', 'scribe', 'amount_sol'])));
  return d;
}

// ---- helpers ----

async function jup<T>(path: string): Promise<T> {
  const r = await fetch(`${JUP}${path}`);
  if (!r.ok) throw new Error(`Jupiter answered ${r.status}`);
  return r.json();
}

interface JupToken {
  id: string; name: string; symbol: string; decimals: number; usdPrice?: number; mcap?: number; liquidity?: number;
  holderCount?: number; isVerified?: boolean; organicScore?: number; organicScoreLabel?: string; createdAt?: string;
  tokenProgram?: string; stats24h?: { priceChange?: number; buyVolume?: number; sellVolume?: number };
  audit?: { mintAuthorityDisabled?: boolean; freezeAuthorityDisabled?: boolean; topHoldersPercentage?: number; devBalancePercentage?: number };
}
const usd = (n?: number) => (n === undefined ? 'unknown' : n >= 1 ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : `$${n.toPrecision(3)}`);

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
  switch (name) {
    case 'calculator':
      if (typeof o.expression !== 'string') throw new Error('expression must be a string');
      return String(calculate(o.expression));

    case 'clock': {
      const now = new Date();
      return `UTC ${now.toISOString().replace('T', ' ').slice(0, 16)} · viewer's local time ${now.toLocaleString()}`;
    }

    case 'token_lookup': {
      const q = String(o.query ?? '').trim();
      if (!q) throw new Error('query is required');
      const list = (await jup<JupToken[]>(`/tokens/v2/search?query=${encodeURIComponent(q)}`)).slice(0, 5);
      if (!list.length) return `No token matches "${q}".`;
      return list.map((t) => `${t.name} (${t.symbol}) — mint ${t.id}${t.isVerified ? ' · verified' : ''}\n  price ${usd(t.usdPrice)} · market cap ${usd(t.mcap)} · liquidity ${usd(t.liquidity)} · ${t.holderCount?.toLocaleString() ?? '?'} holders · 24h ${t.stats24h?.priceChange?.toFixed(1) ?? '?'}%`).join('\n');
    }

    case 'token_safety': {
      const mint = pk(o.mint, 'mint').toBase58();
      const [t] = await jup<JupToken[]>(`/tokens/v2/search?query=${mint}`);
      if (!t || t.id !== mint) return `Jupiter does not know ${mint}. Unknown tokens deserve extra caution.`;
      const a = t.audit ?? {};
      const flags: string[] = [];
      if (a.mintAuthorityDisabled === false) flags.push('MINT AUTHORITY ENABLED — more can be minted at any time');
      if (a.freezeAuthorityDisabled === false) flags.push('FREEZE AUTHORITY ENABLED — holders can be frozen');
      if ((a.topHoldersPercentage ?? 0) > 50) flags.push(`top holders own ${a.topHoldersPercentage!.toFixed(0)}% of supply`);
      if ((t.liquidity ?? 0) < 10_000) flags.push(`thin liquidity (${usd(t.liquidity)})`);
      if ((t.organicScore ?? 100) < 30) flags.push(`low organic trading score (${t.organicScore?.toFixed(0)})`);
      const age = t.createdAt ? Math.floor((Date.now() - Date.parse(t.createdAt)) / 86_400_000) : null;
      if (age !== null && age < 3) flags.push(`only ${age} day(s) old`);
      return [
        `${t.name} (${t.symbol}) — ${t.isVerified ? 'verified on Jupiter' : 'not verified'}`,
        `mint authority: ${a.mintAuthorityDisabled ? 'disabled' : 'ENABLED'} · freeze authority: ${a.freezeAuthorityDisabled ? 'disabled' : 'ENABLED'}`,
        `top holders: ${a.topHoldersPercentage?.toFixed(1) ?? '?'}% · developer holds ${a.devBalancePercentage?.toFixed(2) ?? '?'}%`,
        `organic score: ${t.organicScore?.toFixed(0) ?? '?'} (${t.organicScoreLabel ?? '?'}) · liquidity ${usd(t.liquidity)} · ${t.holderCount?.toLocaleString() ?? '?'} holders${age !== null ? ` · ${age} days old` : ''}`,
        flags.length ? `RED FLAGS: ${flags.join('; ')}` : 'No red flags found (not a guarantee).',
      ].join('\n');
    }

    case 'token_prices': {
      const mints = Array.isArray(o.mints) ? (o.mints as unknown[]).map((m) => pk(m, 'mint').toBase58()).slice(0, 20) : [];
      if (!mints.length) throw new Error('mints must be a list of mint addresses');
      const p = await jup<Record<string, { usdPrice: number; priceChange24h?: number }>>(`/price/v3?ids=${mints.join(',')}`);
      return mints.map((m) => (p[m] ? `${m}: ${usd(p[m].usdPrice)} (24h ${p[m].priceChange24h?.toFixed(1) ?? '?'}%)` : `${m}: no price`)).join('\n');
    }

    case 'wallet_portfolio': {
      const owner = pk(o.address, 'address');
      const [lamports, a, b] = await Promise.all([
        conn.getBalance(owner),
        conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
        conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }),
      ]);
      const tokens = [...a.value, ...b.value]
        .map((x) => x.account.data.parsed.info as { mint: string; tokenAmount: { uiAmount: number } })
        .filter((x) => x.tokenAmount.uiAmount > 0)
        .slice(0, 25);
      let prices: Record<string, { usdPrice: number }> = {};
      if (CLUSTER === 'mainnet' && tokens.length) prices = await jup<Record<string, { usdPrice: number }>>(`/price/v3?ids=${tokens.map((t) => t.mint).join(',')}`).catch(() => ({}));
      const lines = tokens.map((t) => `${t.tokenAmount.uiAmount.toLocaleString()} of ${t.mint}${prices[t.mint] ? ` (${usd(prices[t.mint].usdPrice * t.tokenAmount.uiAmount)})` : ''}`);
      return `${short(owner.toBase58())} on ${CLUSTER}: ${lamports / LAMPORTS_PER_SOL} SOL${lines.length ? `\ntokens:\n${lines.join('\n')}` : ', no tokens'}`;
    }

    case 'explain_transaction': {
      const sig = String(o.signature ?? '').trim();
      if (!sigOk(sig)) throw new Error('that is not a transaction signature');
      const tx = await conn.getParsedTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
      if (!tx) return `No transaction ${short(sig)} on ${CLUSTER}.`;
      const keys = tx.transaction.message.accountKeys;
      const signers = keys.filter((k) => k.signer).map((k) => k.pubkey.toBase58());
      const steps = tx.transaction.message.instructions.map((ix, i) => {
        if ('parsed' in ix) return `${i + 1}. ${ix.program}: ${ix.parsed.type ?? 'call'} ${JSON.stringify(ix.parsed.info ?? {}).slice(0, 220)}`;
        return `${i + 1}. program ${ix.programId.toBase58()} (${ix.data.length} chars of data)`;
      });
      const changes = (tx.meta?.preBalances ?? []).map((pre, i) => ({ who: keys[i].pubkey.toBase58(), d: ((tx.meta!.postBalances[i] ?? pre) - pre) / LAMPORTS_PER_SOL }))
        .filter((c) => c.d !== 0).map((c) => `${short(c.who)} ${c.d > 0 ? '+' : ''}${c.d} SOL`);
      return [
        `${tx.meta?.err ? 'FAILED' : 'succeeded'} at slot ${tx.slot}${tx.blockTime ? ` (${new Date(tx.blockTime * 1000).toISOString().slice(0, 16)} UTC)` : ''}`,
        `signed by ${signers.map(short).join(', ')} · fee ${(tx.meta?.fee ?? 0) / LAMPORTS_PER_SOL} SOL`,
        'instructions:', ...steps,
        changes.length ? `SOL changes: ${changes.join(', ')}` : 'no SOL balance changes',
      ].join('\n');
    }

    case 'scribe_lookup':
      return describeScribe(await findScribe(String(o.query ?? '')));

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
      if (target.brain?.kind !== 'bound' || target.brain.provider !== 'anthropic') {
        return `${target.name} thinks with an inscribed model that only runs on its own page, so it cannot be consulted from here. Suggest the person visits it.`;
      }
      const pref = target.files.find((f) => f.role === 'personality');
      if (!pref) throw new Error(`${target.name} has no personality yet`);
      const p = parsePersonality(await fetch(fileUrl(pref.sha256)).then((r) => r.text()));
      const res = await ctx.client.beta.messages.create({
        model: target.brain.model, max_tokens: 2000,
        system: systemPrompt(p, target.journal.map((j) => j.text)) + `\nAnother scribe, ${ctx.scribe.name}, is consulting you on behalf of a person. Answer briefly.`,
        messages: [{ role: 'user', content: question }],
        output_config: { effort: 'low' },
        betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      });
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

    case 'propose_swap': {
      if (CLUSTER !== 'mainnet') return `Swaps go through Jupiter on mainnet; this site is on ${CLUSTER}, so a swap cannot be drafted here.`;
      const from = pk(o.from_mint, 'from_mint').toBase58(), to = pk(o.to_mint, 'to_mint').toBase58(), amount = n(o.amount, 'amount');
      const [a] = await jup<JupToken[]>(`/tokens/v2/search?query=${from}`);
      const [b] = await jup<JupToken[]>(`/tokens/v2/search?query=${to}`);
      if (!a || !b) throw new Error('unknown token');
      const raw = Math.round(amount * 10 ** a.decimals);
      const quote = await jup<{ outAmount: string; priceImpactPct?: string }>(`/ultra/v1/order?inputMint=${from}&outputMint=${to}&amount=${raw}`);
      const out = Number(quote.outAmount) / 10 ** b.decimals;
      ctx.propose({
        id: id(), kind: 'swap', title: `Swap ${a.symbol} → ${b.symbol}`, note: String(o.note ?? ''),
        lines: [['You sell', `${amount} ${a.symbol}`], ['You get about', `${out.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${b.symbol}`], ['Price impact', `${(Number(quote.priceImpactPct ?? 0) * 100).toFixed(2)}%`], ['Route', 'Jupiter (best route at approval time)']],
        build: async (me) => {
          const order = await jup<{ transaction: string; requestId: string }>(`/ultra/v1/order?inputMint=${from}&outputMint=${to}&amount=${raw}&taker=${me.toBase58()}`);
          if (!order.transaction) throw new Error('Jupiter did not return a transaction (not enough balance?)');
          const versioned = VersionedTransaction.deserialize(Uint8Array.from(atob(order.transaction), (c) => c.charCodeAt(0)));
          return {
            versioned,
            execute: async (signed) => {
              const r = await fetch(`${JUP}/ultra/v1/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signedTransaction: btoa(String.fromCharCode(...signed.serialize())), requestId: order.requestId }) });
              const j = await r.json();
              if (j.status !== 'Success') throw new Error(j.error ?? 'the swap failed');
              return j.signature as string;
            },
          };
        },
      });
      return `Proposed: about ${out} ${b.symbol} for ${amount} ${a.symbol}. Nothing happens until the person approves.`;
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

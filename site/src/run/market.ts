// Market, wallet and trading tools. Reads always use real mainnet data (Jupiter, DexScreener, and Helius
// through our server's read-only proxy), whatever network the site itself runs on. Trading tools only draft:
// the viewer approves each trade in their own wallet, and only when the site is on mainnet.
import type Anthropic from '@anthropic-ai/sdk';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { API, CLUSTER, short } from '../config.ts';
import type { Proposal, ToolContext } from './tools.ts';

const JUP = 'https://lite-api.jup.ag';
const DEX = 'https://api.dexscreener.com';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// ---- definitions ----

type Def = Anthropic.Beta.BetaToolUnion;
const obj = (props: Record<string, unknown>, required: string[]) => ({ type: 'object' as const, properties: props, required, additionalProperties: false });
const str = (description: string) => ({ type: 'string', description });
const num = (description: string) => ({ type: 'number', description });
const def = (name: string, description: string, input_schema: ReturnType<typeof obj>): Def =>
  ({ name, description, input_schema, strict: true, eager_input_streaming: true }) as Def;
const TOKEN = 'A mint address, or a symbol/name such as SOL, USDC, BONK';

export const MARKET_TOOLS: Record<string, Def> = {
  trending_tokens: def('trending_tokens', 'Solana tokens that are hot right now. kind: "trending" (attention), "traded" (volume) or "organic" (real, non-bot activity). window: 5m, 1h, 6h or 24h.',
    obj({ kind: { type: 'string', enum: ['trending', 'traded', 'organic'] }, window: { type: 'string', enum: ['5m', '1h', '6h', '24h'] } }, ['kind', 'window'])),
  new_launches: def('new_launches', 'Tokens that launched in the last minutes/hours on Solana, with age, market cap, liquidity, holders and quick risk flags. Most new launches fail: say so.', obj({}, [])),
  token_report: def('token_report', 'A full report on one token before anyone buys it: price, market cap, liquidity, top pools, buys vs sells, price changes, top holders, mint/freeze authority, developer holdings, socials, and red flags.', obj({ token: str(TOKEN) }, ['token'])),
  token_search: def('token_search', 'Find tokens by name or symbol; returns mints with price, market cap and whether verified. Use it when a name is ambiguous.', obj({ query: str('Name or symbol') }, ['query'])),
  token_prices: def('token_prices', 'Live USD prices and 24h change for up to 20 tokens.', obj({ tokens: { type: 'array', items: { type: 'string' }, description: TOKEN } }, ['tokens'])),
  swap_quote: def('swap_quote', 'How much you would get for a trade right now at the best route, with price impact and route. Does not trade.', obj({ sell: str(TOKEN), buy: str(TOKEN), amount: num('Amount of the sold token, in whole tokens') }, ['sell', 'buy', 'amount'])),
  network_status: def('network_status', 'Solana right now: transactions per second, priority fees (low/median/high), epoch progress and SOL price.', obj({}, [])),
  wallet_portfolio: def('wallet_portfolio', 'Every token a mainnet wallet holds, with USD values, sorted by value, and the total.', obj({ address: str('Wallet address') }, ['address'])),
  wallet_activity: def('wallet_activity', 'What a mainnet wallet has done recently, in plain words: swaps, transfers, mints, NFT trades, with times.', obj({ address: str('Wallet address'), limit: num('How many transactions, 1 to 30') }, ['address', 'limit'])),
  explain_transaction: def('explain_transaction', 'Explain a mainnet transaction in plain English: what happened, who paid whom, tokens moved, fee.', obj({ signature: str('Transaction signature') }, ['signature'])),
  propose_swap: def('propose_swap', 'Draft a swap at Jupiter\'s best route for the person you are talking to. Nothing happens until they approve in their wallet. Check token_report first for unknown tokens.',
    obj({ sell: str(TOKEN), buy: str(TOKEN), amount: num('Amount of the sold token, in whole tokens'), note: str('Why, in a few words') }, ['sell', 'buy', 'amount', 'note'])),
  propose_limit_order: def('propose_limit_order', 'Draft a limit order (Jupiter): sell an amount of one token for at least a set amount of another; it fills only at that price or better. Minimum about $5. Nothing happens until the person approves.',
    obj({ sell: str(TOKEN), sell_amount: num('Whole tokens to sell'), buy: str(TOKEN), buy_amount: num('Least whole tokens to receive in total'), note: str('Why, in a few words') }, ['sell', 'sell_amount', 'buy', 'buy_amount', 'note'])),
};

// ---- data helpers ----

async function get<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
  return r.json();
}
async function mainnet<T>(method: string, params: unknown): Promise<T> {
  const j = await get<{ result?: T; error?: string }>(`${API}/mainnet/rpc`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params }) });
  if (j.error) throw new Error(j.error);
  return j.result as T;
}

interface JupToken {
  id: string; name: string; symbol: string; decimals: number; usdPrice?: number; mcap?: number; fdv?: number; liquidity?: number;
  holderCount?: number; isVerified?: boolean; organicScore?: number; organicScoreLabel?: string; createdAt?: string; dev?: string;
  firstPool?: { createdAt?: string }; tags?: string[];
  stats5m?: Stats; stats1h?: Stats; stats6h?: Stats; stats24h?: Stats;
  audit?: { mintAuthorityDisabled?: boolean; freezeAuthorityDisabled?: boolean; topHoldersPercentage?: number; devBalancePercentage?: number; devMints?: number };
}
interface Stats { priceChange?: number; buyVolume?: number; sellVolume?: number; numBuys?: number; numSells?: number; numTraders?: number }

const usd = (n?: number) => (n === undefined || n === null || !Number.isFinite(n) ? '?' : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toPrecision(3)}`);
const pct = (n?: number) => (n === undefined || n === null ? '?' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`);
const ageOf = (iso?: string) => {
  if (!iso) return null;
  const m = (Date.now() - Date.parse(iso)) / 60000;
  return m < 60 ? `${Math.round(m)} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`;
};

async function search(q: string): Promise<JupToken[]> {
  return get<JupToken[]>(`${JUP}/tokens/v2/search?query=${encodeURIComponent(q)}`);
}

// A mint from an address, or the best match for a symbol/name (verified first).
async function resolve(token: unknown): Promise<JupToken> {
  const t = String(token ?? '').trim();
  if (!t) throw new Error('token is required');
  const q = t.toUpperCase() === 'SOL' ? SOL_MINT : t.toUpperCase() === 'USDC' ? USDC_MINT : t;
  const list = await search(q);
  if (B58.test(q)) {
    const hit = list.find((x) => x.id === q);
    if (hit) return hit;
    throw new Error(`Jupiter does not know the token ${short(q)}`);
  }
  const exact = list.filter((x) => x.symbol.toUpperCase() === t.toUpperCase() || x.name.toUpperCase() === t.toUpperCase());
  const pick = exact.find((x) => x.isVerified) ?? exact[0] ?? list.find((x) => x.isVerified) ?? list[0];
  if (!pick) throw new Error(`no token matches "${t}"`);
  return pick;
}

function flags(t: JupToken): string[] {
  const a = t.audit ?? {};
  const f: string[] = [];
  if (a.mintAuthorityDisabled === false) f.push('mint authority ENABLED (more can be minted)');
  if (a.freezeAuthorityDisabled === false) f.push('freeze authority ENABLED (holders can be frozen)');
  if ((a.topHoldersPercentage ?? 0) > 50) f.push(`top holders own ${a.topHoldersPercentage!.toFixed(0)}%`);
  if ((a.devBalancePercentage ?? 0) > 10) f.push(`developer holds ${a.devBalancePercentage!.toFixed(0)}%`);
  const created = t.firstPool?.createdAt ?? t.createdAt;
  const young = !!created && Date.now() - Date.parse(created) < 3_600_000;
  if (!t.liquidity) f.push('no liquidity pool yet');
  else if (t.liquidity < 10_000) f.push(`thin liquidity (${usd(t.liquidity)})`);
  if (!young && (t.organicScore ?? 100) < 30) f.push(`mostly non-organic trading (score ${t.organicScore?.toFixed(0)})`);
  if (created && Date.now() - Date.parse(created) < 3 * 86_400_000) f.push(`only ${ageOf(created)} old`);
  const s = t.stats1h;
  if (s?.sellVolume && s.buyVolume !== undefined && s.sellVolume > 2 * s.buyVolume) f.push('sells are double the buys in the last hour');
  if (!t.isVerified) f.push('not verified on Jupiter');
  return f;
}

function line(t: JupToken, window: 'stats5m' | 'stats1h' | 'stats6h' | 'stats24h' = 'stats24h'): string {
  const s = t[window];
  const vol = s ? (s.buyVolume ?? 0) + (s.sellVolume ?? 0) : undefined;
  return `${t.symbol} (${t.name}) ${t.isVerified ? '✓' : ''} — ${usd(t.usdPrice)}, ${pct(s?.priceChange)} · mcap ${usd(t.mcap)} · liq ${usd(t.liquidity)} · vol ${usd(vol)} · ${t.holderCount?.toLocaleString() ?? '?'} holders · organic ${t.organicScore?.toFixed(0) ?? '?'}\n  mint ${t.id}`;
}

// ---- running ----

export async function runMarketTool(name: string, o: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  switch (name) {
    case 'trending_tokens': {
      const kind = ({ trending: 'toptrending', traded: 'toptraded', organic: 'toporganicscore' } as Record<string, string>)[String(o.kind)] ?? 'toptrending';
      const window = ['5m', '1h', '6h', '24h'].includes(String(o.window)) ? String(o.window) : '1h';
      const list = await get<JupToken[]>(`${JUP}/tokens/v2/${kind}/${window}?limit=10`);
      const key = (`stats${window}`) as 'stats5m' | 'stats1h' | 'stats6h' | 'stats24h';
      return `${o.kind} over ${window}:\n` + list.map((t, i) => `${i + 1}. ${line(t, key)}`).join('\n');
    }

    case 'new_launches': {
      const list = (await get<JupToken[]>(`${JUP}/tokens/v2/recent?limit=12`));
      return 'Just launched (most new tokens go to zero):\n' + list.map((t) => {
        const f = flags(t).filter((x) => !x.startsWith('only') && !x.startsWith('not verified'));
        return `${t.symbol} (${t.name}) — ${ageOf(t.firstPool?.createdAt ?? t.createdAt) ?? '?'} old · mcap ${usd(t.mcap)} · liq ${t.liquidity ? usd(t.liquidity) : 'none yet'} · ${t.holderCount ?? '?'} holders${f.length ? ` · FLAGS: ${f.join('; ')}` : ''}\n  mint ${t.id}`;
      }).join('\n');
    }

    case 'token_search': {
      const list = (await search(String(o.query ?? ''))).slice(0, 6);
      return list.length ? list.map((t) => line(t)).join('\n') : 'No token matches.';
    }

    case 'token_prices': {
      const items = Array.isArray(o.tokens) ? (o.tokens as unknown[]).slice(0, 20) : [];
      if (!items.length) throw new Error('tokens must be a list');
      const tokens = await Promise.all(items.map((x) => resolve(x).catch(() => null)));
      const ok = tokens.filter((t): t is JupToken => !!t);
      const p = await get<Record<string, { usdPrice: number; priceChange24h?: number }>>(`${JUP}/price/v3?ids=${ok.map((t) => t.id).join(',')}`);
      return items.map((x, i) => {
        const t = tokens[i];
        if (!t) return `${x}: unknown token`;
        const q = p[t.id];
        return `${t.symbol}: ${q ? `${usd(q.usdPrice)} (24h ${pct(q.priceChange24h)})` : 'no price'} — mint ${t.id}`;
      }).join('\n');
    }

    case 'token_report': {
      const t = await resolve(o.token);
      const [dex, largest, supply] = await Promise.all([
        get<{ pairs?: DexPair[] }>(`${DEX}/latest/dex/tokens/${t.id}`).catch(() => ({ pairs: [] as DexPair[] })),
        mainnet<{ value: { amount: string }[] }>('getTokenLargestAccounts', [t.id]).catch(() => null),
        mainnet<{ value: { amount: string } }>('getTokenSupply', [t.id]).catch(() => null),
      ]);
      const pairs = (dex.pairs ?? []).filter((p) => p.chainId === 'solana').sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
      const total = supply ? Number(supply.value.amount) : 0;
      const top = largest && total ? largest.value.map((x) => Number(x.amount) / total) : [];
      const top10 = top.slice(0, 10).reduce((a, b) => a + b, 0);
      const s1 = t.stats1h, s24 = t.stats24h;
      const info = pairs[0]?.info;
      const f = flags(t);
      if (top[0] && top[0] > 0.2) f.push(`the largest account holds ${(top[0] * 100).toFixed(0)}% (it may be a pool)`);
      return [
        `${t.name} (${t.symbol}) — ${t.isVerified ? 'verified' : 'NOT verified'} · mint ${t.id}`,
        `price ${usd(t.usdPrice)} · 5m ${pct(t.stats5m?.priceChange)} · 1h ${pct(s1?.priceChange)} · 24h ${pct(s24?.priceChange)}`,
        `market cap ${usd(t.mcap)} · FDV ${usd(t.fdv)} · liquidity ${usd(t.liquidity)} · ${t.holderCount?.toLocaleString() ?? '?'} holders · age ${ageOf(t.firstPool?.createdAt ?? t.createdAt) ?? '?'}`,
        `24h: buys ${usd(s24?.buyVolume)} (${s24?.numBuys ?? '?'} trades) vs sells ${usd(s24?.sellVolume)} (${s24?.numSells ?? '?'}) · ${s24?.numTraders ?? '?'} traders · organic score ${t.organicScore?.toFixed(0) ?? '?'} (${t.organicScoreLabel ?? '?'})`,
        `authorities: mint ${t.audit?.mintAuthorityDisabled ? 'disabled' : 'ENABLED'}, freeze ${t.audit?.freezeAuthorityDisabled ? 'disabled' : 'ENABLED'} · developer holds ${t.audit?.devBalancePercentage?.toFixed(2) ?? '?'}%${t.dev ? ` (${short(t.dev)})` : ''}`,
        top.length ? `top 10 accounts hold ${(top10 * 100).toFixed(1)}% (largest ${(top[0] * 100).toFixed(1)}%; pools and exchanges count here)` : 'top holders: unavailable',
        ...pairs.slice(0, 3).map((p) => `pool ${p.dexId}: ${usd(p.liquidity?.usd)} liquidity · 24h vol ${usd(p.volume?.h24)} · 1h ${p.txns?.h1?.buys ?? '?'} buys/${p.txns?.h1?.sells ?? '?'} sells`),
        info ? `links: ${[...(info.websites ?? []).map((w) => w.url), ...(info.socials ?? []).map((x) => `${x.type}: ${x.url}`)].slice(0, 4).join(' · ') || 'none'}` : 'links: none listed',
        f.length ? `RED FLAGS: ${f.join('; ')}` : 'No red flags found (not a guarantee).',
      ].join('\n');
    }

    case 'swap_quote': {
      const q = await quote(o.sell, o.buy, o.amount);
      return q.text;
    }

    case 'network_status': {
      const [perf, fees, epoch, price] = await Promise.all([
        mainnet<{ numTransactions: number; numNonVoteTransactions?: number; samplePeriodSecs: number }[]>('getRecentPerformanceSamples', [5]),
        mainnet<{ priorityFeeLevels: Record<string, number> }>('getPriorityFeeEstimate', [{ accountKeys: ['JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'], options: { includeAllPriorityFeeLevels: true } }]).catch(() => null),
        mainnet<{ epoch: number; slotIndex: number; slotsInEpoch: number; absoluteSlot: number }>('getEpochInfo', []),
        get<Record<string, { usdPrice: number; priceChange24h?: number }>>(`${JUP}/price/v3?ids=${SOL_MINT}`),
      ]);
      const secs = perf.reduce((n, p) => n + p.samplePeriodSecs, 0);
      const tps = perf.reduce((n, p) => n + p.numTransactions, 0) / secs;
      const userTps = perf.reduce((n, p) => n + (p.numNonVoteTransactions ?? 0), 0) / secs;
      const sol = price[SOL_MINT];
      return [
        `SOL ${usd(sol?.usdPrice)} (24h ${pct(sol?.priceChange24h)})`,
        `throughput ${Math.round(tps).toLocaleString()} tx/s (${Math.round(userTps).toLocaleString()} non-vote)`,
        fees ? `priority fees for a busy program (micro-lamports per compute unit): low ${Math.round(fees.priorityFeeLevels.low)}, medium ${Math.round(fees.priorityFeeLevels.medium)}, high ${Math.round(fees.priorityFeeLevels.high)}, very high ${Math.round(fees.priorityFeeLevels.veryHigh)}` : 'priority fees: unavailable',
        `epoch ${epoch.epoch}, ${((epoch.slotIndex / epoch.slotsInEpoch) * 100).toFixed(1)}% through · slot ${epoch.absoluteSlot.toLocaleString()}`,
      ].join('\n');
    }

    case 'wallet_portfolio': {
      const address = new PublicKey(String(o.address ?? '').trim()).toBase58();
      const r = await mainnet<DasResult>('getAssetsByOwner', { ownerAddress: address, page: 1, limit: 1000, displayOptions: { showFungible: true, showNativeBalance: true } });
      const solUsd = r.nativeBalance?.total_price ?? 0;
      const tokens = r.items.filter((a) => a.token_info && (a.token_info.balance ?? 0) > 0).map((a) => {
        const ti = a.token_info!;
        const amount = (ti.balance ?? 0) / 10 ** (ti.decimals ?? 0);
        return { sym: ti.symbol ?? a.content?.metadata?.symbol ?? short(a.id), mint: a.id, amount, usd: ti.price_info?.total_price ?? 0 };
      }).sort((a, b) => b.usd - a.usd);
      const nfts = r.items.filter((a) => !a.token_info).length;
      const total = solUsd + tokens.reduce((n, t) => n + t.usd, 0);
      return [
        `${short(address)} — total about ${usd(total)}`,
        `SOL: ${(r.nativeBalance?.lamports ?? 0) / 1e9} (${usd(solUsd)})`,
        ...tokens.slice(0, 20).map((t) => `${t.sym}: ${t.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })}${t.usd ? ` (${usd(t.usd)})` : ' (no price)'} — ${t.mint}`),
        tokens.length > 20 ? `…and ${tokens.length - 20} more tokens` : '',
        nfts ? `${nfts} NFTs / other assets` : '',
      ].filter(Boolean).join('\n');
    }

    case 'wallet_activity': {
      const address = new PublicKey(String(o.address ?? '').trim()).toBase58();
      const limit = Math.min(30, Math.max(1, Math.round(Number(o.limit) || 10)));
      const list = await get<Enhanced[]>(`${API}/mainnet/history/${address}?limit=${limit}`);
      if (!list.length) return 'No recent activity.';
      return list.map((t) => `${t.timestamp ? ageOf(new Date(t.timestamp * 1000).toISOString()) + ' ago' : '?'} · ${t.type}${t.source && t.source !== 'UNKNOWN' ? ` via ${t.source}` : ''}: ${(t.description || summarize(t)).slice(0, 220)}`).join('\n');
    }

    case 'explain_transaction': {
      const sig = String(o.signature ?? '').trim();
      if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(sig)) throw new Error('that is not a transaction signature');
      const [t] = await get<Enhanced[]>(`${API}/mainnet/transactions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signatures: [sig] }) });
      if (!t) return 'No such mainnet transaction.';
      return [
        `${t.type}${t.source && t.source !== 'UNKNOWN' ? ` via ${t.source}` : ''}${t.transactionError ? ' — FAILED' : ''}${t.timestamp ? ` · ${new Date(t.timestamp * 1000).toISOString().slice(0, 16)} UTC` : ''}`,
        t.description || summarize(t),
        `fee ${(t.fee ?? 0) / 1e9} SOL paid by ${short(t.feePayer ?? '?')}`,
      ].join('\n');
    }

    case 'propose_swap': {
      const q = await quote(o.sell, o.buy, o.amount);
      if (CLUSTER !== 'mainnet') return `${q.text}\n(This site runs on ${CLUSTER}, so a real swap cannot be drafted here: it would need mainnet.)`;
      ctx.propose({
        id: crypto.randomUUID(), kind: 'swap', title: `Swap ${q.a.symbol} → ${q.b.symbol}`, note: String(o.note ?? ''),
        lines: [['You sell', `${q.amount} ${q.a.symbol}`], ['You get about', `${q.out.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${q.b.symbol}`], ['Price impact', q.impact], ['Route', q.route]],
        build: async (me) => {
          const order = await get<{ transaction: string; requestId: string }>(`${JUP}/ultra/v1/order?inputMint=${q.a.id}&outputMint=${q.b.id}&amount=${q.raw}&taker=${me.toBase58()}`);
          if (!order.transaction) throw new Error('Jupiter did not return a transaction (not enough balance?)');
          return jupiterTx(order.transaction, (signed) => get<{ status: string; signature: string; error?: string }>(`${JUP}/ultra/v1/execute`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signedTransaction: signed, requestId: order.requestId }),
          }).then((j) => { if (j.status !== 'Success') throw new Error(j.error ?? 'the swap failed'); return j.signature; }));
        },
        done: 'Swapped.',
      });
      return `Drafted: ${q.amount} ${q.a.symbol} for about ${q.out} ${q.b.symbol}. Nothing happens until the person approves.`;
    }

    case 'propose_limit_order': {
      const a = await resolve(o.sell), b = await resolve(o.buy);
      const sellAmount = Number(o.sell_amount), buyAmount = Number(o.buy_amount);
      if (!(sellAmount > 0) || !(buyAmount > 0)) throw new Error('amounts must be positive');
      const price = buyAmount / sellAmount;
      const market = (a.usdPrice && b.usdPrice) ? a.usdPrice / b.usdPrice : undefined;
      const text = `limit order: sell ${sellAmount} ${a.symbol} for at least ${buyAmount} ${b.symbol} (${price.toPrecision(5)} ${b.symbol} per ${a.symbol}${market ? `; market is ${market.toPrecision(5)}, so this is ${pct((price / market - 1) * 100)} from market` : ''})`;
      if (CLUSTER !== 'mainnet') return `Would draft a ${text}, but this site runs on ${CLUSTER}; limit orders need mainnet.`;
      const making = BigInt(Math.round(sellAmount * 10 ** a.decimals)).toString();
      const taking = BigInt(Math.round(buyAmount * 10 ** b.decimals)).toString();
      ctx.propose({
        id: crypto.randomUUID(), kind: 'limit', title: `Limit order: ${a.symbol} → ${b.symbol}`, note: String(o.note ?? ''),
        lines: [['You sell', `${sellAmount} ${a.symbol}`], ['For at least', `${buyAmount} ${b.symbol}`], ['Price', `${price.toPrecision(5)} ${b.symbol} per ${a.symbol}`], ...(market ? [['Vs market', pct((price / market - 1) * 100)] as [string, string]] : [])],
        build: async (me) => {
          const order = await get<{ transaction: string; requestId: string }>(`${JUP}/trigger/v1/createOrder`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ inputMint: a.id, outputMint: b.id, maker: me.toBase58(), payer: me.toBase58(), params: { makingAmount: making, takingAmount: taking }, computeUnitPrice: 'auto' }),
          });
          if (!order.transaction) throw new Error('Jupiter did not return an order (below the minimum, or not enough balance?)');
          return jupiterTx(order.transaction, (signed) => get<{ status: string; signature: string; error?: string }>(`${JUP}/trigger/v1/execute`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signedTransaction: signed, requestId: order.requestId }),
          }).then((j) => { if (j.status !== 'Success') throw new Error(j.error ?? 'the order failed'); return j.signature; }));
        },
        done: 'Order placed. It fills when the market reaches your price.',
      });
      return `Drafted a ${text}. Nothing happens until the person approves.`;
    }
  }
  throw new Error(`unknown tool ${name}`);
}

// ---- pieces ----

interface DexPair {
  chainId: string; dexId: string; liquidity?: { usd?: number }; volume?: { h24?: number }; txns?: { h1?: { buys: number; sells: number } };
  info?: { websites?: { url: string }[]; socials?: { type: string; url: string }[] };
}
interface DasResult {
  nativeBalance?: { lamports: number; total_price?: number };
  items: { id: string; content?: { metadata?: { symbol?: string } }; token_info?: { symbol?: string; balance?: number; decimals?: number; price_info?: { total_price?: number } } }[];
}
interface Enhanced {
  description?: string; type: string; source?: string; fee?: number; feePayer?: string; timestamp?: number; transactionError?: unknown;
  nativeTransfers?: { fromUserAccount: string; toUserAccount: string; amount: number }[];
  tokenTransfers?: { fromUserAccount: string; toUserAccount: string; tokenAmount: number; mint: string }[];
}

function summarize(t: Enhanced): string {
  const parts = [
    ...(t.nativeTransfers ?? []).slice(0, 3).map((x) => `${short(x.fromUserAccount)} → ${short(x.toUserAccount)} ${x.amount / 1e9} SOL`),
    ...(t.tokenTransfers ?? []).slice(0, 3).map((x) => `${short(x.fromUserAccount || '?')} → ${short(x.toUserAccount || '?')} ${x.tokenAmount} of ${short(x.mint)}`),
  ];
  return parts.length ? parts.join('; ') : 'no transfers';
}

async function quote(sell: unknown, buy: unknown, amount: unknown) {
  const a = await resolve(sell), b = await resolve(buy);
  const n = Number(amount);
  if (!(n > 0)) throw new Error('amount must be positive');
  const raw = BigInt(Math.round(n * 10 ** a.decimals)).toString();
  const r = await get<{ outAmount: string; priceImpactPct?: string; routePlan?: { percent: number; swapInfo: { label: string } }[]; inUsdValue?: number; outUsdValue?: number }>(
    `${JUP}/ultra/v1/order?inputMint=${a.id}&outputMint=${b.id}&amount=${raw}`);
  const out = Number(r.outAmount) / 10 ** b.decimals;
  const impact = `${(Math.abs(Number(r.priceImpactPct ?? 0)) * 100).toFixed(2)}%`;
  const route = (r.routePlan ?? []).map((x) => `${x.swapInfo.label} ${x.percent}%`).join(' + ') || 'Jupiter';
  const text = `${n} ${a.symbol} → about ${out.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${b.symbol} (${(out / n).toPrecision(6)} ${b.symbol} each) · price impact ${impact} · route ${route}${r.inUsdValue ? ` · worth about ${usd(r.inUsdValue)}` : ''}`;
  return { a, b, amount: n, raw, out, impact, route, text };
}

// A transaction Jupiter built: the viewer signs it, Jupiter sends it.
function jupiterTx(b64: string, execute: (signedB64: string) => Promise<string>): { versioned: VersionedTransaction; execute: (signed: VersionedTransaction) => Promise<string> } {
  const versioned = VersionedTransaction.deserialize(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  return { versioned, execute: (signed) => execute(btoa(String.fromCharCode(...signed.serialize()))) };
}

export type { Proposal };

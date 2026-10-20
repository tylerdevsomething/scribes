// Tools for an inscribed brain. The small models that run in this browser cannot call tools themselves,
// so the page reads the visitor's message, runs the read-only tools it asks for, and hands the model the
// results as facts before it answers. Nothing here acts: actions stay with hybrid brains.
import { calculate, PAGE_TOOLS } from '../../../lib/src/tools.ts';
import { runTool, type ToolContext } from './tools.ts';
import { getScribes } from '../api.ts';

const PER_TOOL = 500; // characters of each result the model is given
const TOTAL = 1200; // and of all of them together (the model's whole context is 2048 tokens)

const ADDRESS = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
const SIGNATURE = /\b[1-9A-HJ-NP-Za-km-z]{80,90}\b/;
const has = (text: string, re: RegExp) => re.test(text.toLowerCase());

// The lookups this message calls for: [tool, input] in the order they are run.
async function wanted(text: string, tools: string[]): Promise<[string, Record<string, unknown>][]> {
  const on = (t: string) => tools.includes(t) && PAGE_TOOLS.includes(t);
  const out: [string, Record<string, unknown>][] = [];
  if (on('clock')) out.push(['clock', {}]);

  if (on('calculator')) {
    for (const m of text.match(/[\d(][\d\s.,+\-*/^()x×]*[\d)]/g) ?? []) {
      if (!/\d\s*[-+*/^x×]\s*[\d(]/.test(m)) continue;
      const expression = m.replace(/[x×]/g, '*').replace(/,/g, '');
      try { calculate(expression); out.push(['calculator', { expression }]); break; } catch { /* not a sum */ }
    }
  }

  const sig = SIGNATURE.exec(text)?.[0];
  if (sig && on('explain_transaction')) out.push(['explain_transaction', { signature: sig }]);

  // a wallet or a token: the words around the address decide
  const addresses = (text.replace(SIGNATURE, '').match(ADDRESS) ?? []).slice(0, 2);
  const walletWords = has(text, /\b(wallet|holds?|holding|portfolio|balance|owns?|doing|activity|recent|transactions?|bought|sold)\b/);
  const reportWords = has(text, /\b(report|safe|rug|scam|check|legit|holders|liquidity|dev)\b/);
  const tokens: string[] = [];
  for (const a of addresses) {
    if (walletWords && (on('wallet_portfolio') || on('wallet_activity'))) {
      const activity = has(text, /\b(doing|activity|recent|transactions?|bought|sold)\b/) && on('wallet_activity');
      out.push([activity || !on('wallet_portfolio') ? 'wallet_activity' : 'wallet_portfolio', activity || !on('wallet_portfolio') ? { address: a, limit: 5 } : { address: a }]);
    } else tokens.push(a);
  }
  for (const m of text.matchAll(/\$([A-Za-z][A-Za-z0-9]{1,9})\b/g)) tokens.push(m[1].toUpperCase());
  if (has(text, /\b(sol|solana)\b.*\bprice\b|\bprice\b.*\b(sol|solana)\b/) && !tokens.length) tokens.push('SOL');
  if (tokens.length) {
    if (reportWords && on('token_report')) out.push(['token_report', { token: tokens[0] }]);
    else if (on('token_prices')) out.push(['token_prices', { tokens: [...new Set(tokens)].slice(0, 5) }]);
    else if (on('token_report')) out.push(['token_report', { token: tokens[0] }]);
  }

  if (on('trending_tokens') && has(text, /\b(trending|hot|pumping|movers|top tokens)\b/)) out.push(['trending_tokens', { kind: 'trending', window: '1h' }]);
  if (on('network_status') && has(text, /\b(fees?|tps|network|congest\w*|epoch|gas)\b/)) out.push(['network_status', {}]);
  if (on('scribe_market') && has(text, /\b(floor|listed|listings?|for sale|market|cheapest|sales)\b/)) out.push(['scribe_market', {}]);

  if (on('scribe_lookup')) {
    const n = /#(\d{1,5})\b/.exec(text)?.[1];
    if (n) out.push(['scribe_lookup', { query: `#${n}` }]);
    else {
      // another scribe named in the message (the list is skipped if it is slow to come)
      const all = await Promise.race([getScribes(), new Promise<never>((_, no) => setTimeout(() => no(new Error('slow')), 3000))]).catch(() => []);
      const named = all.find((s) => s.name && s.name.length >= 3 && new RegExp(`\\b${s.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
      if (named) out.push(['scribe_lookup', { query: named.address }]);
    }
  }
  return out;
}

// Runs the lookups and returns the facts to put before the model, or '' when the message needs none.
export async function lookUp(text: string, tools: string[], ctx: ToolContext, onTool?: (name: string, input: unknown) => void): Promise<string> {
  const facts: string[] = [];
  let used = 0;
  for (const [name, input] of await wanted(text, tools)) {
    onTool?.(name, input);
    let r: string;
    try { r = await runTool(name, input, ctx); } catch (e) { r = `could not be looked up (${(e as Error).message})`; }
    r = r.length > PER_TOOL ? `${r.slice(0, PER_TOOL)}…` : r;
    if (used + r.length > TOTAL) break;
    used += r.length;
    facts.push(`[${name.replace(/_/g, ' ')}] ${r}`);
  }
  return facts.length ? `\n\n(Looked up just now. Answer from these facts and do not invent others:\n${facts.join('\n')})` : '';
}

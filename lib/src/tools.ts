// The official scribe tools: the catalog, and the parts shared by the site and tests
// (no browser or chain access here). A scribe gets the tools its personality declares.

export type ToolGroup = 'think' | 'market' | 'wallet' | 'scribes' | 'propose';

export interface ToolInfo {
  name: string;
  label: string;
  group: ToolGroup;
  summary: string;
  aliases?: string[];
}

// Market and wallet tools always read real mainnet data, whatever network the site runs on.
export const TOOL_CATALOG: ToolInfo[] = [
  // thinking and the web
  { name: 'calculator', label: 'Calculator', group: 'think', summary: 'Exact arithmetic.', aliases: ['math'] },
  { name: 'clock', label: 'Date & time', group: 'think', summary: "Knows today's date and time.", aliases: ['time', 'date'] },
  { name: 'web_search', label: 'Web search', group: 'think', summary: 'Searches the web and news.', aliases: ['search'] },
  { name: 'web_fetch', label: 'Read a web page', group: 'think', summary: 'Reads a page from a link (docs, threads, announcements).', aliases: ['fetch', 'browse'] },
  // the market
  { name: 'trending_tokens', label: 'Trending tokens', group: 'market', summary: 'What is trending, most traded or most organic right now (5m to 24h).', aliases: ['trending', 'hot'] },
  { name: 'new_launches', label: 'New launches', group: 'market', summary: 'Tokens that just launched, with quick risk flags.', aliases: ['launches', 'new_tokens'] },
  { name: 'token_report', label: 'Token report', group: 'market', summary: 'Deep dive: price, market cap, liquidity, pools, buys vs sells, top holders, authorities, red flags.', aliases: ['token_safety', 'rugcheck', 'safety', 'analyze'] },
  { name: 'token_search', label: 'Token search', group: 'market', summary: 'Finds a token by name or symbol and gives its mint.', aliases: ['token_lookup', 'token', 'tokens'] },
  { name: 'token_prices', label: 'Prices', group: 'market', summary: 'Live USD prices for several tokens at once.', aliases: ['price', 'prices'] },
  { name: 'swap_quote', label: 'Swap quote', group: 'market', summary: 'Best route and price for a trade, with price impact, without trading.', aliases: ['quote'] },
  { name: 'network_status', label: 'Network status', group: 'market', summary: 'Solana throughput, priority fees right now, epoch, SOL price.', aliases: ['fees', 'network', 'gas'] },
  // wallets
  { name: 'wallet_portfolio', label: 'Wallet portfolio', group: 'wallet', summary: 'Every token a wallet holds with USD values and the total.', aliases: ['read_wallet', 'wallet', 'portfolio'] },
  { name: 'wallet_activity', label: 'Wallet activity', group: 'wallet', summary: 'What a wallet has been doing: swaps, transfers, mints, in plain words.', aliases: ['activity', 'whale', 'track'] },
  { name: 'explain_transaction', label: 'Explain a transaction', group: 'wallet', summary: 'Plain-English breakdown of any transaction.', aliases: ['transaction', 'tx'] },
  // scribes
  { name: 'ask_scribe', label: 'Ask another scribe', group: 'scribes', summary: 'Consults another scribe and brings back its answer.', aliases: ['consult'] },
  { name: 'scribe_lookup', label: 'Look up a scribe', group: 'scribes', summary: 'Finds a scribe by name or number: rarity, owner, price.', aliases: ['scribes'] },
  { name: 'scribe_market', label: 'Scribe market', group: 'scribes', summary: 'Floor price, listings and recent sales of scribes.', aliases: ['market'] },
  { name: 'bounty_board', label: 'Bounty board', group: 'scribes', summary: 'Open bounties: questions with a SOL reward.', aliases: ['bounties'] },
  { name: 'answer_bounty', label: 'Answer a bounty', group: 'scribes', summary: 'Proposes an answer to a bounty; the owner approves and it is inscribed.', aliases: ['answer'] },
  { name: 'library', label: 'Library', group: 'scribes', summary: 'Searches and reads the archive inscribed with it (needs a library file).', aliases: ['archive'] },
  { name: 'journal', label: 'Journal', group: 'scribes', summary: 'Proposes a memory; if the owner approves, it is inscribed and remembered.', aliases: ['remember', 'memory', 'diary'] },
  // actions: drafted by the scribe, approved (or not) in the viewer's own wallet
  { name: 'propose_swap', label: 'Swap', group: 'propose', summary: "Drafts a swap at Jupiter's best route.", aliases: ['swap', 'trade'] },
  { name: 'propose_limit_order', label: 'Limit order', group: 'propose', summary: 'Drafts a buy or sell that fills only at your price.', aliases: ['limit', 'limit_order'] },
  { name: 'propose_transfer', label: 'Send SOL', group: 'propose', summary: 'Drafts a SOL transfer.', aliases: ['transfer', 'send'] },
  { name: 'propose_token_transfer', label: 'Send tokens', group: 'propose', summary: 'Drafts a token transfer.' },
  { name: 'propose_message', label: 'On-chain message', group: 'propose', summary: 'Drafts a public message written to Solana.', aliases: ['memo', 'message'] },
  { name: 'propose_scribe_trade', label: 'Buy, list or tip scribes', group: 'propose', summary: 'Drafts buying, listing or tipping a scribe.', aliases: ['trade_scribe'] },
];

// Bounties are paused for now: their tools stay in the catalog (so old personalities still parse) but are never enabled.
export const PAUSED_TOOLS = ['bounty_board', 'answer_bounty'];
export const ACTIVE_TOOLS = TOOL_CATALOG.filter((t) => !PAUSED_TOOLS.includes(t.name));

export const OFFICIAL_TOOLS = ACTIVE_TOOLS.map((t) => t.name);

// The read-only tools an inscribed brain can have: the page runs them from the visitor's message and gives
// the model the results (site/src/run/lookup.ts). Only models this size or larger get them.
export const PAGE_TOOLS = ['calculator', 'clock', 'trending_tokens', 'token_report', 'token_prices', 'network_status', 'wallet_portfolio', 'wallet_activity', 'explain_transaction', 'scribe_lookup', 'scribe_market'];
export const PAGE_TOOLS_MIN_PARAMS = 400e6;

export const GROUP_LABELS: Record<ToolGroup, string> = {
  think: 'Thinking & the web', market: 'Market (live mainnet data)', wallet: 'Wallets (mainnet)', scribes: 'Scribes', propose: 'Actions: you approve each one in your wallet',
};

// One-click sets of tools for common kinds of scribe.
export const PRESETS: { name: string; hint: string; tools: string[] }[] = [
  { name: 'Trader', hint: 'Finds and checks tokens, quotes and drafts trades',
    tools: ['trending_tokens', 'new_launches', 'token_report', 'token_search', 'token_prices', 'swap_quote', 'network_status', 'wallet_portfolio', 'propose_swap', 'propose_limit_order', 'calculator'] },
  { name: 'Researcher', hint: 'Digs into tokens, wallets and the news',
    tools: ['token_report', 'token_search', 'token_prices', 'wallet_portfolio', 'wallet_activity', 'explain_transaction', 'web_search', 'web_fetch', 'calculator', 'clock'] },
  { name: 'Wallet watcher', hint: 'Tracks wallets and explains transactions',
    tools: ['wallet_portfolio', 'wallet_activity', 'explain_transaction', 'token_prices', 'token_report', 'clock'] },
  { name: 'Collector', hint: 'Lives in the scribe world: the market and other scribes',
    tools: ['scribe_market', 'scribe_lookup', 'ask_scribe', 'journal', 'propose_scribe_trade'] },
  { name: 'Everything', hint: 'All official tools', tools: OFFICIAL_TOOLS.filter((t) => t !== 'library') }, // the library comes with a library file
];

// Personality tool names are free text: match them loosely to the catalog (name, label or alias).
export function enabledTools(declared: string[] | undefined): string[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  const want = new Set((declared ?? []).map(norm));
  return ACTIVE_TOOLS.filter((t) => [t.name, t.label, ...(t.aliases ?? [])].some((x) => want.has(norm(x)))).map((t) => t.name);
}

// Arithmetic only: a tiny parser, never eval.
export function calculate(expr: string): number {
  const tokens = expr.replace(/\s+/g, '').match(/\d+(?:\.\d+)?|[-+*/^()]/g);
  if (!tokens || tokens.join('') !== expr.replace(/\s+/g, '')) throw new Error('only numbers and + - * / ^ ( ) are allowed');
  let i = 0;
  const peek = () => tokens[i];
  const prim = (): number => {
    const t = tokens[i++];
    if (t === '(') { const v = sum(); if (tokens[i++] !== ')') throw new Error('missing )'); return v; }
    if (t === '-') return -prim();
    const v = Number(t);
    if (!Number.isFinite(v)) throw new Error('bad number');
    return v;
  };
  const pow = (): number => { const b = prim(); if (peek() === '^') { i++; return b ** pow(); } return b; };
  const prod = (): number => { let v = pow(); while (peek() === '*' || peek() === '/') v = tokens[i++] === '*' ? v * pow() : v / pow(); return v; };
  const sum = (): number => { let v = prod(); while (peek() === '+' || peek() === '-') v = tokens[i++] === '+' ? v + prod() : v - prod(); return v; };
  const v = sum();
  if (i !== tokens.length) throw new Error('unexpected input');
  return v;
}

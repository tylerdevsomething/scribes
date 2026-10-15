// The official scribe tools: the catalog, and the parts shared by the site and tests
// (no browser or chain access here). A scribe gets the tools its personality declares.

export type ToolGroup = 'think' | 'solana' | 'scribes' | 'propose';

export interface ToolInfo {
  name: string;
  label: string;
  group: ToolGroup;
  summary: string;
  aliases?: string[];
}

export const TOOL_CATALOG: ToolInfo[] = [
  // thinking and the web
  { name: 'calculator', label: 'Calculator', group: 'think', summary: 'Exact arithmetic.', aliases: ['math'] },
  { name: 'clock', label: 'Date & time', group: 'think', summary: 'Knows today\'s date and time.', aliases: ['time', 'date'] },
  { name: 'web_search', label: 'Web search', group: 'think', summary: 'Searches the web.', aliases: ['search'] },
  { name: 'web_fetch', label: 'Read a web page', group: 'think', summary: 'Reads a page from a link.', aliases: ['fetch', 'browse'] },
  // Solana, read only
  { name: 'token_lookup', label: 'Token lookup', group: 'solana', summary: 'Finds a token by name, symbol or address: price, liquidity, verified.', aliases: ['token', 'tokens'] },
  { name: 'token_safety', label: 'Token safety check', group: 'solana', summary: 'Mint and freeze authority, holder concentration, organic score.', aliases: ['rugcheck', 'safety'] },
  { name: 'token_prices', label: 'Prices', group: 'solana', summary: 'Live USD prices for tokens.', aliases: ['price', 'prices'] },
  { name: 'wallet_portfolio', label: 'Wallet portfolio', group: 'solana', summary: 'SOL and tokens a wallet holds.', aliases: ['read_wallet', 'wallet', 'portfolio'] },
  { name: 'explain_transaction', label: 'Explain a transaction', group: 'solana', summary: 'Plain-English breakdown of a transaction.', aliases: ['transaction', 'tx'] },
  // scribes
  { name: 'ask_scribe', label: 'Ask another scribe', group: 'scribes', summary: 'Consults another scribe and brings back its answer.', aliases: ['consult'] },
  { name: 'scribe_lookup', label: 'Look up a scribe', group: 'scribes', summary: 'Finds a scribe by name or number: rarity, owner, price.', aliases: ['scribes'] },
  { name: 'scribe_market', label: 'Read the market', group: 'scribes', summary: 'Floor price, listings and recent sales.', aliases: ['market'] },
  { name: 'bounty_board', label: 'Bounty board', group: 'scribes', summary: 'Reads open bounties: questions with a SOL reward.', aliases: ['bounties'] },
  { name: 'answer_bounty', label: 'Answer a bounty', group: 'scribes', summary: 'Proposes an answer to a bounty; the owner approves and it is inscribed.', aliases: ['answer'] },
  { name: 'journal', label: 'Journal', group: 'scribes', summary: 'Proposes a memory; if the owner approves, it is inscribed and remembered.', aliases: ['remember', 'memory', 'diary'] },
  // proposals: drafted by the scribe, approved (or not) in the viewer's own wallet
  { name: 'propose_transfer', label: 'Send SOL', group: 'propose', summary: 'Drafts a SOL transfer.', aliases: ['transfer', 'send'] },
  { name: 'propose_token_transfer', label: 'Send tokens', group: 'propose', summary: 'Drafts a token transfer.' },
  { name: 'propose_swap', label: 'Swap (Jupiter)', group: 'propose', summary: 'Drafts a token swap at the best route (mainnet).', aliases: ['swap', 'trade'] },
  { name: 'propose_message', label: 'On-chain message', group: 'propose', summary: 'Drafts a public message written to Solana.', aliases: ['memo', 'message'] },
  { name: 'propose_scribe_trade', label: 'Buy, list or tip scribes', group: 'propose', summary: 'Drafts buying, listing or tipping a scribe.', aliases: ['trade_scribe'] },
];

export const OFFICIAL_TOOLS = TOOL_CATALOG.map((t) => t.name);

export const GROUP_LABELS: Record<ToolGroup, string> = {
  think: 'Thinking & the web', solana: 'Solana (read only)', scribes: 'Scribes', propose: 'Proposals — you approve in your wallet',
};

// Personality tool names are free text: match them loosely to the catalog (name, label or alias).
export function enabledTools(declared: string[] | undefined): string[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  const want = new Set((declared ?? []).map(norm));
  return TOOL_CATALOG.filter((t) => [t.name, t.label, ...(t.aliases ?? [])].some((x) => want.has(norm(x)))).map((t) => t.name);
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

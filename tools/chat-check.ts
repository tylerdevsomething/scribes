// Real conversations with a Claude-bound scribe through the site's own brain and tools, to see how the
// tools are used. Needs ANTHROPIC_API_KEY (and the API server for mainnet reads) and costs a little.
//   node tools/chat-check.ts [--api http://localhost:8790] [--model claude-opus-5-5] [--only 1,3]
import '../site/src/polyfill.ts';
import { readFileSync } from 'node:fs';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const api = arg('api', 'http://localhost:8790');
const model = arg('model', 'claude-opus-5-5');
const only = arg('only', '').split(',').filter(Boolean).map(Number);
const key = process.env.ANTHROPIC_API_KEY ?? readFileSync('.env', 'utf8').match(/^ANTHROPIC_API_KEY=(.+)$/m)?.[1]?.trim();
if (!key) throw new Error('ANTHROPIC_API_KEY is not set (put it in .env)');

// The site calls /api/...; point that at the running server.
const realFetch = globalThis.fetch;
globalThis.fetch = ((u: RequestInfo | URL, i?: RequestInit) => realFetch(typeof u === 'string' && u.startsWith('/api') ? `${api}${u.slice(4)}` : u, i)) as typeof fetch;

const { loadBound } = await import('../site/src/run/bound.ts');
const { systemPrompt } = await import('../lib/src/personality.ts');
const { enabledTools } = await import('../lib/src/tools.ts');
const { PRESETS } = await import('../lib/src/tools.ts');

const personality = {
  name: 'Ledger',
  purpose: 'A careful Solana trading companion: finds opportunities, checks them properly and drafts trades for its owner.',
  voice: 'Brief, direct, numbers first. Plain words, no hype. Says clearly when something looks risky.',
  boundaries: 'Never promises returns or tells anyone what to buy; it lays out the facts and the risks. Never moves funds itself: it only drafts actions for the owner to approve.',
  tools: [...PRESETS.find((p) => p.name === 'Trader')!.tools, 'journal', 'bounty_board', 'wallet_activity', 'web_search'],
};
const tools = enabledTools(personality.tools);

const SCENARIOS = [
  'Is BONK safe to buy right now? Give me the key numbers.',
  "What's trending on Solana in the last hour? Anything that looks real rather than bot volume?",
  'Find me something that launched in the last hour and tell me honestly whether it looks like a rug.',
  'Quote me 1 SOL to JUP, and if it looks fine, set up the swap.',
  'What has wallet 7cH5DFj8NRmUkK8dBiut5xwYTCQatiGoF9dumVQTuwRH been doing lately, and what does it hold?',
  'Are fees high right now? I want to make a trade and not overpay.',
  'Remember that I prefer low-cap AI tokens and never want more than 0.5 SOL in one trade.',
  'Put in a limit order to sell 0.2 SOL if SOL goes 10% above where it is now.',
];

const brain = loadBound('anthropic', model, key);
let total = 0;
for (const [i, q] of SCENARIOS.entries()) {
  if (only.length && !only.includes(i + 1)) continue;
  const used: string[] = [];
  const proposals: string[] = [];
  const t0 = Date.now();
  try {
    const reply = await brain.reply(systemPrompt(personality), [{ role: 'user', content: q }], () => {}, new AbortController().signal, {
      tools, scribe: { address: '36YPDPUPoZ8TG5Mcfnr1HPWKTXsYPrrS2vKjx86V26JW', owner: 'CxzxDF2N9AtQ8ZZWuNCeVqbEcoitdxmXEJzkRLPPh7it', name: personality.name },
      propose: (p) => proposals.push(`${p.title} — ${p.lines.map(([k, v]) => `${k}: ${v}`).join(', ')}`),
      onTool: (name, input) => used.push(`${name}(${JSON.stringify(input).slice(0, 80)})`),
    });
    total += Date.now() - t0;
    console.log(`\n=== ${i + 1}. ${q}\n--- tools: ${used.join(' → ') || 'none'}${proposals.length ? `\n--- proposals: ${proposals.join(' | ')}` : ''}\n--- ${((Date.now() - t0) / 1000).toFixed(1)} s\n${reply.trim()}`);
  } catch (e) {
    console.log(`\n=== ${i + 1}. ${q}\n--- ERROR: ${(e as Error).message}\n--- tools so far: ${used.join(' → ')}`);
  }
}
console.log(`\n${(total / 1000).toFixed(0)} s in total`);
process.exit(0);

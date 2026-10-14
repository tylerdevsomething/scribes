// The official tools a scribe can use (bound brains only, for now). A scribe gets the tools its
// personality declares; anything else it declares shows as "declared" and does nothing.
// Nothing here can move funds: propose_transfer only drafts a transfer, which the viewer may approve
// in their own wallet.
import type Anthropic from '@anthropic-ai/sdk';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { conn } from '../config.ts';
import { calculate } from '../../../lib/src/tools.ts';
export { enabledTools, OFFICIAL_TOOLS } from '../../../lib/src/tools.ts';

export interface Proposal { id: string; to: string; lamports: number; note: string }

export function toolDefinitions(enabled: string[]): Anthropic.Beta.BetaToolUnion[] {
  const defs: Anthropic.Beta.BetaToolUnion[] = [];
  if (enabled.includes('calculator')) defs.push({
    name: 'calculator', description: 'Evaluate an arithmetic expression with + - * / ^ ( ) and decimals. Use it for any sum you are not sure of.',
    input_schema: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'], additionalProperties: false },
    strict: true, eager_input_streaming: true,
  });
  if (enabled.includes('read_wallet')) defs.push({
    name: 'read_wallet', description: 'Read the SOL balance of a Solana wallet address.',
    input_schema: { type: 'object', properties: { address: { type: 'string' } }, required: ['address'], additionalProperties: false },
    strict: true, eager_input_streaming: true,
  });
  if (enabled.includes('propose_transfer')) defs.push({
    name: 'propose_transfer',
    description: 'Draft a SOL transfer from the person you are talking to, to an address. It does NOT send anything: the person sees it and may approve it in their own wallet. Only propose a transfer the person asked for.',
    input_schema: {
      type: 'object',
      properties: { to: { type: 'string', description: 'Recipient wallet address' }, amount_sol: { type: 'number' }, note: { type: 'string', description: 'Why, in a few words' } },
      required: ['to', 'amount_sol', 'note'], additionalProperties: false,
    },
    strict: true, eager_input_streaming: true,
  });
  if (enabled.includes('web_search')) defs.push({ type: 'web_search_20260209', name: 'web_search', max_uses: 3 });
  return defs;
}

// Runs one client tool. Inputs are checked here: streamed tool inputs are not validated upstream.
export async function runTool(name: string, input: unknown, propose: (p: Proposal) => void): Promise<string> {
  const o = (input ?? {}) as Record<string, unknown>;
  if (name === 'calculator') {
    if (typeof o.expression !== 'string') throw new Error('expression must be a string');
    return String(calculate(o.expression));
  }
  if (name === 'read_wallet') {
    if (typeof o.address !== 'string') throw new Error('address must be a string');
    const lamports = await conn.getBalance(new PublicKey(o.address));
    return `${lamports / LAMPORTS_PER_SOL} SOL`;
  }
  if (name === 'propose_transfer') {
    if (typeof o.to !== 'string' || typeof o.amount_sol !== 'number' || typeof o.note !== 'string') throw new Error('to, amount_sol and note are required');
    const to = new PublicKey(o.to).toBase58();
    const lamports = Math.round(o.amount_sol * LAMPORTS_PER_SOL);
    if (!(lamports > 0) || lamports > 1000 * LAMPORTS_PER_SOL) throw new Error('amount must be between 0 and 1000 SOL');
    propose({ id: crypto.randomUUID(), to, lamports, note: o.note.slice(0, 200) });
    return 'Proposed. The person sees it and decides whether to approve it in their wallet; nothing has been sent.';
  }
  throw new Error(`unknown tool ${name}`);
}

// Hosted brains: the server talks to Claude with the operator's key so visitors can chat with Claude-bound
// scribes without a key of their own. Every call is locked to one scribe: the server builds the system
// prompt from its inscribed personality and journal and offers only its tools, so the key cannot be used
// as a general-purpose assistant. Tools still run in the visitor's browser (reads, and proposals they
// approve in their own wallet). Limits: messages per visitor per day, and a daily budget for the site.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { systemPrompt } from '../../lib/src/personality.ts';
import { enabledTools } from '../../lib/src/tools.ts';
import { toolDefinitions } from '../../site/src/run/tools.ts';
import type { Indexer } from './indexer.ts';

// USD per million tokens (input, output) and per web search.
const PRICES: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5],
};
const WEB_SEARCH_USD = 0.01;
const MAX_TOKENS = 4000;
const MAX_MESSAGES = 60; // entries in one request (tool rounds included)
const MAX_BYTES = 300_000;

export interface BrainLimits { perVisitorPerDay: number; dailyBudgetUsd: number }

interface Ledger { day: string; spentUsd: number; visitors: Record<string, number> }

export class HostedBrain {
  private client: Anthropic;
  private indexer: Indexer;
  private limits: BrainLimits;
  private path: string;
  private ledger: Ledger;

  constructor(opts: { apiKey: string; indexer: Indexer; limits: BrainLimits; statePath: string }) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.indexer = opts.indexer;
    this.limits = opts.limits;
    this.path = opts.statePath;
    this.ledger = existsSync(this.path) ? JSON.parse(readFileSync(this.path, 'utf8')) : { day: '', spentUsd: 0, visitors: {} };
  }

  private today(): Ledger {
    const day = new Date().toISOString().slice(0, 10);
    if (this.ledger.day !== day) this.ledger = { day, spentUsd: 0, visitors: {} };
    return this.ledger;
  }
  private save() { try { writeFileSync(this.path, JSON.stringify(this.ledger)); } catch { /* best effort */ } }

  status(visitor: string) {
    const l = this.today();
    const open = l.spentUsd < this.limits.dailyBudgetUsd;
    return {
      enabled: true,
      open,
      remaining: open ? Math.max(0, this.limits.perVisitorPerDay - (l.visitors[visitor] ?? 0)) : 0,
      perDay: this.limits.perVisitorPerDay,
    };
  }

  // POST /brain  { scribe, messages }  →  server-sent events: {type:'text', text} … {type:'done', message}
  async handle(req: IncomingMessage, res: ServerResponse, visitor: string, body: unknown, json: (res: ServerResponse, code: number, data: unknown) => void) {
    const { scribe: address, messages } = (body ?? {}) as { scribe?: string; messages?: Anthropic.Beta.BetaMessageParam[] };
    if (typeof address !== 'string' || !Array.isArray(messages) || messages.length === 0) return json(res, 400, { error: 'scribe and messages are required' });
    if (messages.length > MAX_MESSAGES || JSON.stringify(messages).length > MAX_BYTES) return json(res, 413, { error: 'this conversation is too long for the free brain: start a new one' });
    if (messages[0].role !== 'user' || messages[messages.length - 1].role !== 'user') return json(res, 400, { error: 'a conversation starts and ends with the user' });

    const s = this.indexer.get(address);
    const personality = s ? this.indexer.personality(address) : null;
    if (!s || !personality || s.hidden || s.status.state !== 'complete') return json(res, 404, { error: 'no such scribe' });
    if (s.brain?.kind !== 'bound' || s.brain.provider !== 'anthropic') return json(res, 400, { error: 'this scribe does not think with Claude' });
    const model = PRICES[s.brain.model] ? s.brain.model : 'claude-sonnet-5-5'; // unknown models run on Sonnet

    const l = this.today();
    if (l.spentUsd >= this.limits.dailyBudgetUsd) return json(res, 429, { error: 'The free brain is resting until tomorrow. Use your own Anthropic key to keep talking.', budget: true });
    // A new user turn (not a tool round) counts against the visitor's daily messages.
    const last = messages[messages.length - 1];
    const newTurn = typeof last.content === 'string' || (Array.isArray(last.content) && !last.content.some((b) => (b as { type: string }).type === 'tool_result'));
    if (newTurn) {
      if ((l.visitors[visitor] ?? 0) >= this.limits.perVisitorPerDay) return json(res, 429, { error: `That's all ${this.limits.perVisitorPerDay} free messages for today. Use your own Anthropic key to keep talking.` });
      l.visitors[visitor] = (l.visitors[visitor] ?? 0) + 1;
      this.save();
    }

    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'access-control-allow-origin': '*' });
    const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    const abort = new AbortController();
    req.on('close', () => abort.abort());
    try {
      const tools = toolDefinitions(enabledTools(personality.tools));
      const stream = this.client.beta.messages.stream({
        model, max_tokens: MAX_TOKENS,
        system: systemPrompt(personality, s.journal.map((j) => j.text)),
        messages,
        ...(tools.length ? { tools } : {}),
        output_config: { effort: 'low' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      }, { signal: abort.signal });
      stream.on('text', (text) => send({ type: 'text', text }));
      const message = await stream.finalMessage();
      this.charge(model, message.usage);
      send({ type: 'done', message });
    } catch (e) {
      send({ type: 'error', error: e instanceof Anthropic.APIError ? `Claude answered ${e.status}` : (e as Error).message });
    } finally {
      res.end();
    }
  }

  private charge(model: string, u: Anthropic.Beta.BetaUsage) {
    const [inp, out] = PRICES[model];
    const tokensIn = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1;
    const searches = u.server_tool_use?.web_search_requests ?? 0;
    this.today().spentUsd += (tokensIn * inp + (u.output_tokens ?? 0) * out) / 1e6 + searches * WEB_SEARCH_USD;
    this.save();
  }
}

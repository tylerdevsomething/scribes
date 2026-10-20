// Hosted brains: the server talks to Claude or Grok with the operator's keys so visitors can chat with
// hybrid scribes without a key of their own. Every call is locked to one scribe: the server builds the system
// prompt from its inscribed personality and journal and offers only its tools, so the key cannot be used
// as a general-purpose assistant. Tools still run in the visitor's browser (reads, and proposals they
// approve in their own wallet). Limits: messages per visitor per day, and a daily budget for the site.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { systemPrompt } from '../../lib/src/personality.ts';
import { enabledTools } from '../../lib/src/tools.ts';
import { toolDefinitions } from '../../site/src/run/tools.ts';
import { XAI_URL } from '../../lib/src/hybrid.ts';
import type { Indexer } from './indexer.ts';

// USD per million tokens (input, output) and per web search.
const PRICES: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5],
  'grok-4.7': [2, 6], 'grok-4.3': [1.25, 2.5], 'grok-4.20-0309-non-reasoning': [1.25, 2.5],
};
const WEB_SEARCH_USD = 0.01;
const MAX_TOKENS = 4000;
const MAX_MESSAGES = 60; // entries in one request (tool rounds included)
const MAX_BYTES = 300_000;

export interface BrainLimits { perVisitorPerDay: number; dailyBudgetUsd: number }

interface Ledger { day: string; spentUsd: number; visitors: Record<string, number> }

export class HostedBrain {
  private client: Anthropic | null;
  private xaiKey: string | null;
  private indexer: Indexer;
  private limits: BrainLimits;
  private path: string;
  private ledger: Ledger;

  constructor(opts: { apiKey?: string; xaiKey?: string; indexer: Indexer; limits: BrainLimits; statePath: string }) {
    this.client = opts.apiKey ? new Anthropic({ apiKey: opts.apiKey }) : null;
    this.xaiKey = opts.xaiKey ?? null;
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
      providers: { anthropic: !!this.client, xai: !!this.xaiKey },
      open,
      remaining: open ? Math.max(0, this.limits.perVisitorPerDay - (l.visitors[visitor] ?? 0)) : 0,
      perDay: this.limits.perVisitorPerDay,
    };
  }

  // The checks both providers share: a real hybrid scribe on this provider, a sane conversation, and the
  // limits. A new user turn (not a tool round) counts against the visitor's daily messages.
  private admit(res: ServerResponse, visitor: string, body: unknown, provider: 'anthropic' | 'xai', newTurn: (last: { role: string; content: unknown }) => boolean, json: (res: ServerResponse, code: number, data: unknown) => void) {
    const { scribe: address, messages } = (body ?? {}) as { scribe?: string; messages?: { role: string; content: unknown }[] };
    const who = provider === 'anthropic' ? 'Claude' : 'Grok', keyName = provider === 'anthropic' ? 'Anthropic' : 'xAI';
    if (typeof address !== 'string' || !Array.isArray(messages) || messages.length === 0) return void json(res, 400, { error: 'scribe and messages are required' });
    if (messages.length > MAX_MESSAGES || JSON.stringify(messages).length > MAX_BYTES) return void json(res, 413, { error: 'this conversation is too long for the free brain: start a new one' });
    const last = messages[messages.length - 1];
    if (messages[0].role !== 'user' || (last.role !== 'user' && last.role !== 'tool')) return void json(res, 400, { error: 'a conversation starts and ends with the user' });
    if (messages.some((m) => m.role === 'system')) return void json(res, 400, { error: 'the scribe\'s own inscription is its only system prompt' });

    const s = this.indexer.get(address);
    const personality = s ? this.indexer.personality(address) : null;
    if (!s || !personality || s.hidden || s.status.state !== 'complete') return void json(res, 404, { error: 'no such scribe' });
    if (s.brain?.kind !== 'bound' || s.brain.provider !== provider) return void json(res, 400, { error: `this scribe does not think with ${who}` });

    const l = this.today();
    if (l.spentUsd >= this.limits.dailyBudgetUsd) return void json(res, 429, { error: `The free brain is resting until tomorrow. Use your own ${keyName} key to keep talking.`, budget: true });
    if (newTurn(last)) {
      if ((l.visitors[visitor] ?? 0) >= this.limits.perVisitorPerDay) return void json(res, 429, { error: `That's all ${this.limits.perVisitorPerDay} free messages for today. Use your own ${keyName} key to keep talking.` });
      l.visitors[visitor] = (l.visitors[visitor] ?? 0) + 1;
      this.save();
    }
    return { s, personality, messages, model: s.brain.model };
  }

  // POST /brain  { scribe, messages }  →  server-sent events: {type:'text', text} … {type:'done', message}
  async handle(req: IncomingMessage, res: ServerResponse, visitor: string, body: unknown, json: (res: ServerResponse, code: number, data: unknown) => void) {
    if (!this.client) return json(res, 400, { error: 'the free brain has no Claude key' });
    const ok = this.admit(res, visitor, body, 'anthropic', (last) => typeof last.content === 'string' || (Array.isArray(last.content) && !last.content.some((b) => (b as { type: string }).type === 'tool_result')), json);
    if (!ok) return;
    const { s, personality } = ok;
    const messages = ok.messages as Anthropic.Beta.BetaMessageParam[];
    const model = PRICES[ok.model] ? ok.model : 'claude-sonnet-5-5'; // unknown models run on Sonnet

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

  // POST /brain/grok  { scribe, messages }  →  xAI's own event stream, passed through as it comes
  async handleGrok(req: IncomingMessage, res: ServerResponse, visitor: string, body: unknown, json: (res: ServerResponse, code: number, data: unknown) => void) {
    if (!this.xaiKey) return json(res, 400, { error: 'the free brain has no Grok key' });
    const ok = this.admit(res, visitor, body, 'xai', (last) => last.role === 'user', json);
    if (!ok) return;
    const { s, personality, messages } = ok;
    const model = PRICES[ok.model] ? ok.model : 'grok-4.3'; // unknown models run on Grok 4.3
    const abort = new AbortController();
    req.on('close', () => abort.abort());
    try {
      const tools = toolDefinitions(enabledTools(personality.tools)).flatMap((t) => {
        const d = t as Anthropic.Beta.BetaTool;
        return d.input_schema ? [{ type: 'function', function: { name: d.name, description: d.description ?? '', parameters: d.input_schema } }] : [];
      });
      const up = await fetch(XAI_URL, {
        method: 'POST', signal: abort.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.xaiKey}` },
        body: JSON.stringify({
          model, max_tokens: MAX_TOKENS, stream: true, stream_options: { include_usage: true },
          messages: [{ role: 'system', content: systemPrompt(personality, s.journal.map((j) => j.text)) }, ...messages],
          ...(tools.length ? { tools } : {}),
        }),
      });
      if (!up.ok || !up.body) return json(res, 502, { error: `Grok answered ${up.status}` });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'access-control-allow-origin': '*' });
      const dec = new TextDecoder();
      let tail = '';
      for await (const chunk of up.body as unknown as AsyncIterable<Uint8Array>) {
        res.write(chunk);
        tail = (tail + dec.decode(chunk, { stream: true })).slice(-4000); // the usage comes in the last event
      }
      const usage = /"usage":(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})/.exec(tail);
      if (usage) {
        const u = JSON.parse(usage[1]);
        const [inp, out] = PRICES[model];
        this.today().spentUsd += ((u.prompt_tokens ?? 0) * inp + (u.completion_tokens ?? 0) * out) / 1e6;
        this.save();
      }
    } catch (e) {
      if (!res.headersSent) json(res, 502, { error: (e as Error).message });
    } finally {
      if (res.headersSent) res.end();
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

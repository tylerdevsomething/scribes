// A bound brain: the scribe's inscribed personality runs on Claude. Two ways to reach Claude:
//   - the free hosted brain: our server calls Claude with the operator's key (limited per visitor and per
//     day; the server builds the system prompt from the scribe's inscription and offers only its tools);
//   - the visitor's own key, straight from this browser (the key goes only to Anthropic, never to us).
// Either way the same loop runs here: tools run in this browser, proposals wait for the viewer's approval.
import Anthropic from '@anthropic-ai/sdk';
import type { Brain, ReplyContext } from './brain.ts';
import { runTool, toolDefinitions } from './tools.ts';
import { API } from '../config.ts';

const MAX_STEPS = 8; // model calls per reply (tool rounds included)

type Msg = Anthropic.Beta.BetaMessageParam;
type Call = (messages: Msg[], tools: Anthropic.Beta.BetaToolUnion[], onDelta: (t: string) => void, signal: AbortSignal) => Promise<Anthropic.Beta.BetaMessage>;

function brainFrom(label: string, call: Call, client: Anthropic | null): Brain {
  return {
    label,
    usesTools: true,
    async reply(_system, history, onText, signal, ctx?: ReplyContext) {
      const tools = toolDefinitions(ctx?.tools ?? []);
      const messages: Msg[] = history.map((t) => ({ role: t.role, content: t.content }));
      // Only the final answer is kept: notes the model writes before calling a tool ("Need the SOL price…")
      // are working steps, shown live while it works and then replaced.
      let text = '';
      const answer = (final: Anthropic.Beta.BetaMessage) => {
        const last = final.content.map((b) => b.type !== 'text').lastIndexOf(true);
        return final.content.slice(last + 1).map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
      };
      for (let step = 0; step < MAX_STEPS; step++) {
        text = '';
        const final = await call(messages, tools, (delta) => { text += delta; onText(text); }, signal);
        for (const b of final.content) if (b.type === 'server_tool_use') ctx?.onTool?.(b.name, b.input); // ran on Anthropic's side
        if (final.stop_reason === 'refusal') return answer(final) || '(The model declined to answer that.)';
        if (final.stop_reason === 'pause_turn') { // a long server-side tool turn: continue it
          messages.push({ role: 'assistant', content: final.content });
          continue;
        }
        if (final.stop_reason !== 'tool_use' || !final.content.some((b) => b.type === 'tool_use')) {
          const a = answer(final) || text.trim();
          onText(a);
          return a;
        }
        // Run every client tool call of this turn, then return all results in one message.
        messages.push({ role: 'assistant', content: final.content });
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const b of final.content) {
          if (b.type !== 'tool_use') continue;
          ctx?.onTool?.(b.name, b.input);
          try {
            results.push({ type: 'tool_result', tool_use_id: b.id, content: await runTool(b.name, b.input, { scribe: ctx!.scribe, propose: ctx!.propose, client }) });
          } catch (e) {
            results.push({ type: 'tool_result', tool_use_id: b.id, content: `Error: ${(e as Error).message}`, is_error: true });
          }
        }
        messages.push({ role: 'user', content: results });
      }
      return text.trim() || 'I ran out of steps before finishing — ask me again, more narrowly.';
    },
  };
}

// The visitor's own key.
export function loadBound(provider: string, model: string, apiKey: string): Brain {
  if (provider !== 'anthropic') throw new Error(`brains bound to "${provider}" cannot run here yet`);
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  let system = '';
  const brain = brainFrom(`${model} via Anthropic · your key`, async (messages, tools, onDelta, signal) => {
    const stream = client.beta.messages.stream({
      model, max_tokens: 16000, system, messages,
      ...(tools.length ? { tools } : {}),
      output_config: { effort: 'low' }, // conversation, not hard reasoning
      // If the model declines on a safety classifier, the API retries on a fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    }, { signal });
    stream.on('text', onDelta);
    return stream.finalMessage();
  }, client);
  const reply = brain.reply;
  brain.reply = (sys, ...rest) => { system = sys; return reply(sys, ...rest); };
  return brain;
}

// ---- the free hosted brain ----

export interface HostedStatus { enabled: boolean; open?: boolean; remaining?: number; perDay?: number }

export async function hostedStatus(): Promise<HostedStatus> {
  try { return await fetch(`${API}/brain`).then((r) => r.json()); } catch { return { enabled: false }; }
}

// One call to the hosted brain for a scribe; streams text, returns the final message.
export async function hostedCall(scribe: string, messages: Msg[], onDelta: (t: string) => void, signal?: AbortSignal): Promise<Anthropic.Beta.BetaMessage> {
  const res = await fetch(`${API}/brain`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scribe, messages }), signal });
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => ({}));
    throw new HostedError(j.error ?? `the free brain answered ${res.status}`, res.status === 429);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const line = buf.slice(0, i).replace(/^data: /, '');
      buf = buf.slice(i + 2);
      if (!line) continue;
      const ev = JSON.parse(line);
      if (ev.type === 'text') onDelta(ev.text);
      else if (ev.type === 'done') return ev.message;
      else if (ev.type === 'error') throw new HostedError(ev.error, false);
    }
  }
  throw new HostedError('the free brain stopped answering', false);
}

export class HostedError extends Error {
  limited: boolean;
  constructor(message: string, limited: boolean) { super(message); this.limited = limited; }
}

export function loadHosted(scribe: string, model: string): Brain {
  return brainFrom(`${model} · free, on Scribes`, (messages, _tools, onDelta, signal) => hostedCall(scribe, messages, onDelta, signal), null);
}

export function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'That API key was not accepted.';
  if (e instanceof Anthropic.RateLimitError) return 'Rate limited by the provider — try again in a moment.';
  if (e instanceof Anthropic.NotFoundError) return 'The provider does not know this model.';
  if (e instanceof Anthropic.APIError) return `Provider error ${e.status}: ${e.message}`;
  return (e as Error).message;
}

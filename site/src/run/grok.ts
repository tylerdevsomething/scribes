// A hybrid brain on Grok: the scribe's inscribed personality runs on xAI's chat API. Two ways to reach it,
// as with Claude: the free hosted brain (our server adds the scribe's prompt and tools and forwards the
// stream), or the visitor's own xAI key straight from this browser (it goes only to xAI).
// Tools run here and proposals wait for the viewer's approval, exactly as on Claude. Grok has no
// server-side web search here, so those two tools are left out.
import type Anthropic from '@anthropic-ai/sdk';
import type { Brain, ReplyContext } from './brain.ts';
import { runTool, toolDefinitions } from './tools.ts';
import { HostedError } from './bound.ts';
import { API, modelName } from '../config.ts';
import { XAI_URL } from '../../../lib/src/hybrid.ts';

const MAX_STEPS = 8;

export interface GrokCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export type GrokMsg =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: GrokCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };
export interface GrokTool { type: 'function'; function: { name: string; description: string; parameters: unknown } }

// The Claude tool definitions in the shape xAI expects (client tools only).
export function grokTools(enabled: string[]): GrokTool[] {
  return toolDefinitions(enabled).flatMap((t) => {
    const d = t as Anthropic.Beta.BetaTool;
    return d.input_schema ? [{ type: 'function' as const, function: { name: d.name, description: d.description ?? '', parameters: d.input_schema } }] : [];
  });
}

// Reads an OpenAI-style event stream: text as it comes, then the whole message (tool calls joined up).
export async function readStream(res: Response, onDelta: (t: string) => void): Promise<{ content: string; tool_calls: GrokCall[] }> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '', content = '';
  const calls: GrokCall[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      const ev = JSON.parse(data);
      if (ev.error) throw new HostedError(typeof ev.error === 'string' ? ev.error : ev.error.message ?? 'Grok stopped answering', false);
      const delta = ev.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) { content += delta.content; onDelta(delta.content); }
      for (const c of delta.tool_calls ?? []) {
        const at = (calls[c.index ?? calls.length] ??= { id: '', type: 'function', function: { name: '', arguments: '' } });
        if (c.id) at.id = c.id;
        if (c.function?.name) at.function.name += c.function.name;
        if (c.function?.arguments) at.function.arguments += c.function.arguments;
      }
    }
  }
  return { content, tool_calls: calls.filter(Boolean) };
}

type Call = (messages: GrokMsg[], tools: GrokTool[], onDelta: (t: string) => void, signal: AbortSignal) => Promise<{ content: string; tool_calls: GrokCall[] }>;

function grokBrain(label: string, call: Call): Brain {
  return {
    label,
    usesTools: true,
    async reply(system, history, onText, signal, ctx?: ReplyContext) {
      const tools = grokTools(ctx?.tools ?? []);
      const messages: GrokMsg[] = [{ role: 'system', content: system }, ...history.map((t) => ({ role: t.role, content: t.content }))];
      let text = '';
      for (let step = 0; step < MAX_STEPS; step++) {
        text = '';
        const m = await call(messages, tools, (d) => { text += d; onText(text); }, signal);
        if (!m.tool_calls.length) { onText(m.content.trim()); return m.content.trim(); }
        messages.push({ role: 'assistant', content: m.content || null, tool_calls: m.tool_calls });
        for (const c of m.tool_calls) {
          let input: unknown = {};
          try { input = JSON.parse(c.function.arguments || '{}'); } catch { /* answered as an error below */ }
          ctx?.onTool?.(c.function.name, input);
          let out: string;
          try { out = await runTool(c.function.name, input, { scribe: ctx!.scribe, propose: ctx!.propose, client: null }); } catch (e) { out = `Error: ${(e as Error).message}`; }
          messages.push({ role: 'tool', tool_call_id: c.id, content: out });
        }
      }
      return text.trim() || 'I ran out of steps before finishing — ask me again, more narrowly.';
    },
  };
}

async function failed(res: Response, who: string): Promise<never> {
  const j = await res.json().catch(() => ({}));
  const msg = typeof j.error === 'string' ? j.error : j.error?.message;
  if (res.status === 401 || res.status === 400 && /api key/i.test(msg ?? '')) throw new Error('That API key was not accepted.');
  throw new HostedError(msg ?? `${who} answered ${res.status}`, res.status === 429);
}

// The visitor's own xAI key.
export function loadGrok(model: string, apiKey: string): Brain {
  return grokBrain(`${modelName(model)} · your key`, async (messages, tools, onDelta, signal) => {
    const res = await fetch(XAI_URL, {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, stream: true, max_tokens: 4000, ...(tools.length ? { tools } : {}) }),
    });
    if (!res.ok || !res.body) await failed(res, 'Grok');
    return readStream(res, onDelta);
  });
}

// One call to the free hosted Grok brain for a scribe (the server adds the system prompt and tools).
export async function hostedGrokCall(scribe: string, messages: GrokMsg[], onDelta: (t: string) => void, signal?: AbortSignal) {
  const res = await fetch(`${API}/brain/grok`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scribe, messages: messages.filter((m) => m.role !== 'system') }), signal });
  if (!res.ok || !res.body) await failed(res, 'the free brain');
  return readStream(res, onDelta);
}

export function loadHostedGrok(scribe: string, model: string): Brain {
  return { ...grokBrain(`${modelName(model)} · free, on Scribes`, (messages, _tools, onDelta, signal) => hostedGrokCall(scribe, messages, onDelta, signal)), hosted: true };
}

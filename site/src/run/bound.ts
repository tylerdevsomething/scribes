// A bound brain: the scribe's inscribed personality runs on a hosted model, called from this browser
// with the viewer's own API key. The key goes only to the provider, never to Scribes.
import Anthropic from '@anthropic-ai/sdk';
import type { Brain } from './brain.ts';
import { runTool, toolDefinitions } from './tools.ts';

const MAX_STEPS = 8; // model calls per reply (tool rounds included)

export function loadBound(provider: string, model: string, apiKey: string): Brain {
  if (provider !== 'anthropic') throw new Error(`brains bound to "${provider}" cannot run here yet`);
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  return {
    label: `${model} via Anthropic · your key`,
    usesTools: true,
    async reply(system, history, onText, signal, ctx) {
      const tools = toolDefinitions(ctx?.tools ?? []);
      const messages: Anthropic.Beta.BetaMessageParam[] = history.map((t) => ({ role: t.role, content: t.content }));
      let text = '';
      for (let step = 0; step < MAX_STEPS; step++) {
        const stream = client.beta.messages.stream({
          model,
          max_tokens: 16000,
          system,
          messages,
          ...(tools.length ? { tools } : {}),
          output_config: { effort: 'low' }, // conversation, not hard reasoning
          // If the model declines on a safety classifier, the API retries on a fallback model.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        }, { signal });
        stream.on('text', (delta) => { text += delta; onText(text); });
        const final = await stream.finalMessage();
        if (final.stop_reason === 'refusal') return text || '(The model declined to answer that.)';
        if (final.stop_reason === 'pause_turn') { // a long server-side tool turn: continue it
          messages.push({ role: 'assistant', content: final.content });
          continue;
        }
        if (final.stop_reason !== 'tool_use') return text;
        if (!final.content.some((b) => b.type === 'tool_use')) return text;
        // Run every client tool call of this turn, then return all results in one message.
        messages.push({ role: 'assistant', content: final.content });
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const b of final.content) {
          if (b.type !== 'tool_use') continue;
          try {
            results.push({ type: 'tool_result', tool_use_id: b.id, content: await runTool(b.name, b.input, ctx?.propose ?? (() => {})) });
          } catch (e) {
            results.push({ type: 'tool_result', tool_use_id: b.id, content: `Error: ${(e as Error).message}`, is_error: true });
          }
        }
        messages.push({ role: 'user', content: results });
        if (text && !text.endsWith('\n')) { text += '\n\n'; onText(text); }
      }
      return text;
    },
  };
}

export function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'That API key was not accepted.';
  if (e instanceof Anthropic.RateLimitError) return 'Rate limited by the provider — try again in a moment.';
  if (e instanceof Anthropic.NotFoundError) return 'The provider does not know this model.';
  if (e instanceof Anthropic.APIError) return `Provider error ${e.status}: ${e.message}`;
  return (e as Error).message;
}

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
      // Only the final answer is kept: notes the model writes before calling a tool ("Need the SOL price…")
      // are working steps, shown live while it works and then replaced.
      let text = '';
      const answer = (final: Anthropic.Beta.BetaMessage) => {
        const last = final.content.map((b) => b.type !== 'text').lastIndexOf(true);
        return final.content.slice(last + 1).map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
      };
      for (let step = 0; step < MAX_STEPS; step++) {
        text = '';
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

export function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'That API key was not accepted.';
  if (e instanceof Anthropic.RateLimitError) return 'Rate limited by the provider — try again in a moment.';
  if (e instanceof Anthropic.NotFoundError) return 'The provider does not know this model.';
  if (e instanceof Anthropic.APIError) return `Provider error ${e.status}: ${e.message}`;
  return (e as Error).message;
}

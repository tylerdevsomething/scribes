// A bound brain: the scribe's inscribed personality runs on a hosted model, called from this browser
// with the viewer's own API key. The key goes only to the provider, never to Scribes.
import Anthropic from '@anthropic-ai/sdk';
import type { Brain } from './brain.ts';

export const BOUND_PROVIDERS = ['anthropic'] as const;

export function loadBound(provider: string, model: string, apiKey: string): Brain {
  if (provider !== 'anthropic') throw new Error(`brains bound to "${provider}" cannot run here yet`);
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  return {
    label: `${model} via Anthropic · your key`,
    async reply(system, history, onText, signal) {
      const stream = client.beta.messages.stream({
        model,
        max_tokens: 16000,
        system,
        messages: history.map((t) => ({ role: t.role, content: t.content })),
        output_config: { effort: 'low' }, // conversation, not hard reasoning
        // If the model declines on a safety classifier, the API retries on a fallback model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      }, { signal });
      let text = '';
      stream.on('text', (delta) => { text += delta; onText(text); });
      const final = await stream.finalMessage();
      if (final.stop_reason === 'refusal') return text || '(The model declined to answer that.)';
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

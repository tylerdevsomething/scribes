// Hybrid brains: the scribe's personality is inscribed, and it thinks with a hosted model named in its
// manifest ({kind:'bound', provider, model}). Two providers: Anthropic (Claude) and xAI (Grok).

export type Provider = 'anthropic' | 'xai';

export interface HybridModel { id: string; short: string; hint: string }

export const PROVIDERS: Record<Provider, { name: string; keyName: string; keyUrl: string; models: HybridModel[] }> = {
  anthropic: {
    name: 'Claude', keyName: 'Anthropic', keyUrl: 'https://console.anthropic.com/settings/keys',
    models: [
      { id: 'claude-opus-5-5', short: 'Opus 5.5', hint: 'Most capable' },
      { id: 'claude-sonnet-5-5', short: 'Sonnet 5.5', hint: 'Fast and capable' },
      { id: 'claude-haiku-5-5', short: 'Haiku 5.5', hint: 'Quickest' },
    ],
  },
  xai: {
    name: 'Grok', keyName: 'xAI', keyUrl: 'https://console.x.ai',
    models: [
      { id: 'grok-4.7', short: 'Grok 4.7', hint: 'Most capable' },
      { id: 'grok-4.3', short: 'Grok 4.3', hint: 'Fast and capable' },
      { id: 'grok-4.20-0309-non-reasoning', short: 'Grok 4.20', hint: 'Quickest' },
    ],
  },
};

export const isProvider = (p: string): p is Provider => p === 'anthropic' || p === 'xai';

// "claude-opus-5-5" → "Claude Opus 5.5", "grok-4.7" → "Grok 4.7"; other ids are shown as they are.
export function modelName(id: string): string {
  const c = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(id);
  if (c) return `Claude ${c[1][0].toUpperCase()}${c[1].slice(1)} ${c[2]}.${c[3]}`;
  const g = /^grok-(\d+(?:\.\d+)?)/.exec(id);
  if (g) return `Grok ${g[1]}`;
  return id;
}

// xAI's OpenAI-compatible chat endpoint (it answers browsers too).
export const XAI_URL = 'https://api.x.ai/v1/chat/completions';

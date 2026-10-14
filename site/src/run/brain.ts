// A scribe's brain, whichever kind: the chat only needs to send the history and stream the reply.
export interface Turn { role: 'user' | 'assistant'; content: string }

export interface Brain {
  label: string; // shown under the chat, e.g. "SmolLM2 135M · in this browser"
  reply(system: string, history: Turn[], onText: (soFar: string) => void, signal: AbortSignal): Promise<string>;
}

// Small models fall into loops: detect a sentence said three times, and cut a reply back to its first pass.
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim().toLowerCase()).filter((s) => s.length > 8);
}

export function looping(text: string): boolean {
  const seen = new Map<string, number>();
  for (const s of sentences(text)) {
    const n = (seen.get(s) ?? 0) + 1;
    if (n >= 3) return true;
    seen.set(s, n);
  }
  return false;
}

export function trimLoop(text: string): string {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const p of text.split(/(?<=[.!?])\s+/)) {
    const k = p.trim().toLowerCase();
    if (k.length > 8 && seen.has(k)) break;
    seen.add(k);
    kept.push(p);
  }
  return kept.join(' ').trim();
}

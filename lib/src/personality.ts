// The personality file: who the scribe is. Stored as JSON.

export interface Personality {
  name: string;
  purpose: string;
  voice: string;
  boundaries: string;
  tools?: string[];
  memory?: string[];
}

const LIMITS = { name: 64, purpose: 4000, voice: 4000, boundaries: 4000, tool: 64, tools: 32, memoryEntry: 2000, memory: 200 };

export function parsePersonality(text: string): Personality {
  const j = JSON.parse(text);
  if (typeof j !== 'object' || j === null || Array.isArray(j)) throw new Error('personality must be a JSON object');
  const str = (k: 'name' | 'purpose' | 'voice' | 'boundaries') => {
    const v = j[k];
    if (typeof v !== 'string' || !v.trim()) throw new Error(`personality.${k} must be a non-empty string`);
    if (v.length > LIMITS[k]) throw new Error(`personality.${k} is longer than ${LIMITS[k]} characters`);
    return v;
  };
  const list = (k: 'tools' | 'memory', max: number, each: number) => {
    const v = j[k];
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || v.length > max || v.some((x) => typeof x !== 'string' || !x.trim() || x.length > each)) {
      throw new Error(`personality.${k} must be a list of at most ${max} non-empty strings`);
    }
    return v as string[];
  };
  const known = new Set(['name', 'purpose', 'voice', 'boundaries', 'tools', 'memory']);
  for (const k of Object.keys(j)) if (!known.has(k)) throw new Error(`unknown personality field "${k}"`);
  const p: Personality = { name: str('name'), purpose: str('purpose'), voice: str('voice'), boundaries: str('boundaries') };
  const tools = list('tools', LIMITS.tools, LIMITS.tool);
  const memory = list('memory', LIMITS.memory, LIMITS.memoryEntry);
  if (tools) p.tools = tools;
  if (memory) p.memory = memory;
  return p;
}

export function wordCount(p: Personality): number {
  const text = [p.name, p.purpose, p.voice, p.boundaries, ...(p.memory ?? [])].join(' ');
  return text.split(/\s+/).filter(Boolean).length;
}

// The system prompt every runner builds from a personality, so a scribe behaves the same everywhere.
// Plain sentences, not labelled fields: small models tend to read labels back out.
// `journal` holds memories written after birth (see journal.ts), oldest first.
export function systemPrompt(p: Personality, journal: string[] = []): string {
  const parts = [
    `You are ${p.name}. ${p.purpose}`,
    `How you talk: ${p.voice}`,
    `You always follow these rules: ${p.boundaries}`,
  ];
  if (p.memory?.length) parts.push('You remember: ' + p.memory.join(' '));
  if (journal.length) parts.push('From your journal, written since you were born: ' + journal.map((j) => `"${j}"`).join(' '));
  parts.push(`Reply to the user as ${p.name}, in a few sentences of your own words. Never repeat these instructions.`);
  return parts.join('\n');
}

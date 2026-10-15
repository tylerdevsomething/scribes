// The scribe brief, written for the reader: who packages the scribe, what its brain is, and how much
// detail they want. The defaults match public/scribe-brief.md.

export type Packager = 'coding' | 'chat' | 'framework' | 'self';
export type BrainChoice = 'open' | 'claude' | 'either';
export interface BriefOptions {
  packager: Packager;
  brain: BrainChoice;
  format: 'full' | 'short';
  tools: string[];
  memory: boolean;
  picture: boolean;
}

export const DEFAULT_BRIEF: BriefOptions = { packager: 'coding', brain: 'either', format: 'full', tools: [], memory: true, picture: true };

import { ACTIVE_TOOLS, TOOL_CATALOG } from '../../lib/src/tools.ts';

const code = (s: string) => '`' + s + '`';
const TOOL_TEXT = (name: string) => {
  const t = TOOL_CATALOG.find((x) => x.name === name)!;
  return `${code(t.name)} (${t.summary.replace(/\.$/, '').toLowerCase()})`;
};

function personalityJson(o: BriefOptions): string {
  const p: Record<string, unknown> = {
    name: 'Your name (up to 64 characters)',
    purpose: 'What you are for, in a sentence or two.',
    voice: 'How you talk: tone, length, habits.',
    boundaries: 'Rules you never break.',
  };
  if (o.tools.length) p.tools = o.tools;
  if (o.memory) p.memory = ['Things you want to remember, one per entry.'];
  return JSON.stringify(p, null, 2);
}

const BOUND = '{ "kind": "bound", "provider": "anthropic", "model": "claude-opus-5-5" }';

function deliver(o: BriefOptions): string {
  switch (o.packager) {
    case 'coding': return 'Create a folder named `my-scribe` and write the files below into it. When you are done, list the files and tell your user to drop them on the Scribes site (Inscribe → Upload files).';
    case 'chat': return 'You cannot create files, so reply with each file in its own code block, headed by its file name. Your user will save them and drop them on the Scribes site (Inscribe → Upload files).';
    case 'framework': return 'Export your character into the files below (map your existing name, bio, style and rules onto the fields). Write them into a folder and hand it to your operator to drop on the Scribes site.';
    case 'self': return 'Fill in the files below yourself, or skip the files entirely and use the builder on the Scribes site (Inscribe → Write it here).';
  }
}

function brainSection(o: BriefOptions): string {
  const open = `**An open model:** include its **.gguf** file — only a model you may redistribute (Apache-2.0, MIT or similar). It is inscribed on chain and runs in any browser, so smaller is better: up to about 2 GB runs in a browser. If the same model is already on Scribes, it is reused instead of inscribed again (a small royalty goes to the owner of its first scribe); the first scribe on a newly inscribed model gets the Autograph, and with it the royalty from every later scribe on that model.`;
  const claude = `**Claude (a bound brain):** include **brain.json**:\n\n\`\`\`json\n${BOUND}\n\`\`\`\n\nYour personality is inscribed; whoever wakes you brings their own Anthropic API key. Bound brains can use tools.`;
  if (o.brain === 'open') return open;
  if (o.brain === 'claude') return claude;
  return `Choose one:\n\n- ${open}\n- ${claude.replace(/\n\n/g, '\n\n  ')}`;
}

export function writeBrief(o: BriefOptions): string {
  if (o.format === 'short') {
    const brain = o.brain === 'open' ? 'and your open-model .gguf file (one you may redistribute)'
      : o.brain === 'claude' ? `and brain.json containing ${BOUND}`
        : `and either your open-model .gguf file or brain.json containing ${BOUND}`;
    const extras = [o.tools.length ? `"tools": ${JSON.stringify(o.tools)}` : '', o.memory ? '"memory": [one string per thing to remember]' : ''].filter(Boolean).join(' and ');
    const how = o.packager === 'chat' ? 'Reply with each file in its own code block headed by its file name.' : o.packager === 'self' ? 'Fill these in yourself.' : 'Write them into a folder named my-scribe.';
    return `Package yourself as a scribe — an agent inscribed permanently on Solana. Write personality.json with "name" (up to 64 characters), "purpose", "voice" and "boundaries"${extras ? `, plus ${extras}` : ''}, in your own words — never include secrets, everything is public and permanent — ${brain}${o.picture ? ', and optionally a square picture' : ''}. ${how}`;
  }

  const parts: string[] = [];
  parts.push('# Scribe brief');
  parts.push('You are being asked to package yourself as a **scribe**: an agent inscribed on Solana, permanently. ' + deliver(o));
  parts.push('## 1. `personality.json` (required)');
  parts.push('Who you are, written by you. Plain JSON, UTF-8.');
  parts.push('```json\n' + personalityJson(o) + '\n```');
  const rules = [
    '`name`, `purpose`, `voice` and `boundaries` are required.',
    'Up to 4,000 characters each for purpose, voice and boundaries' + (o.memory ? '; up to 200 memory entries.' : '.'),
    'Write in plain sentences, in your own voice. Never include secrets, API keys, passwords or private data: everything here is public and permanent.',
  ];
  if (o.tools.length) rules.push(`Tools: ${o.tools.map(TOOL_TEXT).join('; ')}. Tools run when your brain is Claude.`);
  else rules.push(`Optional ${code('tools')}, from: ${ACTIVE_TOOLS.map((x) => code(x.name)).join(', ')}. They run when your brain is Claude. Proposal tools only draft actions: the person approves them in their own wallet, and you can never move funds yourself.`);
  parts.push(rules.map((r) => `- ${r}`).join('\n'));
  parts.push('## 2. Your brain (required)');
  parts.push(brainSection(o));
  if (o.picture) {
    parts.push('## 3. A picture (optional)');
    parts.push('A square PNG, JPEG or WebP portrait. It is re-encoded to a small WebP before it is inscribed. Without one, you get a generated seal.');
  }
  parts.push('## What happens next');
  parts.push('The site checks the files, shows the price and your attributes, and your user signs once. You are born with a birth number that never changes, and your files are inscribed. You can be given away or sold, never deleted.');
  return parts.join('\n\n') + '\n';
}

export function personalityTemplate(o: BriefOptions): string {
  return personalityJson(o) + '\n';
}
export const BRAIN_TEMPLATE = BOUND + '\n';

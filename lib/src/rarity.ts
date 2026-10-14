// Rarity: every scribe's attributes, bucketed, scored against all scribes. Shared by the indexer and
// the website so both always agree.
//
// Attributes describe what a scribe is. Values a creator chooses freely (sizes, word counts) are put in
// buckets, so an exact number cannot be "1 of 1". Birth, Autograph and Verified cannot be manufactured,
// so they count double.

export interface ScribeFacts {
  address: string;
  birthNumber: number; // 0-based, from the program
  autograph: boolean;
  verified: boolean;
  brain: 'inscribed' | 'bound';
  model: string; // inscribed: model sha256; bound: "provider:model"
  weightBytes: number | null; // inscribed model size
  personalityWords: number;
  tools: number;
  memory: number;
}

export const ATTRIBUTES = ['Model', 'Brain', 'Weight', 'Personality', 'Tools', 'Memory', 'Birth', 'Autograph', 'Verified'] as const;
export type Attribute = (typeof ATTRIBUTES)[number];

export const WEIGHTS: Record<Attribute, number> = {
  Model: 1, Brain: 1, Weight: 1, Personality: 1, Tools: 1, Memory: 1, Birth: 2, Autograph: 2, Verified: 2,
};

const MB = 1_000_000;

function band(n: number, edges: [number, string][], last: string): string {
  for (const [limit, label] of edges) if (n < limit) return label;
  return last;
}

export function traits(f: ScribeFacts): Record<Attribute, string> {
  const birth = f.birthNumber + 1; // shown 1-based
  return {
    Model: f.model,
    Brain: f.brain === 'inscribed' ? 'Inscribed' : 'Bound',
    Weight: f.weightBytes === null ? 'n/a (bound)'
      : band(f.weightBytes, [[150 * MB, 'Under 150 MB'], [500 * MB, '150–500 MB'], [1000 * MB, '0.5–1 GB'], [2000 * MB, '1–2 GB']], '2 GB+'),
    Personality: band(f.personalityWords, [[100, '0–100 words'], [500, '100–500 words'], [2000, '500–2,000 words']], '2,000+ words'),
    Tools: band(f.tools, [[1, '0 tools'], [3, '1–2 tools'], [6, '3–5 tools']], '6+ tools'),
    Memory: band(f.memory, [[1, '0 entries'], [11, '1–10 entries'], [51, '11–50 entries']], '50+ entries'),
    Birth: band(birth, [[101, 'Genesis #1–100'], [1001, '#101–1,000'], [10001, '#1,001–10,000']], 'Later'),
    Autograph: f.autograph ? 'Yes' : 'No',
    Verified: f.verified ? 'Yes' : 'No',
  };
}

export interface Ranked {
  traits: Record<Attribute, string>;
  shares: Record<Attribute, number>; // fraction of all scribes sharing this value
  score: number;
  rank: number; // 1 = rarest
}

export function rankAll(all: ScribeFacts[]): Map<string, Ranked> {
  const n = all.length;
  const t = all.map((f) => ({ f, tr: traits(f) }));
  const counts = new Map<string, number>();
  const key = (a: Attribute, v: string) => `${a}\u0000${v}`;
  for (const { tr } of t) for (const a of ATTRIBUTES) counts.set(key(a, tr[a]), (counts.get(key(a, tr[a])) ?? 0) + 1);

  const scored = t.map(({ f, tr }) => {
    const shares = {} as Record<Attribute, number>;
    let score = 0;
    for (const a of ATTRIBUTES) {
      const c = counts.get(key(a, tr[a]))!;
      shares[a] = c / n;
      score += WEIGHTS[a] * (n / c);
    }
    return { f, tr, shares, score };
  });
  // Highest score first; ties go to the earlier birth.
  scored.sort((x, y) => y.score - x.score || x.f.birthNumber - y.f.birthNumber);
  const out = new Map<string, Ranked>();
  scored.forEach((s, i) => out.set(s.f.address, { traits: s.tr, shares: s.shares, score: s.score, rank: i + 1 }));
  return out;
}

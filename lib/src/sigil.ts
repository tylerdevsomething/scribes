// A scribe's seal: a deterministic emblem drawn from its address, used when it has no picture. The same
// scribe always gets the same seal. Drawn as shapes so the site (React) and the share cards (an SVG
// string rendered on the server) draw exactly the same thing.

function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };
}

const GROUNDS = [
  ['#06231d', '#3ee0b5'], ['#251707', '#f2b25c'], ['#121518', '#e6e3da'],
  ['#0a1a2a', '#6cb8ff'], ['#260e0c', '#ff7a66'], ['#161d08', '#c4e05a'],
];

export type Shape =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; width: number; opacity: number }
  | { kind: 'circle'; cx: number; cy: number; r: number; fill: string; stroke?: string; width?: number; opacity?: number };

// The seal on a 200 × 200 canvas: its colours, and its shapes in drawing order (the letter goes last).
export function sigil(seed: string): { ground: string; ink: string; shapes: Shape[] } {
  const r = rng(seed);
  const [ground, ink] = GROUNDS[Math.floor(r() * GROUNDS.length)];
  const spokes = 6 + Math.floor(r() * 10);
  const rings = 2 + Math.floor(r() * 3);
  const twist = r() * Math.PI;
  const dots = Math.floor(r() * 3) + 2;
  const c = 100;
  const shapes: Shape[] = [];
  for (let i = 0; i < rings; i++) {
    shapes.push({ kind: 'circle', cx: c, cy: c, r: 40 - i * 6 + (i === 0 ? 50 : 0), fill: 'none', stroke: ink, width: i === 0 ? 1.6 : 1, opacity: i === 0 ? 0.9 : 0.45 });
  }
  for (let i = 0; i < spokes; i++) {
    const a = twist + (i / spokes) * Math.PI * 2;
    const inner = 46 + r() * 6, outer = 70 + r() * 10;
    shapes.push({ kind: 'line', x1: c + Math.cos(a) * inner, y1: c + Math.sin(a) * inner, x2: c + Math.cos(a) * outer, y2: c + Math.sin(a) * outer, stroke: ink, width: 1.4, opacity: 0.75 });
  }
  for (let k = 0; k < dots; k++) {
    const a = twist + r() * Math.PI * 2;
    shapes.push({ kind: 'circle', cx: c + Math.cos(a) * 84, cy: c + Math.sin(a) * 84, r: 2.6, fill: ink });
  }
  shapes.push({ kind: 'circle', cx: c, cy: c, r: 38, fill: ground, stroke: ink, width: 2 });
  return { ground, ink, shapes };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

// The seal as SVG markup (a <g> on the 200 × 200 canvas), for server-side rendering.
export function sigilMarkup(seed: string, letter: string): string {
  const { ground, ink, shapes } = sigil(seed);
  const parts = [`<rect width="200" height="200" fill="${ground}"/>`];
  for (const s of shapes) {
    if (s.kind === 'line') parts.push(`<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="${s.stroke}" stroke-width="${s.width}" stroke-linecap="round" opacity="${s.opacity}"/>`);
    else parts.push(`<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="${s.fill}"${s.stroke ? ` stroke="${s.stroke}" stroke-width="${s.width}"` : ''}${s.opacity !== undefined ? ` opacity="${s.opacity}"` : ''}/>`);
  }
  parts.push(`<text x="100" y="115" text-anchor="middle" font-family="Fraunces" font-weight="600" font-size="44" fill="${ink}">${esc(letter)}</text>`);
  return parts.join('');
}

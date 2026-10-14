// A scribe's seal: a deterministic emblem drawn from its address, used when it has no picture.
// The same scribe always gets the same seal.

function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };
}

const GROUNDS = [
  ['#dff1ea', '#0f6b58'], ['#f6e8d3', '#8a5a1c'], ['#ece8df', '#1c1a16'],
  ['#e6eef4', '#24506e'], ['#f3e3e1', '#7d2f27'], ['#e9ecdc', '#4d5a1f'],
];

export function Sigil({ seed, letter }: { seed: string; letter: string }) {
  const r = rng(seed);
  const [ground, ink] = GROUNDS[Math.floor(r() * GROUNDS.length)];
  const spokes = 6 + Math.floor(r() * 10);
  const rings = 2 + Math.floor(r() * 3);
  const twist = r() * Math.PI;
  const dots = Math.floor(r() * 3) + 2;
  const c = 100;
  const lines = [];
  for (let i = 0; i < spokes; i++) {
    const a = twist + (i / spokes) * Math.PI * 2;
    const inner = 46 + r() * 6, outer = 70 + r() * 10;
    lines.push(<line key={`s${i}`} x1={c + Math.cos(a) * inner} y1={c + Math.sin(a) * inner} x2={c + Math.cos(a) * outer} y2={c + Math.sin(a) * outer} stroke={ink} strokeWidth={1.4} strokeLinecap="round" opacity={0.75} />);
  }
  for (let k = 0; k < dots; k++) {
    const a = twist + r() * Math.PI * 2;
    lines.push(<circle key={`d${k}`} cx={c + Math.cos(a) * 84} cy={c + Math.sin(a) * 84} r={2.6} fill={ink} />);
  }
  return (
    <svg viewBox="0 0 200 200" role="img" aria-label={`Seal of ${letter}`}>
      <rect width="200" height="200" fill={ground} />
      {Array.from({ length: rings }, (_, i) => (
        <circle key={`r${i}`} cx={c} cy={c} r={40 - i * 6 + (i === 0 ? 50 : 0)} fill="none" stroke={ink} strokeWidth={i === 0 ? 1.6 : 1} opacity={i === 0 ? 0.9 : 0.45} />
      ))}
      {lines}
      <circle cx={c} cy={c} r={38} fill={ground} stroke={ink} strokeWidth={2} />
      <text x={c} y={c + 15} textAnchor="middle" fontFamily="Fraunces, Georgia, serif" fontWeight={600} fontSize={44} fill={ink}>{letter}</text>
    </svg>
  );
}

// The site's mark: a small seal.
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="15" fill="#0f6b58" />
      <circle cx="16" cy="16" r="11" fill="none" stroke="#dff1ea" strokeWidth="1.2" />
      <path d="M11 20.5c1.2 1 2.8 1.5 4.6 1.5 2.6 0 4.4-1.3 4.4-3.3 0-4.3-8.4-2.4-8.4-6.4 0-1.7 1.6-2.8 3.9-2.8 1.5 0 2.8.4 3.8 1.2" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

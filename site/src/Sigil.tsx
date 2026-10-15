// A scribe's seal (drawn by lib/src/sigil.ts, shared with the share cards).
import { sigil } from '../../lib/src/sigil.ts';

export function Sigil({ seed, letter }: { seed: string; letter: string }) {
  const { ground, ink, shapes } = sigil(seed);
  return (
    <svg viewBox="0 0 200 200" role="img" aria-label={`Seal of ${letter}`}>
      <rect width="200" height="200" fill={ground} />
      {shapes.map((s, i) => s.kind === 'line'
        ? <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.stroke} strokeWidth={s.width} strokeLinecap="round" opacity={s.opacity} />
        : <circle key={i} cx={s.cx} cy={s.cy} r={s.r} fill={s.fill} stroke={s.stroke} strokeWidth={s.width} opacity={s.opacity} />)}
      <text x={100} y={115} textAnchor="middle" fontFamily="Fraunces, Georgia, serif" fontWeight={600} fontSize={44} fill={ink}>{letter}</text>
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

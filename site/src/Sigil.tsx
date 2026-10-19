// A scribe's seal on the site, for a scribe with no picture: its initial set in the 3px dot grid (like the
// computer and the ornaments) inside the frame's double rule, and under it the date it was born, as
// dd/mm/yyyy, taken from Solana's block time for its birth slot. The
// colour comes from the address, so the same scribe always gets the same seal.
// (The share cards still use lib/src/sigil.ts, drawn on the server.)
import { useEffect, useRef, useState } from 'react';
import { conn } from './config.ts';

const BLUE = '#0047ff', RED = '#e5141a', STONE = '#f1f1ef', INK = '#1a1410';
const S = 400; // drawn at 400 x 400, shown at any size

function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return (h >>> 0) % 1000 / 1000; };
}

// the date a slot was confirmed, from the chain; kept for the session, and in this browser when it can
const dates = new Map<number, Promise<string | null>>();
function birthDate(slot: number): Promise<string | null> {
  if (!dates.has(slot)) dates.set(slot, (async () => {
    const key = `scribes:born:${slot}`;
    try { const kept = localStorage.getItem(key); if (kept) return kept; } catch { /* no storage */ }
    const t = await conn.getBlockTime(slot).catch(() => null);
    if (!t) return null;
    const d = new Date(t * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    try { localStorage.setItem(key, d); } catch { /* no storage */ }
    return d;
  })());
  return dates.get(slot)!;
}

// the day a slot was confirmed as yyyy-mm-dd (utc), kept for the session
const days = new Map<number, Promise<string | null>>();
export function birthDay(slot: number): Promise<string | null> {
  if (!days.has(slot)) days.set(slot, conn.getBlockTime(slot).then((t) => (t ? new Date(t * 1000).toISOString().slice(0, 10) : null)).catch(() => null));
  return days.get(slot)!;
}

// scale: canvas pixels per screen pixel, so the dots land on the hero's spacing (3px apart, 0.9px radius)
// the seal's colour, picked by the address, so the same scribe always gets the same one
export const sealColour = (seed: string) => seeded(seed)() < .5 ? BLUE : RED;

function draw(ctx: CanvasRenderingContext2D, seed: string, letter: string, birth: { n: number; date: string | null } | undefined, scale: number) {
  const main = sealColour(seed);
  ctx.fillStyle = STONE; ctx.fillRect(0, 0, S, S);
  // the frame's double rule and its square corner blocks
  ctx.strokeStyle = main; ctx.lineWidth = 9; ctx.strokeRect(18, 18, S - 36, S - 36);
  ctx.lineWidth = 3; ctx.strokeRect(33, 33, S - 66, S - 66);
  ctx.fillStyle = main;
  for (const [x, y] of [[6, 6], [S - 34, 6], [6, S - 34], [S - 34, S - 34]]) ctx.fillRect(x, y, 28, 28);
  // the initial, set in dots; the initial and the date under it sit centred together inside the rule
  const off = document.createElement('canvas'); off.width = S; off.height = S;
  const o = off.getContext('2d')!;
  o.font = "700 250px 'Grenze Gotisch'"; o.textAlign = 'center'; o.fillText(letter, S / 2, 260);
  const px = o.getImageData(0, 0, S, S).data;
  let top = S, bottom = 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (px[(y * S + x) * 4 + 3] > 120) { top = Math.min(top, y); bottom = Math.max(bottom, y); break; }
  // the date is set to the size of the 0s and 1s in the site's border: 6px tall on screen
  const dateH = birth ? 6 * scale : 0, gap = birth ? 7 * scale : 0;
  const shift = Math.round((S - (bottom - top) - gap - dateH) / 2) - top;
  const P = 3 * scale, R = .9 * scale;
  ctx.fillStyle = main;
  for (let y = P / 2; y < S; y += P) for (let x = P / 2; x < S; x += P) {
    const sy = Math.floor(y - shift);
    if (sy >= 0 && sy < S && px[(sy * S + Math.floor(x)) * 4 + 3] > 120) { ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill(); }
  }
  if (!birth) return;
  // the date it was born
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = INK; ctx.font = `600 ${8.4 * scale}px 'JetBrains Mono'`;
  ctx.fillText(birth.date ?? `#${birth.n + 1}`, S / 2, bottom + shift + gap + dateH);
}

export function Sigil({ seed, letter, birthNumber, birthSlot }: { seed: string; letter: string; birthNumber?: number; birthSlot?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [date, setDate] = useState<string | null>(null);
  useEffect(() => { if (birthSlot) birthDate(birthSlot).then(setDate); }, [birthSlot]);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const paint = () => draw(ctx, seed, letter.toLowerCase(), birthNumber === undefined ? undefined : { n: birthNumber, date }, S / Math.max(1, ref.current?.clientWidth || S));
    paint(); document.fonts.ready.then(paint);
  }, [seed, letter, birthNumber, date]);
  return <canvas ref={ref} width={S} height={S} role="img" aria-label={`Seal of ${letter}`} style={{ width: '100%', height: '100%', display: 'block' }} />;
}

// The site's mark: the illuminated s in a solid block with a white and a coloured rule.
// The same drawing is public/favicon.svg.
export function Mark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect width="100" height="100" fill="#0047ff" />
      <rect x="7" y="7" width="86" height="86" fill="none" stroke="#ffffff" strokeWidth="3" />
      <rect x="12" y="12" width="76" height="76" fill="none" stroke="#e5141a" strokeWidth="2" />
      <path transform="translate(26.42 77.36) scale(0.12 -0.12)" fill="#fafafa" d="M233 -11Q221 -11 196.0 -10.0Q171 -9 139.5 -7.0Q108 -5 78.0 -2.5Q48 0 28 2L31 161H95L116 83Q132 78 152.5 72.0Q173 66 191.5 63.0Q210 60 219 60Q225 60 230.0 66.5Q235 73 238.0 83.0Q241 93 241 102Q241 119 230.0 130.5Q219 142 197.0 155.0Q175 168 142 186Q98 211 73.5 231.5Q49 252 40.0 274.0Q31 296 31 324Q31 337 32.0 350.5Q33 364 37 375Q46 387 62.5 403.0Q79 419 97.5 433.0Q116 447 132.0 457.0Q148 467 158 467Q171 467 195.0 466.0Q219 465 247.0 464.0Q275 463 300.5 461.5Q326 460 342 458L339 322H267L260 377Q256 379 241.5 382.0Q227 385 209.5 387.5Q192 390 177.5 392.5Q163 395 158 395Q152 395 148.5 391.0Q145 387 143.5 380.5Q142 374 142 365Q142 348 155.0 334.0Q168 320 186.5 309.5Q205 299 219 290Q240 278 265.0 263.0Q290 248 313.0 231.5Q336 215 350.5 195.0Q365 175 365 152Q365 140 363.5 124.0Q362 108 357 96Q350 83 334.5 64.5Q319 46 300.5 29.0Q282 12 264.0 0.5Q246 -11 233 -11Z" />
    </svg>
  );
}

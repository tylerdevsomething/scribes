// Portraits in the site's dots from the scribes' own age: knights, kings, queens, monks and warhorses. Every
// scribe on the home page gets one, picked by its birth number, inside the same double rule and corner blocks
// as the seals, standing on the bottom rule. The figure takes the seal's colour and its trim takes the other.
// Also the frame alone, for a picture its owner uploaded, so every portrait wears the same border.
import { useId, type ReactNode } from 'react';
import { sealColour } from './Sigil.tsx';

const BLUE = '#0047ff', RED = '#e5141a';
const COLS = 24, ROWS = 26;

type Grid = string[][];
const span = (g: Grid, y: number, from: number, to: number, c: string) => { for (let x = from; x <= to; x++) g[y][x] = c; };

// helm outlines, rows 4 to 18, as the [first, last] column filled on each row
const HELMS: [number, number][][] = [
  // flat topped great helm
  [[6, 17], [5, 18], ...Array(11).fill([4, 19]), [5, 18], [6, 17]],
  // domed
  [[8, 15], [6, 17], [5, 18], ...Array(10).fill([4, 19]), [5, 18], [6, 17]],
  // pointed
  [[11, 12], [9, 14], [7, 16], [5, 18], ...Array(9).fill([4, 19]), [5, 18], [6, 17]],
];

// face openings, cut out of the helm (r is the row inside the helm, 0 to 14)
const FACES: ((g: Grid) => void)[] = [
  // eye slit either side of a nose bar, and breathing holes on the right
  (g) => { for (const r of [5, 6]) { span(g, 4 + r, 5, 10, '.'); span(g, 4 + r, 13, 18, '.'); } for (const r of [9, 11]) { g[4 + r][15] = '.'; g[4 + r][17] = '.'; } },
  // a T shaped opening
  (g) => { span(g, 9, 6, 17, '.'); for (let r = 6; r <= 11; r++) span(g, 4 + r, 11, 12, '.'); },
  // a grill of bars
  (g) => { for (let r = 5; r <= 10; r++) for (const x of [6, 8, 10, 13, 15, 17]) g[4 + r][x] = '.'; },
  // two eyes and a mouth
  (g) => { for (const r of [6, 7]) { span(g, 4 + r, 7, 9, '.'); span(g, 4 + r, 14, 16, '.'); } span(g, 14, 10, 13, '.'); },
];

// crests above the helm, in the accent colour
const CRESTS: ((g: Grid) => void)[] = [
  // a plume
  (g) => { span(g, 0, 10, 13, 'a'); span(g, 1, 9, 14, 'a'); span(g, 2, 8, 10, 'a'); span(g, 2, 13, 15, 'a'); span(g, 3, 11, 12, 'a'); },
  // horns, rising out of the sides of the helm
  (g) => { for (const [y, a, b] of [[2, 2, 2], [3, 1, 1], [4, 1, 1], [5, 1, 2], [6, 2, 3]]) { span(g, y, a, b, 'a'); span(g, y, 23 - b, 23 - a, 'a'); } },
  // a crown
  (g) => { for (const x of [7, 11, 12, 16]) g[1][x] = 'a'; span(g, 2, 7, 8, 'a'); span(g, 2, 10, 13, 'a'); span(g, 2, 15, 16, 'a'); span(g, 3, 7, 16, 'a'); },
  // a ridge
  (g) => { for (let y = 0; y <= 3; y++) span(g, y, 11, 12, 'a'); span(g, 3, 10, 13, 'a'); },
  // none
  () => {},
];

// emblems on the chest, in the accent colour
const EMBLEMS: ((g: Grid) => void)[] = [
  // a cross
  (g) => { span(g, 22, 11, 12, 'a'); span(g, 23, 9, 14, 'a'); span(g, 24, 11, 12, 'a'); span(g, 25, 11, 12, 'a'); },
  // a diamond
  (g) => { span(g, 21, 11, 12, 'a'); span(g, 22, 10, 13, 'a'); span(g, 23, 9, 14, 'a'); span(g, 24, 10, 13, 'a'); span(g, 25, 11, 12, 'a'); },
  // a belt
  (g) => { span(g, 24, 0, 23, 'a'); span(g, 23, 10, 13, 'a'); span(g, 25, 10, 13, 'a'); },
  // none
  () => {},
];

const KNIGHTS = HELMS.length * FACES.length * CRESTS.length * EMBLEMS.length;

// k to its own mix of parts; the stride is coprime with the total, so the first KNIGHTS knights all
// differ and neighbours never look alike
export function knight(k: number): Grid {
  k = (k * 97) % KNIGHTS;
  const helm = HELMS[k % HELMS.length]; k = Math.floor(k / HELMS.length);
  const face = FACES[k % FACES.length]; k = Math.floor(k / FACES.length);
  const crest = CRESTS[k % CRESTS.length]; k = Math.floor(k / CRESTS.length);
  const emblem = EMBLEMS[k % EMBLEMS.length];
  const g: Grid = Array.from({ length: ROWS }, () => Array(COLS).fill('.'));
  helm.forEach(([a, b], r) => span(g, 4 + r, a, b, 'b'));
  face(g);
  crest(g);
  // the neck and the shoulders
  span(g, 19, 8, 15, 'b'); span(g, 20, 3, 20, 'b'); span(g, 21, 2, 21, 'b'); span(g, 22, 1, 22, 'b');
  for (let y = 23; y < ROWS; y++) span(g, y, 0, 23, 'b');
  emblem(g);
  return g;
}

// the other figures, drawn whole: b is the figure, a its trim
const FULL = 'bbbbbbbbbbbbbbbbbbbbbbbb', BLANK = '........................';
const PEOPLE: Record<string, string[]> = {
  // a bearded king with a crown and an ermine collar
  king: [BLANK, '......a....aa....a......', '......aa..aaaa..aa......', '......aaaaaaaaaaaa......', '......aaaaaaaaaaaa......',
    '.....bbbbbbbbbbbbbb.....', '.....bb..........bb.....', '.....b............b.....', '.....b..bb....bb..b.....', '.....b............b.....',
    '.....b.....bb.....b.....', '.....b............b.....', '.....bbbbbbbbbbbbbb.....', '.....bbbbb....bbbbb.....', '......bbbbbbbbbbbb......',
    '.......bbbbbbbbbb.......', '........bbbbbbbb........', '.........bbbbbb.........', '..........bbbb..........', '....aaaaaa....aaaaaa....',
    '..aaaaaaaa....aaaaaaaa..', '.bbbbbbbbbb..bbbbbbbbbb.', FULL, FULL, FULL, FULL],
  // a queen with a jewelled crown, long hair and a pendant
  queen: [BLANK, '...........aa...........', '........a..aa..a........', '........aaaaaaaa........', '.......bbbbbbbbbb.......',
    '......bbbbbbbbbbbb......', '.....bbb........bbb.....', '.....bb..........bb.....', '.....bb..bb..bb..bb.....', '.....bb..........bb.....',
    '.....bb....bb....bb.....', '.....bb..........bb.....', '.....bb...bbbb...bb.....', '.....bbbb......bbbb.....', '....bbbbbbb..bbbbbbb....',
    '....bbbbbb....bbbbbb....', '....bbbbbb....bbbbbb....', '....bbbbbaaaaaabbbbb....', '...bbbbbbb.aa.bbbbbbb...', '..bbbbbbbbbbbbbbbbbbbb..',
    '.bbbbbbbbbbbbbbbbbbbbbb.', FULL, FULL, FULL, FULL, FULL],
  // a hooded monk with a cross
  monk: [BLANK, BLANK, '..........bbbb..........', '........bbbbbbbb........', '.......bbbbbbbbbb.......',
    '......bbbbbbbbbbbb......', '.....bbbbbbbbbbbbbb.....', '.....bbbb......bbbb.....', '....bbbb........bbbb....', '....bbb..bb..bb..bbb....',
    '....bbb..........bbb....', '....bbb....bb....bbb....', '....bbb..........bbb....', '....bbbb...bb...bbbb....', '....bbbbb......bbbbb....',
    '....bbbbbbbbbbbbbbbb....', '...bbbbbbbbbbbbbbbbbb...', '...bbbbbbbbbbbbbbbbbb...', '..bbbbbbbbbaabbbbbbbbb..', '..bbbbbbbaaaaaabbbbbbb..',
    '.bbbbbbbbbbaabbbbbbbbbb.', '.bbbbbbbbbbaabbbbbbbbbb.', FULL, FULL, FULL, FULL],
  // a warhorse's head and neck, with its mane and bridle
  horse: [BLANK, '..............b.........', '.............bb.b.......', '............bbbbb.......', '...........bbbbbbb......',
    '..........bbbbbbbbb.....', '.........bbbb.bbbbba....', '........bbbbbbbbbbbaa...', '.......bbbbbbbbbbbbbaa..', '......bbbbbbbbbbbbbbbaa.',
    '.....bbbbbbbbbbbbbbbbbaa', '....bbbbbbaabbbbbbbbbbaa', '..bbbbbbbaabbbbbbbbbbbaa', '.bbbbbbbbaabbbbbbbbbbbaa', '.bb.bbbbbaabbbbbbbbbbbaa',
    '.bbbbbbbbaabbbbbbbbbbbaa', '..bbbbbbbaa.bbbbbbbbbbaa', '...bbbbbb....bbbbbbbbbaa', '.............bbbbbbbbbaa', '............bbbbbbbbbbaa',
    '...........bbbbbbbbbbbaa', '..........bbbbbbbbbbbbaa', '.........bbbbbbbbbbbbbaa', '........bbbbbbbbbbbbbbaa', '.......bbbbbbbbbbbbbbbaa',
    '......bbbbbbbbbbbbbbbbaa'],
  // a grim reaper: a skull in a deep hood, the scythe over its shoulder
  reaper: ['.aaaaaaa................', '.aa....aaaa.............', '.aa.......aaa...........', '.aa.........aa..........', '.aa.......bbbb..........',
    '.aa.....bbbbbbbb........', '.aa....bbbbbbbbbb.......', '.aa...bbbbbbbbbbbb......', '.aa..bbbb......bbbb.....', '.aa..bbb..aaaa..bbb.....',
    '.aa..bbb.aaaaaa.bbb.....', '.aa..bbb.a.aa.a.bbb.....', '.aa..bbb.aaaaaa.bbb.....', '.aa..bbb..aaaa..bbb.....', '.aa..bbb..a.a...bbb.....',
    '.aa..bbbb......bbbb.....', '.aa..bbbbbbbbbbbbbb.....', '.aa.bbbbbbbbbbbbbbbb....', '.aa.bbbbbbbbbbbbbbbbb...', '.aabbbbbbbbbbbbbbbbbbb..',
    '.aabbbbbbbbbbbbbbbbbbbb.', '.aabbbbbbbbbbbbbbbbbbbbb', '.aabbbbbbbbbbbbbbbbbbbbb', '.aabbbbbbbbbbbbbbbbbbbbb', '.aabbbbbbbbbbbbbbbbbbbbb',
    '.aabbbbbbbbbbbbbbbbbbbbb'],
  // a bishop in his mitre and stole
  bishop: ['...........aa...........', '..........aaaa..........', '.........aaaaaa.........', '........aaabbaaa........', '........aabbbbaa........',
    '........aaabbaaa........', '........aaaaaaaa........', '.......bbbbbbbbbb.......', '.......b........b.......', '.......b.bb..bb.b.......',
    '.......b........b.......', '.......b...bb...b.......', '.......b........b.......', '.......b..bbbb..b.......', '........b......b........',
    '.........bbbbbb.........', '..........bbbb..........', '....bbbbbbbbbbbbbbbb....', '...bbbbbaabbbbaabbbbb...', '..bbbbbbaabbbbaabbbbbb..',
    '.bbbbbbbaabbbbaabbbbbbb.', 'bbbbbbbbaabbbbaabbbbbbbb', 'bbbbbbbbaabbbbaabbbbbbbb', 'bbbbbbbbaabbbbaabbbbbbbb', 'bbbbbbbbaabbbbaabbbbbbbb',
    'bbbbbbbbaabbbbaabbbbbbbb'],
  // a jester in a belled cap and a ruff
  jester: ['..a..................a..', '..bb................bb..', '...bbb............bbb...', '....bbbb........bbbb....', '.....bbbbbb..bbbbbb.....',
    '......bbbbbbbbbbbb......', '......aaaaaaaaaaaa......', '......b..........b......', '......b..bb..bb..b......', '......b..........b......',
    '......b....bb....b......', '......b..........b......', '......b..b....b..b......', '......b...bbbb...b......', '.......b........b.......',
    '........bbbbbbbb........', '..aaaaaaaaaaaaaaaaaaaa..', '..a.a.a.a.a.a.a.a.a.a...', '...bbbbbbbbbbbbbbbbbb...', '..bbbbbbbbbbbbbbbbbbbb..',
    '.bbbbbbbbbbbbbbbbbbbbbb.', FULL, FULL, FULL, FULL, FULL],
};

// a small heraldic charge in the top corner, so figures of the same kind still differ
const CHARGES = [
  ['a.a.a', '.aaa.', 'aaaaa', '.aaa.', 'a.a.a'], // star
  ['.aaa.', 'aa...', 'a....', 'aa...', '.aaa.'], // moon
  ['a.a.a', '.aaa.', 'aa.aa', '.aaa.', 'a.a.a'], // sun
  ['..a..', 'aaaaa', '..a..', '..a..', '.....'], // cross
  ['..a..', '.aaa.', 'aaaaa', '.aaa.', '..a..'], // lozenge
  [], // none
];
const VARIANTS = CHARGES.length * 2 * 2;

// one of the people, varied by its charge, which way it faces, and whether its trim is picked out
function person(kind: string, v: number): Grid {
  v = (v * 5) % VARIANTS;
  const charge = CHARGES[v % CHARGES.length], mirror = Math.floor(v / CHARGES.length) % 2 === 1, plain = v >= VARIANTS / 2;
  const g = PEOPLE[kind].map((row, y) => [...row].map((d) => (plain && y > 16 && d === 'a' ? 'b' : d)));
  charge.forEach((row, y) => [...row].forEach((d, x) => { if (d === 'a') g[1 + y][1 + x] = 'a'; }));
  return mirror ? g.map((row) => row.reverse()) : g;
}

// birth number n to its portrait: two knights in every nine, then one of each of the others; kind picks one
// outright (the Coroner is the reaper)
const ORDER = ['knight', 'king', 'horse', 'monk', 'knight', 'queen', 'bishop', 'reaper', 'jester'];
export function portrait(n: number, kind = ORDER[n % ORDER.length]): Grid {
  const round = Math.floor(n / ORDER.length);
  return kind === 'knight' ? knight(round * 2 + (n % ORDER.length === 4 ? 1 : 0)) : person(kind, round);
}

// the seal's double rule and corner blocks, on a 400 square
function Rule({ c }: { c: string }) {
  return (
    <>
      <rect x="18" y="18" width="364" height="364" fill="none" stroke={c} strokeWidth="9" />
      <rect x="33" y="33" width="334" height="334" fill="none" stroke={c} strokeWidth="3" />
      {[[6, 6], [366, 6], [6, 366], [366, 366]].map(([x, y]) => <rect key={`${x}.${y}`} x={x} y={y} width="28" height="28" fill={c} />)}
    </>
  );
}

// a verified scribe's portrait wears a gold frame, the only place gold is used
export function Figure({ seed, n, kind, verified, bare }: { seed: string; n: number; kind?: string; verified?: boolean; bare?: boolean }) {
  const main = sealColour(seed), accent = main === BLUE ? RED : BLUE, id = useId();
  // the figure stands on the inner rule (bare: on the bottom edge, where the card draws its line)
  const g = portrait(n, kind), P = 10, x0 = 200 - COLS * P / 2, y0 = (bare ? 400 : 365.5) - (ROWS - .5 + .36) * P;
  return (
    <svg viewBox="0 0 400 400" role="img" aria-label={`a ${kind ?? ORDER[n % ORDER.length]}`} style={{ width: '100%', height: '100%', display: 'block', background: '#f1f1ef' }}>
      {verified && <defs><Gold id={`g${id}`} size={400} /></defs>}
      {!bare && <Rule c={verified ? `url(#g${id})` : main} />}
      {g.flatMap((row, y) => row.map((d, x) => d === '.' ? null : <circle key={`${x}.${y}`} cx={x0 + (x + .5) * P} cy={y0 + (y + .5) * P} r={P * .36} fill={d === 'a' ? accent : main} />))}
    </svg>
  );
}

// an uploaded picture inside the same frame
export function Framed({ seed, children }: { seed: string; children: ReactNode }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#f1f1ef' }}>
      <div style={{ position: 'absolute', inset: '9.5%', overflow: 'hidden' }}>{children}</div>
      <svg viewBox="0 0 400 400" aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}><Rule c={sealColour(seed)} /></svg>
    </div>
  );
}

// the gold of a verified scribe: the same foil photo as the verify block (public/textures/gold-foil.jpg) under
// the same thin layer of flat gold, as an svg pattern the size of the drawing it fills
function Gold({ id, size }: { id: string; size: number }) {
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" width={size} height={size}>
      <image href="/textures/gold-foil.jpg" width={size} height={size} preserveAspectRatio="xMidYMid slice" />
      <rect width={size} height={size} fill="rgb(207, 163, 59)" fillOpacity={.55} />
    </pattern>
  );
}

// the verified mark, set after a name: a gold block with the frame's four corner blocks, the tick cut out of it.
// On gold it turns over: the block is the page colour and the gold shows through the tick.
export function VerifiedMark({ size = 18, onGold }: { size?: number; onGold?: boolean }) {
  const id = useId();
  return (
    <svg className="verified-mark" width={size} height={size} viewBox="0 0 40 40" role="img" aria-label="verified">
      <defs>
        <Gold id={`g${id}`} size={40} />
        <mask id={`m${id}`} maskUnits="userSpaceOnUse" x="0" y="0" width="40" height="40">
          <rect width="40" height="40" fill="#fff" /><path d="M13 20.5l4.8 4.8 9.4-9.6" fill="none" stroke="#000" strokeWidth="3.8" strokeLinecap="square" />
        </mask>
      </defs>
      <g mask={`url(#m${id})`} fill={onGold ? '#f1f1ef' : `url(#g${id})`}>
        <rect x="6" y="6" width="28" height="28" />
        {[[2, 2], [30, 2], [2, 30], [30, 30]].map(([x, y]) => <rect key={`${x}.${y}`} x={x} y={y} width="8" height="8" />)}
      </g>
    </svg>
  );
}

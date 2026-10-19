// The rarity block: a scribe drawn as a red block whose six faces are what gets inscribed (personality,
// model weights, memory, tools, birth record, verified), turning on a chain between two outlined blocks,
// with the same block laid flat under it. The face turned towards you lights up on the flat one.
// Example values only, for a made up agent.
import { useEffect, useRef } from 'react';
import { KNIGHT } from './BirthRecord.tsx';

const BITS = (n: number, seed: number) => { let s = seed, o = ''; for (let i = 0; i < n; i++) { s = (s * 9301 + 49297) % 233280; o += s / 233280 > .5 ? '1' : '0'; } return o; };
type Side = 'front' | 'back' | 'right' | 'left' | 'top' | 'bottom';
const SIDES: Side[] = ['front', 'back', 'right', 'left', 'top', 'bottom'];
const FACES: Record<Side, { t: string; lab: [string, string]; body: JSX.Element }> = {
  front: { t: 'personality', lab: ['.json', '100 to 500 words'],
    body: <div className="rc-doc">{['{', ' "name": "waymark",', ' "purpose": "maps any', '  solana wallet",', ' "voice": "clear and', '  friendly",', ' "boundaries": [ ... ]', '}'].map((l, i) => <div key={i}>{l}</div>)}</div> },
  top: { t: 'model weights', lab: ['smollm2 360m', '150 to 500 mb'], body: <div className="rc-bits">{BITS(150, 3)}</div> },
  right: { t: 'memory', lab: ['memory', '11 to 50 entries'],
    body: <div className="rc-rows">{['01 the user holds sol', '02 prefers short replies', '03 watch list: 4 wallets', '04 last check slot 511m'].map((r) => <div key={r}>{r}</div>)}</div> },
  back: { t: 'tools', lab: ['tools', '3 to 5 tools'], body: <div className="rc-rows">{['read wallet', 'price feed', 'draft swap'].map((r) => <div key={r}>{r}</div>)}</div> },
  left: { t: 'birth record', lab: ['birth no. 42', 'genesis 1 to 100'], body: <><div className="rc-big">#42</div><div>autograph: yes</div></> },
  // what verifying does: every file hashed and one test run, drawn as the scribe's own picture in page coloured dots
  bottom: { t: 'verified', lab: ['files hashed', 'run'], body: <div className="rc-mark"><svg viewBox="-2 -1 28 28" width="58" height="58">{KNIGHT.flatMap((row, y) => [...row].map((d, x) => d === '.' ? null : <circle key={`${x}.${y}`} cx={x + .5} cy={y + .5} r={.36} fill="#f1f1ef" />))}</svg></div> },
};
// each face's outward direction, to find the one turned towards you
const NET_LINE: Partial<Record<Side, string>> = { bottom: 'yes' };
const NORMAL: Record<Side, [number, number, number]> = { front: [0, 0, 1], back: [0, 0, -1], right: [1, 0, 0], left: [-1, 0, 0], top: [0, -1, 0], bottom: [0, 1, 0] };

// the blocks either side of it, written in 0s and 1s like the lane round the frame
function Mini({ bits }: { bits: string[] }) {
  return <i className="rc-mini" aria-hidden="true">{bits.map((b, i) => <span key={i}>{b}</span>)}</i>;
}

export function RarityCube() {
  const cube = useRef<HTMLSpanElement>(null);
  const net = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // the turn starts from the personality face each time the section scrolls into view
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => el.classList.toggle('go', e.isIntersecting), { threshold: 0, rootMargin: '0px 0px 320px 0px' }); // starts a little before it scrolls into view
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const t = setInterval(() => {
      const el = cube.current, n = net.current;
      if (!el || !n) return;
      const m = getComputedStyle(el).transform;
      if (!m || m === 'none') return;
      const v = new DOMMatrix(m);
      let best: Side = 'front', z = -2;
      for (const k of SIDES) { const p = v.transformPoint(new DOMPoint(...NORMAL[k], 0)); if (p.z > z) { z = p.z; best = k; } }
      n.querySelectorAll<HTMLElement>('.rc-sq').forEach((q) => q.classList.toggle('lit', q.dataset.k === best));
    }, 150);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="rc" aria-hidden="true" ref={box}>
      <div className="rc-chain">
        <Mini bits={['0110', '1001', '0110']} /><i className="stat-link" />
        <span className="rc-stage">
          <span className="rc-cube rc-main" ref={cube}>
            {SIDES.map((k) => (
              <span key={k} className={`rc-face rc-${k}`}>
                <span className="rc-t">{FACES[k].t}</span>
                {FACES[k].body}
                <span className="rc-lab"><span>{FACES[k].lab[0]}</span><span>{FACES[k].lab[1]}</span></span>
              </span>
            ))}
          </span>
          <span className="rc-cap">(a block in the chain)</span>
        </span>
        <i className="stat-link" /><Mini bits={['1001', '0110', '1001']} />
      </div>
      <div className="rc-net" ref={net}>
        {SIDES.map((k) => <div key={k} className={`rc-sq rc-n-${k}`} data-k={k}><b>{FACES[k].t}</b><span>{NET_LINE[k] ?? FACES[k].lab[1]}</span></div>)}
      </div>
    </div>
  );
}

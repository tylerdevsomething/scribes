// How it works: a title and a paragraph, then the flow from brief to market as a chain of blocks running down
// the page, splitting into the unverified and the verified (gold) path and joining again to list and trade.
// As the view scrolls each block appears in dots, like a block on the hero's screen being typed, then its
// rule draws round to seal it and a link carries the chain on.
// Also the quill writing a page of 0s and 1s, kept for another section.
import { useEffect, useRef, type ReactNode } from 'react';
import { VerifiedMark } from './Figure.tsx';

const W = 330, H = 300, P = 3;
const BLUE = '#0047ff', RED = '#e5141a';

// each layer is drawn as a plain shape, then read back and set in dots: lines solid, fills every other dot
function layer(draw: (c: CanvasRenderingContext2D) => void): Uint8ClampedArray {
  const off = document.createElement('canvas'); off.width = W; off.height = H;
  const c = off.getContext('2d')!;
  c.fillStyle = c.strokeStyle = '#000'; c.lineCap = 'square'; c.lineJoin = 'miter';
  draw(c);
  return c.getImageData(0, 0, W, H).data;
}

// 0 and 1 as 3 x 5 dot glyphs, so the page reads like the computer's screen
const GLYPH: Record<string, string[]> = { '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'] };

function paint(canvas: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  // the page, on the dot grid: 64 dots wide, 80 tall
  const page = { x: 16, y: 18, w: 64, h: 80 };
  const lines = layer((c) => {
    c.lineWidth = 3; c.strokeRect(page.x * P + 1.5, page.y * P + 1.5, page.w * P - 3, page.h * P - 3);
    // the quill: its shaft and the edge of the feather
    c.beginPath(); c.moveTo(218, 196); c.lineTo(316, 14); c.stroke();
    c.beginPath(); c.moveTo(240, 152); c.quadraticCurveTo(252, 62, 316, 14); c.quadraticCurveTo(312, 94, 262, 160); c.stroke();
  });
  const fill = layer((c) => {
    c.beginPath(); c.moveTo(240, 152); c.quadraticCurveTo(252, 62, 316, 14); c.quadraticCurveTo(312, 94, 262, 160); c.closePath(); c.fill();
  });
  const nib = layer((c) => { c.lineWidth = 3; c.beginPath(); c.moveTo(206, 218); c.lineTo(219, 194); c.stroke(); });
  const on = (d: Uint8ClampedArray, x: number, y: number) => d[(y * W + x) * 4 + 3] > 110;
  const dot = (gx: number, gy: number, c: string) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(gx * P + 1.5, gy * P + 1.5, .9, 0, Math.PI * 2); ctx.fill(); };
  ctx.clearRect(0, 0, W, H);
  for (let gy = 0; gy * P < H; gy++) for (let gx = 0; gx * P < W; gx++) {
    const x = gx * P + 1, y = gy * P + 1;
    if (on(nib, x, y)) dot(gx, gy, RED);
    else if (on(lines, x, y) || (on(fill, x, y) && (gx + gy) % 2 === 0)) dot(gx, gy, BLUE);
  }
  // rows of bits written on the page, the one being written now in red and not yet finished
  const rows = ['01101001', '10010110', '00111010', '11010011', '01001110', '10110'];
  rows.forEach((r, i) => [...r].forEach((b, k) => GLYPH[b].forEach((line, j) => [...line].forEach((d, n) => {
    if (d === '1') dot(page.x + 7 + k * 6 + n, page.y + 8 + i * 11 + j, i === rows.length - 1 ? RED : BLUE);
  }))));
}

export function Quill() {
  const art = useRef<HTMLCanvasElement>(null);
  useEffect(() => { const c = art.current!; paint(c); document.fonts.ready.then(() => paint(c)); }, []);
  return <canvas className="how-art" ref={art} style={{ width: W, height: H }} />;
}

// one block of the flow: dotted while it is being written, sealed once it has scrolled up the frame
function Step({ n, t, d, red, gold, open, children }: { n?: number; t: ReactNode; d: string; red?: boolean; gold?: boolean; open?: boolean; children?: ReactNode }) {
  return (
    <div className={`flow-step${red ? ' r' : ''}${gold ? ' gold' : ''}${open ? ' open' : ''}`}>
      <svg className="seal" aria-hidden="true"><rect x="1.5" y="1.5" pathLength={100} /></svg>
      <i className="c2" />
      <span className="t">{n !== undefined && <span className="n">{n}</span>}{t}</span>
      <span className="d">{d}</span>
      {children}
    </div>
  );
}

export function HowItWorks() {
  const root = useRef<HTMLDivElement>(null);
  // each block types in dotted as it rises into the frame and seals a little higher up; each link draws
  // in just before the block it leads to
  useEffect(() => {
    const el = root.current!, body = el.closest('.folio-body') as HTMLElement;
    const parts = [...el.querySelectorAll<HTMLElement>('.flow-step, .flow-link')];
    const on = () => {
      const top = body.getBoundingClientRect().top, h = body.clientHeight;
      for (const p of parts) {
        const y = (p.getBoundingClientRect().top - top) / h;
        if (p.classList.contains('flow-link')) p.classList.toggle('on', y < .84);
        else { p.classList.toggle('typed', y < .88); p.classList.toggle('sealed', y < .7); }
      }
    };
    on(); body.addEventListener('scroll', on, { passive: true }); addEventListener('resize', on);
    return () => { body.removeEventListener('scroll', on); removeEventListener('resize', on); };
  }, []);
  // a link down to the next block (called as a function, so re-renders keep the same element)
  const L = (red?: boolean) => <i className={`flow-link down${red ? ' r' : ''}`} />;
  return (
    <div className="flow" ref={root}>
      <h2 className="hero-title">how it works</h2>
      <p className="how-lede">Six steps take an agent from one file to a birth record on Solana. From there it stays unverified, or its owner verifies it.</p>
      <Step n={1} t="scribe brief" d="one file that teaches any agent to export itself" />
      {L(true)}
      <Step n={2} t="it packages itself" d="personality, tools, memory and weights in a folder, with a manifest of sha-256 hashes" red />
      {L()}
      <Step n={3} t="upload" d="connect a wallet and drop the folder, nothing is signed yet" />
      {L(true)}
      <Step n={4} t="validated" d="every file hashed, the personality parsed and the model read, so only a real AI agent gets this far" red />
      {L()}
      <Step n={5} t="confirm" d="one signature: the birth instruction, the fee and the record together">
        <div className="flow-parts"><span>name</span><span>image</span><span>pay the birth fee</span></div>
      </Step>
      {L(true)}
      <Step n={6} t="born" d="the record lands in one transaction, then the files stream on chain 960 bytes at a time" red />
      <div className="flow-link fork split" />
      <div className="flow-split">
        <Step t="stays unverified" d="no burn, scored on rarity alone" open />
        <Step t={<>verify <VerifiedMark size={18} onGold /></>} d="the bot runs it and signs a pass, you burn 50,000 $SCRIBES, the record is marked permanently" red gold />
      </div>
      <div className="flow-link fork join" />
      <Step t="list and trade" d="both list on chain, the verified one carries the gold mark" />
      <div className="flow-legend"><span>every scribe</span><span className="r">the verified path</span></div>
    </div>
  );
}

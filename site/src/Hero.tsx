// The illuminated page: the frame with its lane of 0s and 1s and the logo in its corner blocks, dot
// ornaments in the corners and crests top and bottom. On the explore page it holds still and only what is
// inside it changes as you scroll. The first view is the hero: the old computer typing a scribe into a
// chain, a title and one paragraph.
import { useEffect, useRef, type ReactNode, type WheelEvent } from 'react';
import { startChain } from './chain.ts';
import { Mark } from './Sigil.tsx';
import { drawOrnaments } from './ornaments.ts';

// the X account, and the docs (gitbook, connected once it is live; until then the square shows but goes nowhere)
const X_URL = 'https://x.com/scribeagents';
const DOCS_URL = '';

export function Folio({ children, className = '' }: { children: ReactNode; className?: string }) {
  const body = useRef<HTMLDivElement>(null);
  const orn = useRef<HTMLCanvasElement>(null);
  // the wheel scrolls the views inside the frame even when the pointer is over the border or ornaments
  const wheel = (e: WheelEvent) => { const b = body.current; if (b && !b.contains(e.target as Node)) b.scrollBy({ top: e.deltaY }); };
  // the ornaments follow the scroll: each frame's height scrolled is the next version, the dots crossing over between
  useEffect(() => {
    const b = body.current!, c = orn.current!;
    let raf = 0;
    // every frame's height of scroll brings the next version, on every page, however long its views are
    const at = () => b.scrollTop / Math.max(1, b.clientHeight);
    const draw = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => drawOrnaments(c, at())); };
    draw(); b.addEventListener('scroll', draw, { passive: true }); addEventListener('resize', draw);
    return () => { cancelAnimationFrame(raf); b.removeEventListener('scroll', draw); removeEventListener('resize', draw); };
  }, []);
  return (
    <section className={`hero-page ${className}`} onWheel={wheel}>
      <div className="hp-band">
        <div className="hp-page">
          <canvas className="orn" ref={orn} />
          <div className="folio-body" ref={body}>{children}</div>
        </div>
      </div>
      {/* TEST: the frame's corner blocks spell inscribe round the page (in, sc, ri, be) instead of four logos;
          the top left one leads home */}
      <a className="hc tl" href="#/" aria-label="scribes"><Letters t="in" /></a>
      <span className="hc tr"><Letters t="sc" /></span><span className="hc bl"><Letters t="ri" /></span><span className="hc br"><Letters t="be" /></span>
    </section>
  );
}

// a corner block drawn like the logo but in red (a red square, its white and blue rules), so it reads apart from
// the logo in the header, holding two letters
function Letters({ t }: { t: string }) {
  return (
    <svg width={34} height={34} viewBox="0 0 100 100" aria-hidden="true">
      <rect width="100" height="100" fill="#e5141a" />
      <rect x="7" y="7" width="86" height="86" fill="none" stroke="#ffffff" strokeWidth="3" />
      <rect x="12" y="12" width="76" height="76" fill="none" stroke="#0047ff" strokeWidth="2" />
      <text x="50" y="66" textAnchor="middle" fill="#fafafa" fontFamily="'Grenze Gotisch', serif" fontWeight="700" fontSize="48">{t}</text>
    </svg>
  );
}

// The number row's 1 and 0 keys on the computer drawing, as percentages of its size.
const KEY = { one: { l: 15.588, t: 80, w: 4.033, h: 2.237 }, zero: { l: 63.35, t: 80, w: 4.033, h: 2.237 } };

export function HeroScene() {
  const screen = useRef<HTMLCanvasElement>(null);
  const key = useRef<HTMLElement>(null);
  useEffect(() => {
    const c = screen.current!;
    const press = (one: boolean) => {
      const k = one ? KEY.one : KEY.zero, el = key.current;
      if (!el) return;
      Object.assign(el.style, { left: `${k.l}%`, top: `${k.t}%`, width: `${k.w}%`, height: `${k.h}%` });
      el.classList.add('down');
      setTimeout(() => el.classList.remove('down'), 180);
    };
    let stop = () => {};
    document.fonts.ready.then(() => { stop = startChain(c, { ox: c.offsetLeft % 3, oy: c.offsetTop % 3, onKey: press }); });
    return () => stop();
  }, []);

  return (
    <div className="hero-split">
      <div className="pc">
        <img src="/hero/computer.svg?v=2" alt="" />
        <i className="key" ref={key} />
        <canvas className="screen" ref={screen} />
        {/* a hint that there is more below, centred under the computer; it fades once you scroll */}
        {/* a turning arrow and the word scroll: click it to bring the data blocks to the top with the birth record under them */}
        <button type="button" className="scroll-cue" aria-label="scroll down" onClick={(e) => {
          const body = e.currentTarget.closest('.folio-body'), to = body?.querySelector<HTMLElement>('.scene-stats .stat-chain');
          if (!(body instanceof HTMLElement) || !to) return;
          // the views snap to their starts, which would pull this back: snapping is off until the scroll lands
          body.style.scrollSnapType = 'none';
          body.scrollTo({ top: body.scrollTop + to.getBoundingClientRect().top - body.getBoundingClientRect().top - 40, behavior: 'smooth' });
          const back = () => { body.style.scrollSnapType = ''; body.removeEventListener('wheel', back); body.removeEventListener('touchstart', back); };
          body.addEventListener('wheel', back, { passive: true }); body.addEventListener('touchstart', back, { passive: true });
        }}>
          {/* a down arrow with depth, turning slowly, and the word beside it */}
          <span className="cue-arrow" aria-hidden="true"><span className="ca">{[0, 1, 2, 3, 4, 5].map((i) => <svg key={i} viewBox="0 0 40 22" width="34" height="19" style={{ transform: `translateZ(${i - 2.5}px)` }}><path d="M3 3l17 16L37 3" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="square" /></svg>)}</span></span>
          <span className="scroll-word">scroll</span>
        </button>
      </div>
      <div className="hero-words">
        <h1 className="hero-title">inscribe ai agents on solana</h1>
        <p>A scribe is an AI agent written into Solana, byte by byte. Its personality and the code that runs it live on chain, and some carry their whole brain there too. Anyone can wake one in a browser, and nobody can ever take it down.</p>
        {/* under the words: the way in, then the X account and the docs as small stamped squares */}
        <div className="hero-go">
          <a className="stamp" href="#/create">inscribe now</a>
          <a className="stamp sq" href={X_URL} target="_blank" rel="noreferrer" aria-label="scribes on x" title="scribes on x">
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
          </a>
          <a className="stamp sq" href={DOCS_URL || undefined} target="_blank" rel="noreferrer" aria-label="the scribes docs" title={DOCS_URL ? 'the scribes docs' : 'the docs are coming soon'} aria-disabled={!DOCS_URL}>
            <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><path fill="currentColor" d="M10.802 17.77a.703.703 0 1 1-.002 1.406.703.703 0 0 1 .002-1.406m11.024-4.347a.703.703 0 1 1 .001-1.406.703.703 0 0 1-.001 1.406m0-2.876a2.176 2.176 0 0 0-2.174 2.174c0 .233.039.465.115.691l-7.181 3.823a2.165 2.165 0 0 0-1.784-.937c-.829 0-1.584.475-1.95 1.216l-6.451-3.402c-.682-.358-1.192-1.48-1.138-2.502.028-.533.212-.947.493-1.107.178-.1.392-.092.62.027l.042.023c1.71.9 7.304 3.847 7.54 3.956.363.169.565.237 1.185-.057l11.564-6.014c.17-.064.368-.227.368-.474 0-.342-.354-.477-.355-.477-.658-.315-1.669-.788-2.655-1.25-2.108-.987-4.497-2.105-5.546-2.655-.906-.474-1.635-.074-1.765.006l-.252.125C7.78 6.048 1.46 9.178 1.1 9.397.457 9.789.058 10.57.006 11.539c-.08 1.537.703 3.14 1.824 3.727l6.822 3.518a2.175 2.175 0 0 0 2.15 1.862 2.177 2.177 0 0 0 2.173-2.14l7.514-4.073c.38.298.853.461 1.337.461A2.176 2.176 0 0 0 24 12.72a2.176 2.176 0 0 0-2.174-2.174" /></svg>
          </a>
        </div>
      </div>
    </div>
  );
}

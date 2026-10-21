// The inscribe window: opens in the middle of the screen when inscribe is clicked and carries the whole checkout.
// The scribe's portrait (a question mark until the birth block is signed, which is when its birth number and so its
// figure are known), its name and purpose, a list of the real steps ticking off, the logo cube while it works, and
// the one button for what comes next: the price to sign, then (if verification was chosen and is open) the burn,
// then the way to my scribes. Gold throughout when verification was chosen. It can be closed with its x and
// opened again from the page; the inscription carries on either way.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CheckReport, ScribeView, UploadPhase } from './api.ts';
import { getScribe } from './api.ts';
import { explorer, sol } from './config.ts';
import { useWallet, wallets } from './wallet.ts';
import { useSettings } from './settings.ts';
import { Figure, VerifiedMark, portrait } from './Figure.tsx';
import { sealColour } from './Sigil.tsx';
import { burnBalance, burnToVerify, runChecks, tokens, type Verdict } from './pages/Verify.tsx';

// what the window calls on the chain and the indexer; the real ones by default, a demo can pass its own
export interface Drive {
  sign: () => Promise<UploadPhase>;
  scribe: (address: string) => Promise<ScribeView>;
  checks: (address: string) => Promise<Verdict>;
  burn: (me: string, address: string, pass: NonNullable<Verdict['pass']>) => Promise<string>;
  balance: (me: string) => Promise<bigint>;
}

const BLUE = '#0047ff', RED = '#e5141a';
// a question mark in the portraits' dots, 18 cells by 16, set in the middle of the frame
const QUESTION = ['......bbbbbb......', '....bbbbbbbbbb....', '...bbbb....bbbb...', '...bbb......bbb...', '............bbb...', '...........bbbb...', '..........bbbb....',
  '.........bbbb.....', '........bbbb......', '........bbb.......', '........bbb.......', '........bbb.......', '..................', '..................', '........bbb.......', '........bbb.......'];

// the frame and the question mark, drawn as Figure draws a portrait (a 400 unit box, the seal's two rules and its
// four corner blocks), in blue, or the site's gold when the scribe will be verified
function Unknown({ gold }: { gold: boolean }) {
  const c = gold ? 'url(#iw-gold)' : BLUE, x0 = 200 - QUESTION[0].length * 5, y0 = 200 - QUESTION.length * 5;
  return (
    <svg viewBox="0 0 400 400" aria-hidden="true" style={{ width: '100%', height: '100%', display: 'block', background: '#f1f1ef' }}>
      {gold && <defs><pattern id="iw-gold" patternUnits="userSpaceOnUse" width="400" height="400"><image href="/textures/gold-foil.jpg" width="400" height="400" preserveAspectRatio="xMidYMid slice" /><rect width="400" height="400" fill="rgb(207, 163, 59)" fillOpacity={.55} /></pattern></defs>}
      <rect x="18" y="18" width="364" height="364" fill="none" stroke={c} strokeWidth="9" />
      <rect x="33" y="33" width="334" height="334" fill="none" stroke={c} strokeWidth="3" />
      {[[6, 6], [366, 6], [6, 366], [366, 366]].map(([x, y]) => <rect key={`${x}.${y}`} x={x} y={y} width="28" height="28" fill={c} />)}
      {QUESTION.flatMap((row, j) => [...row].map((d, i) => d === '.' ? null : <circle key={`${i}.${j}`} cx={x0 + (i + .5) * 10} cy={y0 + (j + .5) * 10} r={3.6} fill={BLUE} />))}
    </svg>
  );
}

// the reveal: the question mark bursts, its dots multiply into the portrait's number and bounce around the frame
// like loose type, then each flies to its own place in the portrait, taking its colour on the way. Drawn on a canvas
// over the portrait (whose own dots stay hidden until it lands), in the portrait's 400 unit box
function Reveal({ n, seed, onDone }: { n: number; seed: string; onDone: () => void }) {
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = cv.current!, dpr = Math.max(2, devicePixelRatio || 1), x = c.getContext('2d')!;
    c.width = c.height = 150 * dpr; x.setTransform(150 * dpr / 400, 0, 0, 150 * dpr / 400, 0, 0);
    const main = sealColour(seed), accent = main === BLUE ? RED : BLUE, g = portrait(n);
    const x0 = 200 - 24 * 5, y0 = 365.5 - (26 - .5 + .36) * 10, q0x = 200 - QUESTION[0].length * 5, q0y = 200 - QUESTION.length * 5;
    const from: [number, number][] = [];
    QUESTION.forEach((row, j) => [...row].forEach((d, i) => { if (d !== '.') from.push([q0x + (i + .5) * 10, q0y + (j + .5) * 10]); }));
    const rnd = (k: number) => ((Math.imul(k + 1, 2654435761) >>> 0) / 4294967296);
    const dots = g.flatMap((row, j) => row.map((d, i) => d === '.' ? null : { tx: x0 + (i + .5) * 10, ty: y0 + (j + .5) * 10, c: d === 'a' ? accent : main }).filter(Boolean)) as { tx: number; ty: number; c: string }[];
    const ps = dots.map((d, k) => {
      const [sx, sy] = from[k % from.length], a = rnd(k) * Math.PI * 2, v = 260 + rnd(k + 999) * 420;
      return { ...d, x: sx, y: sy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, lag: rnd(k + 77) * .35 };
    });
    const LO = 44, HI = 356, BOUNCE = 2.2, GATHER = 1.4;
    let t0 = 0, last = 0, raf = 0;
    const tick = (now: number) => {
      if (!t0) { t0 = last = now; }
      const t = (now - t0) / 1000, dt = Math.min(.033, (now - last) / 1000); last = now;
      x.clearRect(0, 0, 400, 400);
      for (const p of ps) {
        // loose in the frame the whole time: a little gravity, and they bounce off the inner rule
        p.vy += 380 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.x < LO) { p.x = LO; p.vx = Math.abs(p.vx) * .82; } if (p.x > HI) { p.x = HI; p.vx = -Math.abs(p.vx) * .82; }
        if (p.y < LO) { p.y = LO; p.vy = Math.abs(p.vy) * .82; } if (p.y > HI) { p.y = HI; p.vy = -Math.abs(p.vy) * .78; }
        // while still moving, each is drawn more and more towards its place, so the bounce flows straight into
        // the portrait with no stop between
        const k = Math.min(1, Math.max(0, (t - BOUNCE * .55 - p.lag) / GATHER)), e = k * k * (3 - 2 * k);
        const px = p.x + (p.tx - p.x) * e, py = p.y + (p.ty - p.y) * e;
        x.fillStyle = k > .5 ? p.c : BLUE; x.beginPath(); x.arc(px, py, 3.6, 0, Math.PI * 2); x.fill();
      }
      if (t < BOUNCE * .55 + .35 + GATHER) raf = requestAnimationFrame(tick); else onDone();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [n, seed, onDone]);
  return <canvas ref={cv} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />;
}

type Step = { a: string; b: string; ok: boolean };

export function InscribeWindow({ name, purpose, checking, error, report, phase, verify, drive, onClose, wallet, amountLabel }: {
  name: string; purpose: string;
  checking: boolean; error: string; // uploading and the bot's check, and anything that stopped it
  report: CheckReport | null; phase: UploadPhase | null;
  verify: boolean; // chosen on the form, and verification is open
  drive: Drive; onClose: () => void;
  wallet?: string; amountLabel?: string; // for the demo only: a wallet and a burn amount to show without a real one
}) {
  const connected = useWallet(), me = wallet ?? connected;
  const settings = useSettings();
  const [busy, setBusy] = useState('');
  const [fault, setFault] = useState('');
  const [s, setS] = useState<ScribeView | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [burned, setBurned] = useState('');
  const [balance, setBalance] = useState<bigint | null>(null);
  const [landed, setLanded] = useState(false);
  const land = useCallback(() => setLanded(true), []);

  const signed = phase?.phase === 'inscribing' || phase?.phase === 'done';
  const done = phase?.phase === 'done';
  const address = report?.scribe ?? null;

  // the scribe's record (its birth number picks the portrait) is asked for once the birth block is signed
  useEffect(() => {
    if (!signed || !address || s) return;
    let live = true;
    const ask = () => drive.scribe(address).then((v) => live && setS(v)).catch(() => {});
    ask(); const t = setInterval(ask, 2000);
    return () => { live = false; clearInterval(t); };
  }, [signed, address, s, drive]);

  // once every file is on solana, a scribe to be verified goes straight to the bot's checks
  useEffect(() => {
    if (!done || !verify || !address || verdict) return;
    let live = true, tries = 0;
    const ask = () => drive.checks(address).then((v) => live && setVerdict(v)).catch(() => { if (live && ++tries < 20) t = setTimeout(ask, 3000); });
    let t = setTimeout(ask, 0);
    return () => { live = false; clearTimeout(t); };
  }, [done, verify, address, verdict, drive]);
  useEffect(() => { if (verify && me) drive.balance(me).then(setBalance); }, [verify, me, drive, burned]);

  const amount = amountLabel ?? (settings?.burnAmount ? tokens(settings.burnAmount, settings) : '');
  const enough = amountLabel ? true : !!settings && balance !== null && balance >= BigInt(settings.burnAmount || 0);
  const gold = verify;

  const steps: Step[] = [
    { a: 'files', b: 'uploaded and checked', ok: !!report?.ok },
    { a: 'birth block', b: 'signed', ok: signed && (!!s || done) },
    { a: 'chunk transactions', b: phase?.phase === 'inscribing' ? `${phase.done.toLocaleString()} of ${phase.total.toLocaleString()} written` : done && report?.quote ? `${report.quote.chunks.toLocaleString()} of ${report.quote.chunks.toLocaleString()} written` : 'written', ok: done },
    { a: 'every file', b: 'on solana', ok: done },
  ];
  if (verify) steps.push({ a: 'checks', b: verdict && !verdict.ok ? 'not passed' : 'every file verified', ok: !!verdict?.ok }, { a: `${amount} $scribes`, b: 'burned', ok: !!burned });

  async function sign() {
    setFault('');
    try { setBusy('approve it in your wallet'); await drive.sign(); } catch (e) { setFault((e as Error).message); } finally { setBusy(''); }
  }
  async function burn() {
    if (!me || !address || !verdict?.pass) return;
    setFault('');
    try { setBusy('approve the burn in your wallet'); setBurned(await drive.burn(me, address, verdict.pass)); } catch (e) { setFault((e as Error).message); } finally { setBusy(''); }
  }

  // the one button at the foot, for whatever comes next
  const found = wallets(); // signing connects one first when none is connected
  let foot: React.ReactNode = null;
  if (report && !report.ok) foot = <button className="iw-go" onClick={onClose}>change and try again</button>;
  else if (report?.ok && !phase) foot = !me && !found.length
    ? <span className="iw-note">install a solana wallet to inscribe</span>
    : <button className="iw-go" disabled={!!busy} onClick={sign}>{busy || `inscribe for ${report.quote ? sol(report.quote.totalLamports) : ''} sol`}</button>;
  else if (done && verify && !burned) foot = !verdict
    ? <button className="iw-go" disabled>running the checks</button>
    : verdict.ok
      ? <button className={`iw-go${balance !== null && !enough ? ' short' : ''}`} disabled={!!busy || !enough} onClick={burn}>{busy || (balance !== null && !enough ? `you need ${amount} $scribes to verify` : `verify, burn ${amount} $scribes`)}</button>
      : <a className="iw-go" href="#/me">inscribed, view</a>;
  else if (done) foot = <a className="iw-go" href="#/me">inscribed, view</a>;

  const working = !done && !(report && !report.ok) && !(report?.ok && !phase);
  return (
    <div className={`iw${gold ? ' gold' : ''}`} role="dialog" aria-label={`inscribing ${name}`}>
      <i className="c tl" /><i className="c tr" /><i className="c bl" /><i className="c br" />
      <div className="iw-ctl">
        <button type="button" title="close" onClick={onClose}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" /></svg></button>
      </div>
      <div className="iw-top">
        <div className="iw-pic">
          {!s && <Unknown gold={gold} />}
          {s && <div className={`iw-fig${landed ? '' : ' hold'}`}><Figure seed={s.address} n={s.birthNumber} verified={gold} /></div>}
          {s && !landed && <Reveal n={s.birthNumber} seed={s.address} onDone={land} />}
        </div>
        <div>
          <h2><span className="iw-name">{(name || 'scribe').toLowerCase()}</span>{burned && <VerifiedMark size={22} />}</h2>
          {purpose && <p className="iw-what">{purpose.toLowerCase()}</p>}
        </div>
      </div>
      {report && !report.ok
        ? <ul className="iw-steps">{report.problems.map((p) => <li key={p} className="bad"><b /><span>{p.toLowerCase()}</span></li>)}</ul>
        : <ul className="iw-steps">{steps.map((st) => <li key={st.a} className={st.ok ? 'ok' : ''}><b /><span><span className="a">{st.a}</span>, {st.b}</span></li>)}</ul>}
      {working || checking || (done && verify && !burned && !verdict)
        ? <div className="iw-mid"><span className="loading-cube"><span className="lc">{['f', 'b', 'r', 'l', 't', 'u'].map((k) => <img key={k} className={`lf lf-${k}`} src="/favicon.svg?v=4" alt="" />)}</span></span></div>
        : <div className="iw-mid" />}
      {report?.ok && !phase && report.quote && <p className="iw-note">{verify ? 'two signatures. this one inscribes it, the second burns $scribes once every file is on solana.' : 'one signature. once born, a scribe exists forever.'}</p>}
      {(fault || error || phase?.phase === 'failed') && <p className="iw-bad">{phase?.phase === 'failed' ? 'inscription paused. it resumes on its own and nothing you paid is lost.' : (fault || error).toLowerCase()}</p>}
      <div className="iw-foot">
        {foot}
        {done && phase?.phase === 'done' && <a className="iw-tx" href={explorer('tx', phase.signature)} target="_blank" rel="noreferrer">birth block</a>}
      </div>
    </div>
  );
}

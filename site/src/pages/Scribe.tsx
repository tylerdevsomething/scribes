import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type PointerEvent as RPointerEvent } from 'react';
import { fileTag, readFile } from '../../../lib/src/chain.ts';
import { chunkCount } from '../../../lib/src/chunk.ts';
import { decodeUtf8, sha256Hex } from '../../../lib/src/bytes.ts';
import { fetchScribe, scribesProgram } from '../../../lib/src/registry.ts';
import { decodeManifest, parseLink, type Manifest } from '../../../lib/src/manifest.ts';
import { parsePersonality, systemPrompt, type Personality } from '../../../lib/src/personality.ts';
import { ATTRIBUTES, type Attribute } from '../../../lib/src/rarity.ts';
import { fileUrl, getScribe, type ScribeView } from '../api.ts';
import { CLUSTER, conn, explorer, modelName, short } from '../config.ts';
import { COMING, InscribingBar, Capsule, Portrait, brainLine, isVerified, questions } from './Gallery.tsx';
import { birthDay, sealColour } from '../Sigil.tsx';
import { Folio } from '../Hero.tsx';
import { VerifiedMark } from '../Figure.tsx';
import { sigil } from '../../../lib/src/sigil.ts';
import type { Brain, Turn } from '../run/brain.ts';
import { loadInscribed, type Step } from '../run/inscribed.ts';
import { describeError, HostedError, hostedFor, hostedStatus, keyStore, loadBound, loadHosted, type HostedStatus } from '../run/bound.ts';
import { PROVIDERS, isProvider } from '../../../lib/src/hybrid.ts';
import { PAGE_TOOLS } from '../../../lib/src/tools.ts';
import { enabledTools, type Proposal } from '../run/tools.ts';
import { TOOL_CATALOG } from '../../../lib/src/tools.ts';
import { SystemProgram, PublicKey } from '@solana/web3.js';
import { sendInstructions, signVersioned, useWallet } from '../wallet.ts';
import { WalletButton } from '../WalletButton.tsx';
import { MarketPanel } from './Market.tsx';
import { VerifyPanel } from './Verify.tsx';
import { Info } from './Create.tsx';
import { useActivity } from './Activity.tsx';
import { sol } from '../config.ts';
import { LibraryPanel } from '../LibraryPanel.tsx';
import { Rich } from '../Rich.tsx';
import { Loading, useHold } from '../Loading.tsx';

// the visitor's own key for a hybrid scribe: which provider, and what the key is called
const providerOf = (s: ScribeView) => (s.brain?.kind === 'bound' ? s.brain.provider : 'anthropic');
const keyLabel = (s: ScribeView) => { const p = providerOf(s); return `${isProvider(p) ? PROVIDERS[p].keyName : p} api key`.toLowerCase(); };
// each check before a chat stays on screen a moment so it can be read
const hold = () => new Promise((r) => setTimeout(r, 900));
// Where each attribute comes from (the brief's colour code).
const FROM_CHAIN: Attribute[] = ['Birth', 'Autograph', 'Verified'];

// The profile of a scribe on its way: its banner, picture, name and bio, with every on-chain field still empty.
// what is already settled for it: a hybrid scribe on Claude, born among the first hundred
const KNOWN: Partial<Record<string, string>> = { Brain: 'Bound', Weight: 'n/a (bound)', Birth: 'Genesis #1 to 100', Autograph: 'No', Verified: 'No' };
export function ComingProfile() {
  return (
    <Folio className="folio-hero stage">
      <div className="scene scene-profile">
        <a className="pf-back" href="#/explore"><svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M8 2L4 6l4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" /></svg>back to browse</a>
        <header className="pf-head">
          <div className="pf-banner coming" style={{ '--c': 'var(--green)' } as CSSProperties}><img src={COMING.banner} alt="" /></div>
          <div className="pf-bar">
            <div className="portrait pf-pic coming" style={{ '--c': 'var(--green)' } as CSSProperties}><img src={COMING.pic} alt={COMING.name} /><i className="card-rule" /></div>
          </div>
          <div className="pf-namerow">
            <h1 className="hero-title pf-name">{COMING.name}</h1>
            <div className="stat-chain pf-chain">
              <div className="stat"><i className="c2" /><b>…</b><span>born</span></div>
              <i className="stat-link" />
              <div className="stat"><i className="c2" /><b>…</b><span>owner</span></div>
              <i className="stat-link" />
              <div className="stat"><i className="c2" /><b>…</b><span>rarity rank</span></div>
            </div>
          </div>
          <p className="pf-bio">{COMING.bio}</p>
          <div className="pf-counts">
            <span><b>…</b> model</span>
            <span><b>…</b> files</span>
            <span><b>…</b> transactions</span>
            <span><b>…</b> memories</span>
          </div>
          <div className="pf-actions"><InscribingBar className="ib-profile" /></div>
        </header>
        <div className="pf-feed">
          <div className="pf-grid">
            <div className="panel">
              <div className="panel-head"><h3>rarity</h3></div>
              <table className="attrs"><tbody>{ATTRIBUTES.map((a) => <tr key={a}><td>{a}</td><td>{KNOWN[a] ?? '…'}</td><td>…</td></tr>)}</tbody></table>
            </div>
            <div className="pf-capsule">
              <div className="panel"><div className="panel-head"><h3>Capsule</h3></div><p className="pf-note">…</p></div>
            </div>
          </div>
          <div className="pf-row2">
            <div className="panel filelist">
              <div className="panel-head"><h3>inscribed files</h3></div>
              <table className="pf-table"><thead><tr><th>file</th><th>role</th><th>size</th><th>transactions</th><th>sha256</th><th></th></tr></thead><tbody>{[['personality.json', 'personality'], ['truth_terminal.jpg', 'picture'], ['wiki.library', 'library'], ['backrooms.library', 'library'], ['manifest.json', 'manifest']].map(([f, r]) => <tr key={f + r}><td className="case">{f}</td><td>{r}</td><td>…</td><td>…</td><td>…</td><td /></tr>)}</tbody></table>
            </div>
          </div>
          <div className="panel pf-activity">
            <div className="panel-head"><h3>activity</h3></div>
            <table className="pf-table pf-acts"><thead><tr><th>event</th><th>details</th><th>price</th><th>from</th><th>to</th><th>slot</th><th>date</th><th>transaction</th></tr></thead><tbody>{[0, 1, 2].map((n) => <tr key={n}><td>…</td><td>…</td><td>…</td><td>…</td><td>…</td><td>…</td><td>…</td><td>…</td></tr>)}</tbody></table>
          </div>
        </div>
      </div>
    </Folio>
  );
}

export function ScribePage({ address, ask }: { address: string; ask?: string }) {
  const [s, setS] = useState<ScribeView | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [dock, setDock] = useState<DockState>('open'); // the chat is open on arrival: it is the main thing to do here
  useEffect(() => {
    let live = true;
    const load = () => getScribe(address).then((x) => { if (live) { setS(x); setError(''); } }).catch((e) => live && setError(e.message));
    load();
    const t = setInterval(load, 5000);
    return () => { live = false; clearInterval(t); };
  }, [address, tick]);

  const wait = useHold(!!s || !!error);
  // while it loads (or if it cannot), the frame still shows, with the loader or the note in its centre
  const framed = (x: JSX.Element) => <Folio className="folio-hero stage"><div className="scene scene-wait">{x}</div></Folio>;
  if (error && !s) return framed(<div className="notice bad">{error}</div>);
  if (!s || wait) return framed(<Loading />);
  if (s.hidden) return framed(<p className="pf-note">This scribe is hidden from the site. It still exists on chain.</p>);


  return (
    <Folio className="folio-hero stage">
      <div className="scene scene-profile">
        {/* a profile like a social one: the picture, the name and the bio up top, then everything else as posts */}
        {/* a profile sits under browse: the way back to every scribe */}
        <a className="pf-back" href="#/explore"><svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M8 2L4 6l4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" /></svg>back to browse</a>
        <header className="pf-head">
          {/* laid out like an X profile: a banner, the picture over its bottom edge, the actions opposite, then name, handle, bio, badges and counts */}
          <div className="pf-banner" style={{ '--c': isVerified(s) ? '#c99a33' : sealColour(s.address) } as CSSProperties}>
            <span className="pf-bits" aria-hidden="true">{bits(s.address)}</span>
          </div>
          <div className="pf-bar">
            <div className={`portrait pf-pic${isVerified(s) ? ' verified' : ''}`} style={isVerified(s) ? undefined : { '--c': sealColour(s.address) } as CSSProperties}><Portrait s={s} knight /><i className="card-rule" /></div>
          </div>
          {/* the name on the left, the key facts on the right in line with it */}
          <div className="pf-namerow">
            <h1 className="hero-title pf-name">{s.name ?? 'Inscribing'}{isVerified(s) && (
              <span className="pf-vmark" tabIndex={0} aria-label="verified">
                <VerifiedMark size={22} />
                <span className="pf-vpop" role="tooltip">{s.name} passed the bot's checks and its owner burned $SCRIBES to verify it{s.verifiedSlot ? ` at slot ${s.verifiedSlot.toLocaleString()}` : ''}. The badge stays with the scribe forever, whoever holds it.</span>
              </span>
            )}</h1>
            {/* the scribe's key facts as a chain of small data blocks */}
            <div className="stat-chain pf-chain">
              <div className="stat"><i className="c2" /><b><Born slot={s.birthSlot} /></b><span>born</span></div>
              <i className="stat-link" />
              <div className="stat"><i className="c2" /><b><a className="case" href={explorer('address', s.owner)} target="_blank" rel="noreferrer">{short(s.owner)}</a></b><span>owner</span></div>
              {s.rarity && <><i className="stat-link" /><div className="stat"><i className="c2" /><b>{s.rarity.rank}</b><span>rarity rank</span></div></>}
            </div>
          </div>
          {s.purpose && <p className="pf-bio">{s.purpose}</p>}
          <div className="pf-counts">
            {/* what it thinks with, in the open: the model it runs on, or the size of the weights it downloads */}
            <span><b>{s.brain?.kind === 'bound' ? modelName(s.brain.model).toLowerCase() : (s.model?.name ?? 'inscribed').toLowerCase()}</b> {s.brain?.kind === 'bound' ? 'model' : `model, ${((s.model?.bytes ?? 0) / 1e6).toFixed(0)} mb of weights`}</span>
            <span><b>{(s.files.length + 1).toLocaleString()}</b> files</span>
            <span><b>{[...s.files.map((f) => f.size), s.manifestSize].reduce((n, z) => n + chunkCount(z), 0).toLocaleString()}</b> transactions</span>
            <span><b>{s.journal.length.toLocaleString()}</b> memories</span>
            {s.autograph && <span><b>autograph</b></span>}
            {s.listing && <span>for sale <b>{sol(s.listing.price)} sol</b></span>}
          </div>
          {s.status.state === 'complete' && <div className="pf-actions"><button type="button" className="show-all on" onClick={() => setDock('open')}>chat</button><ListButton s={s} /></div>}
        </header>

        <div className="pf-feed">
          {/* rarity on the left, the capsule on the right; the chat lives in its own window, docked in the frame */}
          <div className={`pf-grid${s.rarity ? '' : ' one'}`}>
            {s.rarity && (
              <div className="panel">
                <div className="panel-head"><h3>rarity</h3><Info text="% is the share of all scribes with that value. birth, autograph and verified count double." /></div>
                <table className="attrs"><tbody>
                  {ATTRIBUTES.map((a) => (
                    <tr key={a} className={FROM_CHAIN.includes(a) ? 'chain' : 'files'}>
                      <td>{a}</td>
                      <td>{a === 'Model' ? (s.brain?.kind === 'bound' ? modelName(s.brain.model) : s.model?.name ?? short(s.rarity!.traits[a])) : String(s.rarity!.traits[a]).replace(/\s*[–—]\s*/g, ' to ')}</td>
                      <td>{(100 * s.rarity!.shares[a]).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
            )}
            <div>
              {s.status.state === 'inscribing' && (
                <div className="panel">
                  <div className="panel-head"><h3>being inscribed</h3><span className="muted">{s.status.done.toLocaleString()} of {s.status.total.toLocaleString()} chunks</span></div>
                  <div className="progress"><div style={{ width: `${(100 * s.status.done) / Math.max(1, s.status.total)}%` }} /></div>
                  <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>{s.name ?? 'This scribe'} is born. Its files are being written to Solana, and it can run once they are all there.</p>
                </div>
              )}
              {s.status.state === 'invalid' && <div className="notice bad" style={{ marginBottom: 18 }}>This scribe broke a rule and cannot run: {s.status.reason}</div>}
              <div className="pf-capsule">
                <MarketPanel s={s} onChange={() => setTick((n) => n + 1)} />
                {!isVerified(s) && <div className="pf-verify"><VerifyPanel s={s} onChange={() => setTick((n) => n + 1)} /></div>}
              </div>
            </div>
          </div>
          {/* the inscribed files across the full width */}
          <div className="pf-row2">
            {s.files.length > 0 && (
              <div className="panel filelist">
                <div className="panel-head"><h3>inscribed files</h3></div>
                <table className="pf-table"><thead><tr><th>file</th><th>role</th><th>size</th><th>transactions</th><th>sha256</th><th></th></tr></thead><tbody>
                  {[...s.files, { role: 'manifest', name: 'manifest.json', size: s.manifestSize, sha256: s.manifestSha, writer: s.writer }].map((f) => (
                    <tr key={f.sha256}>
                      <td className="case">{f.name}</td>
                      <td>{f.role}</td>
                      <td>{f.size < 1e6 ? `${(f.size / 1e3).toFixed(1)} kb` : `${(f.size / 1e6).toFixed(1)} mb`}</td>
                      <td>{chunkCount(f.size).toLocaleString()}</td>
                      <td className="case" title={f.sha256}>{f.sha256.slice(0, 3)}…{f.sha256.slice(-3)}</td>
                      <td><FileLink sha={f.sha256} writer={f.writer} /></td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
            )}
          </div>
          <LibraryPanel s={s} />
          <Journal s={s} />
          <History s={s} />
        </div>
      </div>
      {s.status.state === 'complete' && <Dock s={s} ask={ask} open={dock} onOpen={setDock} />}
    </Folio>
  );
}

// "list": an owner goes straight to the capsule; anyone not connected is asked to connect first (the header's menu opens)
function ListButton({ s }: { s: ScribeView }) {
  const me = useWallet();
  const go = () => {
    if (!me) { document.querySelector<HTMLButtonElement>('header.top .menu-wrap > button')?.click(); return; }
    const cap = document.querySelector<HTMLElement>('.pf-capsule');
    if (!cap) return;
    cap.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // the capsule's frame pulses a few times so it is clear this is where to fill in the price, and the price field takes the cursor
    cap.classList.remove('nudge'); void cap.offsetWidth; cap.classList.add('nudge');
    setTimeout(() => cap.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true }), 600);
    setTimeout(() => cap.classList.remove('nudge'), 2600);
  };
  return <button type="button" className="show-all" onClick={go}>{s.listing ? 'listing' : 'list'}</button>;
}

type DockState = 'open' | 'small' | 'full';
// the frame's red rule sits 3px inside the page edge: the window's own 3px rule lands exactly on top of it
const RED = 3;

// The chat window, docked in the frame's lower right corner. It opens on arrival, folds down to a small tab,
// or expands to fill the whole frame so the frame and its ornaments become its border.
function Dock({ s, ask, open, onOpen }: { s: ScribeView; ask?: string; open: DockState; onOpen: (d: DockState) => void }) {
  // the frame's inner page (inside its rules): the window starts in its bottom right corner, and full fills it
  const [box, setBox] = useState<DOMRect | null>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null); // where it was dragged to, if it was
  const win = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const measure = () => { const b = document.querySelector('.stage .hp-page'); if (b) setBox(b.getBoundingClientRect()); };
    measure(); addEventListener('resize', measure);
    return () => removeEventListener('resize', measure);
  }, []);
  // drag by the heading: the window moves anywhere inside the frame
  const drag = (e: RPointerEvent) => {
    if (open !== 'open' || !box || !win.current || (e.target as HTMLElement).closest('button, a, .info, .pf-checked')) return;
    const r = win.current.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = (m: PointerEvent) => setAt({
      x: Math.min(Math.max(m.clientX - dx, box.left + RED), box.right - RED - r.width),
      y: Math.min(Math.max(m.clientY - dy, box.top + RED), box.bottom - RED - r.height),
    });
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); document.body.classList.remove('dragging'); };
    addEventListener('pointermove', move); addEventListener('pointerup', up); document.body.classList.add('dragging');
    e.preventDefault();
  };
  if (!box) return null;
  const style: CSSProperties = open === 'full'
    ? { left: box.left + RED, top: box.top + RED, width: box.width - 2 * RED, height: box.height - 2 * RED }
    : at ? { left: at.x, top: at.y } : { right: innerWidth - box.right + RED, bottom: innerHeight - box.bottom + RED };
  const controls = (
    <>
      <button type="button" className="dock-sq" title={open === 'full' ? 'shrink' : 'expand'} aria-label={open === 'full' ? 'shrink the chat' : 'expand the chat'} onClick={() => onOpen(open === 'full' ? 'open' : 'full')}>
        {open === 'full'
          ? <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2v4H2M10 14v-4h4M6 6L1 1M10 10l5 5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" /></svg>
          : <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 2h4v4M6 14H2v-4M14 2L9 7M2 14l5-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" /></svg>}
      </button>
      <button type="button" className="dock-sq" title="minimise" aria-label="minimise the chat" onClick={() => onOpen('small')}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 12h10" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="square" /></svg>
      </button>
    </>
  );
  // folded away, the chat stays mounted (the conversation is kept) and the profile's chat button brings it back
  return (
    <div className={`pf-dock ${open}`} style={style} hidden={open === 'small'} ref={win} onPointerDown={drag}>
      <div className="pf-feed pf-dock-body"><Wake s={s} ask={ask} controls={controls} /></div>
    </div>
  );
}

// The banner's rows of 0s and 1s, seeded by the address so each scribe keeps its own.
function bits(seed: string): string {
  let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  let o = '';
  for (let i = 0; i < 1400; i++) { h = (h * 1103515245 + 12345) >>> 0; o += (h >>> 16) & 1 ? '1' : '0'; }
  return o;
}

// The day the birth slot was confirmed, as dd/mm/yyyy.
function Born({ slot }: { slot: number }) {
  const [d, setD] = useState<string | null>(null);
  useEffect(() => { birthDay(slot).then(setD); }, [slot]);
  return <>{d ? d.split('-').reverse().join('/') : `slot ${slot.toLocaleString()}`}</>;
}

// The file's tag account: every chunk transaction of the file names it.
function FileLink({ sha, writer }: { sha: string; writer: string }) {
  const [tag, setTag] = useState('');
  useEffect(() => { fileTag(sha, new PublicKey(writer)).then((t) => setTag(t.toBase58())).catch(() => {}); }, [sha, writer]);
  if (!tag) return null;
  // the same tag as on the models page: solid blue, the solscan mark and word in the page colour
  return <a className="solscan-tag" href={explorer('address', tag)} target="_blank" rel="noreferrer"><img src="/solscan-blue.png" alt="" />{CLUSTER === 'localnet' ? 'explorer' : 'solscan'}</a>;
}

function Journal({ s }: { s: ScribeView }) {
  if (!s.journal.length) return null;
  return (
    <div className="panel">
      <div className="panel-head"><h3>journal</h3></div>
      <ul className="journal">
        {[...s.journal].reverse().map((j) => (
          <li key={j.signature}><span className="text">“{j.text}”</span><a className="when" href={explorer('tx', j.signature)} target="_blank" rel="noreferrer">slot {j.slot.toLocaleString()}</a></li>
        ))}
      </ul>
      <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>Written by {s.name} and approved by whoever held it at the time. It remembers all of these.</div>
    </div>
  );
}

// Everything that happened to it on Solana, as a table like a marketplace's item activity.
function History({ s }: { s: ScribeView }) {
  const rows = useActivity(s.address, 30);
  const who = (a?: string) => a ? <a className="case" href={explorer('address', a)} target="_blank" rel="noreferrer">{short(a)}</a> : '';
  return (
    <div className="panel pf-activity">
      <div className="panel-head"><h3>activity</h3></div>
      {!rows ? <Loading /> : rows.length === 0 ? <p className="pf-note">nothing yet.</p> : (
        <table className="pf-table pf-acts"><thead><tr><th>event</th><th>details</th><th>price</th><th>from</th><th>to</th><th>slot</th><th>date</th><th>transaction</th></tr></thead><tbody>
          {rows.map((e) => {
            const r = e as Record<string, unknown>;
            const ev = e.kind === 'born' ? 'birth block' : e.kind === 'bounty_awarded' ? 'bounty won' : e.kind;
            const detail = e.kind === 'born' ? `#${(r.birthNumber as number) + 1}${r.autograph ? ', autograph' : ''}`
              : e.kind === 'verified' ? 'tokens burned' : e.kind === 'sold' && typeof r.fee === 'number' ? `fee ${sol(r.fee)} sol` : '';
            const price = typeof r.price === 'number' ? `${sol(r.price)} sol` : typeof r.reward === 'number' ? `${sol(r.reward as number)} sol` : '';
            const from = (r.from ?? r.seller) as string | undefined;
            const to = (r.to ?? (e.kind === 'born' ? r.owner : undefined)) as string | undefined;
            const when = e.time ? new Date(e.time * 1000) : null;
            return (
              <tr key={`${e.signature}-${e.kind}`}>
                <td><b>{ev}</b></td><td>{detail}</td><td>{price}</td><td>{who(from)}</td><td>{who(to)}</td>
                <td>{e.slot.toLocaleString()}</td>
                <td>{when ? `${when.toLocaleDateString('en-GB')} ${when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}</td>
                <td><a className="case" href={explorer('tx', e.signature)} target="_blank" rel="noreferrer">{e.signature.slice(0, 4)}…{e.signature.slice(-4)}</a></td>
              </tr>
            );
          })}
        </tbody></table>
      )}
    </div>
  );
}

function Wake({ s, ask, controls }: { s: ScribeView; ask?: string; controls?: ReactNode }) {
  const [steps, setSteps] = useState<{ text: string; state: string }[]>([]);
  const [brain, setBrain] = useState<Brain | null>(null);
  const [personality, setPersonality] = useState<Personality | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => { try { return localStorage.getItem(keyStore(providerOf(s))) ?? ''; } catch { return ''; } });
  const [remember, setRemember] = useState(false);
  const [hosted, setHosted] = useState<HostedStatus | null>(null);
  const [ownKey, setOwnKey] = useState(false); // use my own key instead of the free brain
  const [pending, setPending] = useState<string | undefined>(ask); // a question to ask as soon as it wakes
  useEffect(() => { if (s.brain?.kind === 'bound') hostedStatus().then(setHosted); }, [s.brain?.kind]);
  const free = !!(hostedFor(hosted, providerOf(s)) && hosted!.open && (hosted!.remaining ?? 0) > 0) && !ownKey;
  // Arriving with a question (a link from the home page): wake on the free brain straight away.
  const asked = useRef(false);
  useEffect(() => {
    const ready = s.brain?.kind === 'inscribed' || free; // an inscribed brain runs here: no allowance needed
    if (!ask || asked.current || !ready || brain || busy) return;
    asked.current = true;
    void wake();
  }, [ask, free]); // eslint-disable-line react-hooks/exhaustive-deps

  const step: Step = (text, state) => setSteps((l) => {
    const last = l[l.length - 1];
    if (last && last.state === 'run') return [...l.slice(0, -1), { text, state }];
    return [...l, { text, state }];
  });

  // The hashes come straight from chain: the birth record names the manifest, the manifest names every
  // file. The bytes come from the indexer's copy when it matches (fast), or are rebuilt from chain.
  async function readSoul(): Promise<Manifest> {
    step('Birth record reading', 'run');
    const r = await fetchScribe(scribesProgram(conn), s.address);
    if (!r) throw new Error('this scribe has no birth record on Solana');
    step(`Birth record #${r.birthNumber}`, 'ok');
    await hold();
    const checked = async (ref: { sha256: string; size: number; writer: string }, what: string) => {
      step(`${what} checking`, 'run');
      try {
        const res = await fetch(fileUrl(ref.sha256));
        const b = new Uint8Array(await res.arrayBuffer());
        if (res.ok && b.length === ref.size && (await sha256Hex(b)) === ref.sha256) {
          step(`${what} hash matches`, 'ok');
          await hold();
          return b;
        }
      } catch { /* rebuild it from chain instead */ }
      step(`${what} rebuilding`, 'run');
      const b = await readFile(conn, ref);
      step(`${what} rebuilt`, 'ok');
      await hold();
      return b;
    };
    const m = decodeManifest(await checked({ sha256: r.manifestSha, size: r.manifestSize, writer: r.writer }, 'manifest'));
    const p = parsePersonality(decodeUtf8(await checked(m.files.find((f) => f.role === 'personality')!, 'personality')));
    setManifest(m);
    setPersonality(p);
    return m;
  }

  async function wake(q?: string) {
    if (q) setPending(q);
    setBusy(true);
    setSteps([]);
    try {
      const m = manifest ?? await readSoul();
      if (m.brain.kind === 'inscribed') {
        setBrain(await loadInscribed(m, step));
      } else {
        if (free) {
          setBrain(loadHosted(s.address, m.brain.model, m.brain.provider));
          step('Running free', 'ok');
        } else {
          if (!key.trim()) throw new Error(`Enter your ${keyLabel(s).replace('api key', 'API key')} to chat with this scribe.`);
          try { if (remember) localStorage.setItem(keyStore(m.brain.provider), key.trim()); } catch { /* storage unavailable */ }
          setBrain(loadBound(m.brain.provider, m.brain.model, key.trim()));
          step('Running on your key', 'ok');
        }
      }
    } catch (e) {
      step(describeError(e), 'bad');
    } finally {
      setBusy(false);
    }
  }

  const bound = s.brain?.kind === 'bound';
  const [chatKey, setChatKey] = useState(0); // a new key starts a fresh conversation
  return (
    <div className={`panel wake-panel${isVerified(s) ? ' pv' : ''}`} id="chat" style={{ '--pc': isVerified(s) ? '#c99a33' : sealColour(s.address) } as CSSProperties}>
      {/* what it runs on and how many free messages are left sit in the info mark, not as small print */}
      <div className="panel-head"><span className="dm-pic head"><Portrait s={s} knight /></span><h3>chat with {s.name}</h3>
        <button type="button" className="dock-sq" title="restart" aria-label="restart the conversation" disabled={!brain} onClick={() => { try { localStorage.removeItem(`scribes.chat.${s.address}`); } catch { /* storage unavailable */ } setChatKey((k) => k + 1); }}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" /></svg>
        </button>{controls}</div>
      {!brain && (
        <>
          {bound && hostedFor(hosted, providerOf(s)) && !free && !ownKey && (
            <div className="notice info" style={{ marginBottom: 12 }}>{hosted!.open ? "You've used today's free messages." : 'The free brain is resting until tomorrow.'} You can keep going with your own key.</div>
          )}
          {bound && !free && (
            <div className="row" style={{ marginBottom: 12 }}>
              <input className="grow key-field" type="password" placeholder={keyLabel(s)} value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
              <label className={`key-remember${remember ? ' on' : ''}`}><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /><i aria-hidden="true" />remember on this device</label>
            </div>
          )}
          <div className="row">
            <button className="primary" disabled={busy} onClick={() => wake()}>{busy ? 'loading...' : `chat${bound && free ? ' free' : ''}`}</button>
            {bound && hostedFor(hosted, providerOf(s)) && <button className="link" onClick={() => setOwnKey(!ownKey)}>{ownKey ? 'Use the free brain' : 'Use my own key instead'}</button>}
          </div>
          {(!bound || free || key.trim()) && (
            <div className="try">
              <span className="muted">or ask:</span>
              {questions(s).map((t) => <button key={t} className="ask" disabled={busy} onClick={() => wake(t)}>{t}</button>)}
            </div>
          )}
        </>
      )}
      {steps.length > 0 && !brain && <ul className="trail">{steps.map((x, i) => <li key={i} className={x.state}><Check text={x.text} /></li>)}</ul>}
      {brain && personality && <Chat key={chatKey} brain={brain} personality={personality} s={s} first={pending} checks={steps} />}
    </div>
  );
}

// A check line like the inscribe form's list: what was checked in red, then a comma and the rest in ink.
function Check({ text }: { text: string }) {
  const m = text.match(/^(birth record|manifest|personality|model weights|model|runtime|reading|checking|rebuilding|running)\b\s*(.*)$/i);
  if (!m) return <span className="tr-a">{text.toLowerCase()}</span>;
  return <><span className="tr-a">{m[1].toLowerCase()}</span>{m[2] && <span className="tr-b">, {m[2].replace(/^,\s*/, '').toLowerCase()}</span>}</>;
}

function ProposalCard({ p, name, update }: { p: Proposal & { state: string; sig?: string; error?: string }; name: string; update: (x: Partial<{ state: 'open' | 'sent' | 'declined'; sig: string; error: string }>) => void }) {
  const me = useWallet();
  const [busy, setBusy] = useState(false);
  const blocked = !!(me && p.ownerOnly && me !== p.ownerOnly);
  async function approve() {
    if (!me) return;
    setBusy(true);
    update({ error: '' });
    try {
      const built = await p.build(new PublicKey(me));
      const sig = 'ixs' in built ? await sendInstructions(built.ixs) : await built.execute(await signVersioned(built.versioned));
      update({ state: 'sent', sig });
    } catch (e) {
      update({ error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`proposal ${p.kind}`}>
      <div className="k">{name} proposes, {p.title}</div>
      <dl>{p.lines.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      {p.note && <div className="note">{p.note}</div>}
      {p.state === 'open' && (
        <div className="row" style={{ marginTop: 10 }}>
          {!me ? <WalletButton /> : blocked
            ? <span className="muted" style={{ fontSize: 13 }}>Only the owner (<code>{short(p.ownerOnly!)}</code>) can approve this.</span>
            : <button className="primary small" disabled={busy} onClick={approve}>{busy ? 'Approve in your wallet…' : 'Approve in my wallet'}</button>}
          <button className="small" onClick={() => update({ state: 'declined' })}>Decline</button>
        </div>
      )}
      {p.state === 'sent' && <div className="notice info" style={{ marginTop: 10 }}>{p.done ?? 'Done.'} <a href={explorer('tx', p.sig!)} target="_blank" rel="noreferrer">View transaction</a></div>}
      {p.state === 'declined' && <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>Declined, nothing happened.</div>}
      {p.error && <div className="notice bad" style={{ marginTop: 10 }}>{p.error}</div>}
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Scribes can only propose. Nothing happens unless you approve it in your own wallet.</div>
    </div>
  );
}

// First messages to offer, from the scribe's tools (the first few that apply).
const STARTERS: [tool: string, text: string][] = [
  ['trending_tokens', "What's trending on Solana right now?"],
  ['token_report', 'Is BONK safe? Give me a quick report.'],
  ['new_launches', 'Any new launches worth a look?'],
  ['swap_quote', 'How much USDC would 1 SOL get me?'],
  ['wallet_activity', 'What can you tell me about a wallet if I give you its address?'],
  ['network_status', 'How busy is Solana right now?'],
  ['bounty_board', 'Any open bounties you could answer?'],
  ['scribe_market', "What's for sale on the scribe market?"],
  ['web_search', "What's the latest Solana news?"],
];
function starters(tools: string[]): string[] {
  const picked = STARTERS.filter(([t]) => tools.includes(t)).map(([, text]) => text).slice(0, 3);
  return [...picked, 'What can you do?'];
}

function Chat({ brain: given, personality, s, first, checks }: { brain: Brain; personality: Personality; s: ScribeView; first?: string; checks: { text: string; state: string }[] }) {
  // When the free brain's limit is reached, the visitor can carry on with their own key in the same conversation.
  const [own, setOwn] = useState<Brain | null>(null);
  const [limited, setLimited] = useState(false);
  const [key, setKey] = useState(() => { try { return localStorage.getItem(keyStore(providerOf(s))) ?? ''; } catch { return ''; } });
  const brain = own ?? given;
  // The conversation is kept in this browser, per scribe, so a refresh does not lose it.
  const store = `scribes.chat.${s.address}`;
  const [history, setHistory] = useState<Turn[]>(() => {
    try { return JSON.parse(localStorage.getItem(store) ?? '[]'); } catch { return []; }
  });
  useEffect(() => {
    try { if (history.length) localStorage.setItem(store, JSON.stringify(history.slice(-40))); else localStorage.removeItem(store); } catch { /* storage unavailable */ }
  }, [history, store]);
  const [pending, setPending] = useState<string | null>(null);
  const [working, setWorking] = useState<string[]>([]); // tools used for the reply in progress
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [proposals, setProposals] = useState<(Proposal & { state: 'open' | 'sent' | 'declined'; sig?: string; error?: string; at: number })[]>([]);
  const tools = brain.usesTools ? enabledTools(personality.tools) : brain.pageTools ? enabledTools(personality.tools).filter((t) => PAGE_TOOLS.includes(t)) : [];
  const logRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // follows the newest message once there is one; before that the checks and the starters show from the top
  useEffect(() => { if (history.length || pending !== null) logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [history, pending]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const [left, setLeft] = useState<number | null>(null); // free messages left today
  useEffect(() => { if (brain.hosted) hostedStatus().then((h) => setLeft(h.remaining ?? null)); }, [brain, history.length]);

  // A question carried in the link is sent once, then dropped from the address (a refresh does not re-ask).
  const sentFirst = useRef(false);
  useEffect(() => {
    if (!first || sentFirst.current) return;
    sentFirst.current = true;
    window.history.replaceState(null, '', `#/scribe/${s.address}`);
    void send(first);
  }, [first]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send(said?: string) {
    const text = (said ?? input).trim();
    if (!text || pending !== null) return;
    setInput('');
    setError('');
    const next: Turn[] = [...history, { role: 'user', content: text }];
    setHistory(next);
    setPending('');
    setWorking([]);
    abortRef.current = new AbortController();
    try {
      const at = next.length;
      const reply = await brain.reply(systemPrompt(personality, s.journal.map((j) => j.text)), next, (t) => setPending(t), abortRef.current.signal, {
        tools, scribe: { address: s.address, owner: s.owner, name: s.name ?? 'Scribe' }, propose: (p) => setProposals((l) => [...l, { ...p, state: 'open', at }]),
        onTool: (name) => setWorking((w) => [...w, TOOL_CATALOG.find((t) => t.name === name)?.label ?? name.replace(/_/g, ' ')]),
      });
      setHistory([...next, { role: 'assistant', content: reply }]);
    } catch (e) {
      setHistory(history); // the failed turn is not kept
      setInput(text);
      if (e instanceof HostedError && e.limited) setLimited(true);
      setError(describeError(e));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="chat">
      <div className="label">{brain.label}{brain.hosted && left !== null ? `, ${left} free message${left === 1 ? '' : 's'} left today` : ''}</div>
      <div className="log" ref={logRef}>
        {/* what was checked before it could run, kept at the top of the conversation */}
        {checks.length > 0 && <ul className="trail chat-checks">{checks.map((x, i) => <li key={i} className={x.state}><Check text={x.text} /></li>)}</ul>}
        {history.length === 0 && pending === null && (
          <div>
            <div className="muted" style={{ marginBottom: 8 }}>say hello to {personality.name.toLowerCase()}, or try one of these:</div>
            <div className="try">{starters(tools).map((t) => <button key={t} type="button" className="ask" onClick={() => send(t)}>{t}</button>)}</div>
          </div>
        )}
        {history.map((t, i) => (
          <div key={i} style={{ display: 'contents' }}>
            <div className={`bubble ${t.role === 'user' ? 'you' : 'them'}${t.role !== 'user' && isVerified(s) ? ' gold' : ''}`}>
              {t.role === 'assistant' ? <><span className="who"><span className="dm-pic"><Portrait s={s} knight /></span>{personality.name.toLowerCase()}{isVerified(s) && <VerifiedMark size={13} />}</span><Rich text={t.content} /></> : t.content}
            </div>
            {proposals.filter((p) => p.at === i + 1 && t.role === 'user').map((p) => (
              <ProposalCard key={p.id} p={p} name={personality.name} update={(x) => setProposals((l) => l.map((y) => (y.id === p.id ? { ...y, ...x } : y)))} />
            ))}
          </div>
        ))}
        {pending !== null && (
          <div className={`bubble them${isVerified(s) ? ' gold' : ''}`}>
            <span className="who"><span className="dm-pic"><Portrait s={s} knight /></span>{personality.name.toLowerCase()}{isVerified(s) && <VerifiedMark size={13} />}</span>
            {working.length > 0 && <span className="working">{working.map((w, i) => <span key={i}>⚙ {w}</span>)}</span>}
            {pending ? <Rich text={pending} /> : (working.length ? '' : '…')}
          </div>
        )}
      </div>
      {error && <div className="notice bad" style={{ marginBottom: 10 }}>{error}</div>}
      {limited && !own && s.brain?.kind === 'bound' && (
        <div className="row" style={{ marginBottom: 10 }}>
          <input className="grow" type="password" placeholder={keyLabel(s)} value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
          <button disabled={!key.trim()} onClick={() => { if (s.brain?.kind === 'bound') { setOwn(loadBound(s.brain.provider, s.brain.model, key.trim())); setError(''); } }}>continue with my key</button>
        </div>
      )}
      <div className="composer">
        <input value={input} placeholder={`message ${personality.name}`.toLowerCase()} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
        <button className="primary" onClick={() => send()} disabled={pending !== null || !input.trim()}>send</button>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { fileUrl, getScribes, type ScribeView } from '../api.ts';
import { Sigil, sealColour, birthDay } from '../Sigil.tsx';
import { Figure, Framed, VerifiedMark } from '../Figure.tsx';
import { Folio, HeroScene } from '../Hero.tsx';
import { BirthRecord } from '../BirthRecord.tsx';
import { HowItWorks } from '../HowItWorks.tsx';
import { useActivity } from './Activity.tsx';
import { API, CLUSTER, explorer, modelName, short, sol } from '../config.ts';
import { chunkCount } from '../../../lib/src/chunk.ts';
import type { ModelInfo } from './Models.tsx';
import { Loading, useHold } from '../Loading.tsx';
import { RarityCube } from '../RarityCube.tsx';

// the Coroner gives tokens a cause of death, so on the home page it is the grim reaper
// (a devnet scribe: mainnet has none of them)
const CORONER = CLUSTER === 'devnet' ? '4utJNkNtrFDKuXS9tq6Rqmwbk8L8LKRLhpPKCZ69PJu8' : '';
// Scribes to show as verified for a design preview. Empty: only scribes verified on chain get the gold look.
const SHOW_VERIFIED: string[] = [];
export const isVerified = (s: ScribeView) => s.verified || SHOW_VERIFIED.includes(s.address);

// knight: the home page shows every scribe as its own dotted knight, in place of its seal or its picture
export function Portrait({ s, knight }: { s: ScribeView; knight?: boolean }) {
  if (knight) return <Figure seed={s.address} n={s.birthNumber} kind={s.address === CORONER ? 'reaper' : undefined} bare />;
  const pic = s.files.find((f) => f.role === 'picture');
  if (pic && s.status.state === 'complete') return <Framed seed={s.address}><img src={fileUrl(pic.sha256)} alt={s.name ?? ''} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /></Framed>;
  return <Sigil seed={s.address} letter={(s.name ?? '?').slice(0, 1)} birthNumber={s.birthNumber} birthSlot={s.birthSlot} />;
}

// the name of the model a scribe thinks with, for the browse filter
export function modelOf(s: ScribeView): string {
  if (s.brain?.kind === 'bound') return modelName(s.brain.model).toLowerCase();
  return (s.model?.name ?? 'other inscribed model').toLowerCase();
}

export function brainLine(s: ScribeView): string {
  if (s.brain?.kind === 'bound') return `Thinks with ${modelName(s.brain.model)}`;
  if (s.model) return `${s.model.name ?? 'Inscribed model'} · ${(s.model.parameters / 1e6).toFixed(s.model.parameters < 1e7 ? 1 : 0)}M`;
  return s.brain ? 'Inscribed brain' : 'Loading';
}

export function Badges({ s }: { s: ScribeView }) {
  return (
    <div className="badges">
      {s.rarity && <span className="chip">Rank {s.rarity.rank}</span>}
      {s.autograph && <span className="chip gold">✦ Autograph</span>}
      {s.verified && <span className="chip teal">✓ Verified</span>}
      {s.brain?.kind === 'inscribed' && s.status.state === 'complete' && <span className="chip teal">Fully on-chain</span>}
      {s.status.state === 'inscribing' && <span className="chip tan">Inscribing {Math.floor((100 * s.status.done) / Math.max(1, s.status.total))}%</span>}
    </div>
  );
}

export function Capsule({ n }: { n: number }) {
  return <span className="capsule"><span>#</span><span>{n.toLocaleString()}</span></span>;
}

const onChain = (s: ScribeView) => s.brain?.kind === 'inscribed';

export function ScribeCard({ s, knight, market }: { s: ScribeView; knight?: boolean; market?: boolean }) {
  return (
    <a className={`card${isVerified(s) ? ' verified' : ''}`} href={`#/scribe/${s.address}`} style={isVerified(s) ? undefined : { '--c': sealColour(s.address) } as CSSProperties}>
      <i className="card-rule" />
      <div className="art">
        <Portrait s={s} knight={knight} />
        <span className="corner"><Capsule n={s.birthNumber + 1} /></span>
        {s.brain && <span className={`kind ${onChain(s) ? 'chain' : 'claude'}`}>{onChain(s) ? 'On-chain brain' : 'Claude'}</span>}
        {s.listing && <span className="tag-price">{sol(s.listing.price)} SOL</span>}
      </div>
      <div className="body">
        <div className="name">{s.name ?? 'Inscribing…'}{isVerified(s) && <VerifiedMark />}</div>
        {s.purpose && <div className="purpose-line">{s.purpose}</div>}
        <div className="sub">{brainLine(s)}</div>
        <Badges s={s} />
        {/* on browse every card reads like a market listing: its price, and a buy button on hover */}
      </div>
      {/* under each browse card, a bar the card's width: blue with the price when listed, ink when not */}
      {market && <span className={`mk-bar${s.listing ? ' on' : ''}`}>{s.listing ? `listed, ${sol(s.listing.price)} sol` : 'not listed'}</span>}
    </a>
  );
}

// the activity view's event types, and their names in the list ("birth block" is her word for a birth)
const EVENTS: [string, string][] = [['born', 'birth block'], ['verified', 'verified'], ['listed', 'listed'], ['unlisted', 'unlisted'], ['sold', 'sold'], ['given', 'given']];

// Every event across every scribe, newest first, as one long table: the scribe with its picture, price, from, to, when.
function ActivityTable({ rows, list, kinds, q }: { rows: ReturnType<typeof useActivity>; list: ScribeView[]; kinds: string[]; q: string }) {
  // waits for the scribes too, so every row has its picture
  if (!rows || list.length === 0) return <div><Loading /></div>;
  const by = new Map(list.map((x) => [x.address, x]));
  // a wallet, short, linking to it
  const who = (a?: unknown) => typeof a === 'string'
    ? <a className="act-who case" href={explorer('address', a)} target="_blank" rel="noreferrer">{short(a)}</a> : '';
  const ago = (t: number | null) => { if (!t) return ''; const d = Date.now() / 1000 - t; return d < 3600 ? `${Math.max(1, Math.floor(d / 60))}m ago` : d < 86400 ? `${Math.floor(d / 3600)}h ago` : `${Math.floor(d / 86400)}d ago`; };
  const shown = (rows ?? []).filter((e) => kinds.includes(e.kind) && (!q || (by.get(e.scribe)?.name ?? '').toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="act-list">
      <table className="pf-table act-table"><thead><tr><th>scribe</th><th>price</th><th>event</th><th>from</th><th>to</th><th className="r">time</th></tr></thead><tbody>
        {shown.map((e) => {
          const r = e as Record<string, unknown>, sc = by.get(e.scribe);
          // the event's own price when it has one (a listing or a sale), otherwise whether the scribe is for sale now
          const price = typeof r.price === 'number' ? `${sol(r.price)} sol` : sc?.listing ? `for sale, ${sol(sc.listing.price)} sol` : 'not listed';
          return (
            <tr key={`${e.signature}-${e.kind}`}>
              <td><a className="act-item" href={`#/scribe/${e.scribe}`}>{sc && <span className="act-pic" style={isVerified(sc) ? undefined : { '--c': sealColour(sc.address) } as CSSProperties}><Portrait s={sc} knight /></span>}{(sc?.name ?? short(e.scribe)).toLowerCase()}{sc && isVerified(sc) && <VerifiedMark size={12} />}</a></td>
              <td className={typeof r.price === 'number' ? 'act-price' : 'act-state'}>{price}</td>
              <td><span className="act-ev">{EVENTS.find(([k]) => k === e.kind)?.[1] ?? e.kind}</span></td>
              <td>{who(r.from ?? r.seller)}</td><td>{who(r.to ?? (e.kind === 'born' ? r.owner : undefined))}</td>
              <td className="r"><a href={explorer('tx', e.signature)} target="_blank" rel="noreferrer">{ago(e.time) || `slot ${e.slot.toLocaleString()}`} <span aria-hidden="true">↗</span></a></td>
            </tr>
          );
        })}
      </tbody></table>
      {shown.length === 0 && <p className="pf-note">nothing yet.</p>}
    </div>
  );
}

// First questions to put to a scribe (one click wakes it and asks).
export function questions(s: ScribeView): string[] {
  if (onChain(s)) return /stor/i.test(s.purpose ?? '') ? ['Tell me a short story about a fox.', 'Who are you?'] : ['Who are you?', 'What do you know about Solana?'];
  return /trad|token|market/i.test(s.purpose ?? '') ? ["What's trending on Solana right now?", 'Is BONK safe? Quick report.'] : ['What can you do?', "What's new on Solana today?"];
}

// Home: the hero, the data blocks, the four trending scribes and the questions. Explore: every scribe, with
// search and sort. Both live inside the same still frame.
export function Gallery({ mode = 'home' }: { mode?: 'home' | 'explore' }) {
  const [list, setList] = useState<ScribeView[] | null>(null);
  const [error, setError] = useState('');
  const wait = useHold(!!list || !!error);
  const [acts, setActs] = useState(false);
  const [kinds, setKinds] = useState<string[]>(EVENTS.map(([k]) => k));
  const allActs = useActivity(undefined, 500);
  const [sort, setSort] = useState<'new' | 'birth' | 'rank' | 'sale'>('new');
  const [q, setQ] = useState('');
  const [ver, setVer] = useState<string[]>(['yes', 'no']);
  // models switched off in the filter; every model is on until it is unticked
  const [offModels, setOffModels] = useState<string[]>([]);
  // the day each scribe was born (yyyy-mm-dd, utc), read from its birth slot, for the birth record search
  const [bornOn, setBornOn] = useState<[string, string] | null>(null);
  const [born, setBorn] = useState<Record<string, string>>({});
  const [models, setModels] = useState<ModelInfo[]>([]);
  useEffect(() => {
    let live = true;
    const load = () => getScribes().then((l) => { if (live) { setList(l); setError(''); } }).catch((e) => live && setError(e.message));
    load();
    const t = setInterval(load, 5000);
    fetch(`${API}/models`).then((r) => r.json()).then((m) => live && setModels(m)).catch(() => {});
    return () => { live = false; clearInterval(t); };
  }, []);
  const visible = useMemo(() => (list ?? []).filter((s) => !s.hidden && s.status.state !== 'invalid'), [list]);
  const order = (visible: ScribeView[]) => {
    if (sort === 'sale') return visible.filter((s) => s.listing).sort((a, b) => a.listing!.price - b.listing!.price);
    if (sort === 'rank') return [...visible].sort((a, b) => (a.rarity?.rank ?? 1e9) - (b.rarity?.rank ?? 1e9));
    if (sort === 'new') return [...visible].reverse();
    return visible;
  };
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const found = (needle ? visible.filter((s) => [s.name, s.purpose, s.model?.name, s.brain?.kind === 'bound' ? `${s.brain.model} ${modelName(s.brain.model)}` : '', String(s.birthNumber + 1)]
      .some((x) => x?.toLowerCase().includes(needle))) : visible)
      .filter((s) => ver.includes(isVerified(s) ? 'yes' : 'no'))
      .filter((s) => !offModels.includes(modelOf(s)))
      .filter((s) => !bornOn || (!!born[s.address] && born[s.address] >= bornOn[0] && born[s.address] <= bornOn[1]));
    // verified scribes always lead, in the chosen order among themselves
    const ordered = order(found);
    return [...ordered.filter(isVerified), ...ordered.filter((s) => !isVerified(s))];
  }, [visible, sort, q, ver, offModels, bornOn, born]);
  useEffect(() => {
    if (mode !== 'explore') return;
    for (const s of visible) if (!born[s.address]) birthDay(s.birthSlot).then((d) => d && setBorn((b) => ({ ...b, [s.address]: d })));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, mode]);
  // anything narrowing the list; show all is on when nothing is
  const filtered = !!q.trim() || sort !== 'new' || ver.length < 2 || offModels.length > 0 || !!bornOn;
  const modelNames = useMemo(() => [...new Set(visible.map(modelOf))].sort(), [visible]);
  const stats = useMemo(() => {
    const forSale = visible.filter((s) => s.listing);
    return {
      born: visible.length,
      verified: visible.filter((s) => s.verified).length,
      onchain: visible.filter(onChain).length,
      forSale: forSale.length,
      floor: forSale.length ? Math.min(...forSale.map((s) => s.listing!.price)) : null,
    };
  }, [visible]);
  // trending: the scribes with the most recent on-chain activity (births, verifications, listings, sales,
  // gifts), newest first; any without activity in the feed follow, newest born first
  const activity = useActivity(undefined, 60);
  const trending = useMemo(() => {
    const seen: string[] = [];
    for (const a of activity ?? []) if (!seen.includes(a.scribe)) seen.push(a.scribe);
    const at = (s: ScribeView) => { const i = seen.indexOf(s.address); return i < 0 ? 1e6 - s.birthNumber : i; };
    return visible.filter((s) => s.status.state === 'complete').sort((a, b) => at(a) - at(b)).slice(0, 5);
  }, [visible, activity]);
  const bytes = models.reduce((n, m) => n + m.size, 0);
  const txs = models.reduce((n, m) => n + chunkCount(m.size), 0);

  // the data view has the same space above and below its blocks (the room left under the centred hero, at
  // any window height), so it lands evenly whether you scroll or click the arrow; the scribes view brings
  // 40px of its own
  const statsView = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const even = () => {
      const view = statsView.current, hero = view?.previousElementSibling as HTMLElement | null;
      const split = hero?.querySelector('.hero-split') as HTMLElement | null;
      if (!view || !hero || !split) return;
      const above = (hero.clientHeight - split.offsetHeight) / 2;
      view.style.paddingTop = `${above}px`;
      view.style.paddingBottom = `${Math.max(0, above - 40)}px`;
    };
    even(); addEventListener('resize', even);
    return () => removeEventListener('resize', even);
  }, [list]);

  // each view plays its entrance once, when most of it has scrolled into the frame: the bytes slide out from
  // under the birth record, the trending scribes rise one by one, the questions unfold from a stack
  useEffect(() => {
    const body = document.querySelector('.stage .folio-body');
    if (!body) return;
    const seen = new IntersectionObserver((views) => views.forEach((v) => { if (v.isIntersecting) { v.target.classList.add('in'); seen.unobserve(v.target); } }), { root: body, threshold: .35 });
    body.querySelectorAll('.scene-birth, .scene-trending, .scene-faq').forEach((el) => seen.observe(el));
    return () => seen.disconnect();
  }, [list]);

  // the arrow under the hero is only a hint: it fades away as soon as the views scroll, and back at the top
  useEffect(() => {
    const el = document.querySelector('.stage .scroll-cue'), body = el?.closest('.folio-body');
    if (!el || !body) return;
    const on = () => el.classList.toggle('gone', body.scrollTop > 8);
    on(); body.addEventListener('scroll', on, { passive: true });
    return () => body.removeEventListener('scroll', on);
  }, []);

  // the data points as a chain of blocks under the hero, ruled like the blocks on the screen
  const statChain = (
      <div className="stat-chain">
        <div className="stat"><i className="c2" /><b><Tally to={list ? stats.born : 0} /></b><span>scribes born</span></div>
        <i className="stat-link" />
        <div className="stat"><i className="c2" /><b><Tally to={Math.round(bytes / 1e6)} /><small>mb</small></b><span>of model weights</span></div>
        <i className="stat-link" />
        <div className="stat"><i className="c2" /><b><Tally to={txs >= 1000 ? Math.round(txs / 1000) : txs} />{txs >= 1000 && <small>k</small>}</b><span>chunk transactions</span></div>
        <i className="stat-link" />
        <div className="stat"><i className="c2" /><b><Tally to={list ? stats.onchain : 0} /></b><span>fully on-chain</span></div>
      </div>
  );

  return (
    <>
      {/* one frame that holds still; only the views inside it change as you scroll */}
      {mode === 'explore' ? (
      <Folio className="folio-hero stage">
        <div className="scene scene-explore-head"><h1 className="hero-title">browse scribes</h1></div>
        <div className="scene scene-scribes scene-explore">
          {/* the search runs the whole column; under it the filters sit in a column on the left, the scribes on the right */}
          <div className="browse-top">
          <label className="browse-bar"><i className="c2" />
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="2.4" /><path d="M13 13l5 5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" /></svg>
            <input type="search" placeholder="search by name, model or birth record" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
            <button type="button" className={`show-all${filtered ? '' : ' on'}`} aria-pressed={!filtered} onClick={() => { setQ(''); setSort('new'); setVer(['yes', 'no']); setOffModels([]); setBornOn(null); }}>{!filtered && <i className="corner-tick" aria-hidden="true" />}show all</button>
            {/* activity: every event across all scribes as one long list, like a marketplace's activity tab */}
            <button type="button" className={`show-all act-btn${acts ? ' on' : ''}`} aria-pressed={acts} onClick={() => setActs(!acts)}>{acts && <i className="corner-tick" aria-hidden="true" />}activity</button>
          </div>
          <div className="browse-main">
            {acts ? (
              <aside className="browse-filters">
                <div className="act-filters"><Group title="status" value={kinds} onChange={setKinds} options={EVENTS.map(([k, l]) => [k, l])} /></div>
              </aside>
            ) : (
            <aside className="browse-filters">
              <Group title="sort by" kind="one" value={[sort]} onChange={(v) => setSort(v[0] as typeof sort)} options={[['new', 'newest'], ['birth', 'first born'], ['rank', 'rarest'], ['sale', 'for sale']]} />
              <Group title="status" value={ver} onChange={setVer} options={[['yes', 'verified'], ['no', 'unverified']]} />
              <fieldset className="filter-group">
                <legend>birth record</legend>
                <Calendar value={bornOn} onChange={setBornOn} marked={Object.values(born)} />
              </fieldset>
              {/* the models come with the scribes, so they appear with the cards rather than after them */}
              {!wait && <Group title="model" all value={modelNames.filter((m) => !offModels.includes(m))} onChange={(on) => setOffModels(modelNames.filter((m) => !on.includes(m)))} options={modelNames.map((m) => [m, m])} />}
            </aside>
            )}
            {acts ? <ActivityTable rows={allActs} list={list ?? []} kinds={kinds} q={q} /> : (
            <div>
          {error && <div className="notice bad" style={{ marginBottom: 16 }}>Could not reach the indexer: {error}</div>}
          {wait && !error && <Loading />}
          {!wait && list && shown.length === 0 && <div className="empty">{q ? `No scribe matches “${q}”.` : sort === 'sale' ? 'Nothing is for sale right now.' : <>No scribes yet. <a href="#/create">Inscribe the first one.</a></>}</div>}
          <div className="grid">{!wait && shown.map((s) => <ScribeCard key={s.address} s={s} knight market />)}</div>
            </div>
            )}
          </div>
        </div>
      </Folio>
      ) : (
      <Folio className="folio-hero stage">
        <div className="scene scene-hero">
          <HeroScene />
        </div>

        <div className="scene scene-stats" ref={statsView}>{statChain}</div>

        <div className="scene scene-birth">
          <div className="birth">
            <h2>the birth block</h2>
            <p>An agent's birth record is inscribed in one Solana transaction. The record holds its birth number, the slot it was written in, the wallet that wrote it, the wallet that owns it, and the SHA-256 hash of its manifest, the file that lists every part of the scribe with its own hash. The files themselves are cut into 960-byte chunks, one chunk per transaction, and anyone can rebuild them from chain and check each one against those hashes before it runs. The program has no instruction to close a record, so a birth can never be edited or deleted. The first scribe born on a model holds that model's Autograph.</p>
            <BirthRecord />
          </div>
        </div>

        <div className="scene scene-scribes scene-trending">
          <div className="toolbar"><h2>trending scribes</h2><a className="more" href="#/explore" aria-label="Explore all scribes" title="explore all scribes"><i className="more-key" aria-hidden="true"><svg viewBox="0 0 12 12" width="12" height="12"><path d="M3 9l6-6M4 3h5v5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" /></svg></i></a></div>
          <p className="trend-lede">The five scribes with the most recent activity on chain.</p>
          {error && <div className="notice bad" style={{ marginBottom: 16 }}>Could not reach the indexer: {error}</div>}
          <div className="grid">{trending.map((s) => <ScribeCard key={s.address} s={s} knight />)}</div>
        </div>

        <div className="scene scene-rarity">
          <RarityCube />
          <div className="rarity-words">
            <h2>no one sets the rarity</h2>
            <p>Every scribe is scored on nine attributes that are inscribed: its model, what it runs on, its weights, its personality, its tools, its memory, its birth number, its Autograph and whether it is verified. These are the parts that make an agent what it is, and nothing is set by hand. Each score is a share of every scribe in circulation, so rarity shifts each time a new one is born, and the rarest stand out when they are listed and traded.</p>
          </div>
        </div>

        <div className="scene scene-how">
          <HowItWorks />
        </div>

        <div className="scene scene-verified">
          <div className="vs-table">
            <h2><span className="gold-text">verification</span> <VerifiedMark size={26} /></h2>
            <p>Verifying burns a set amount of $SCRIBES from the owner's wallet. Burned tokens are gone permanently, so every verified scribe is a deflationary burn written into the program itself.</p>
            <table>
              <thead><tr><th /><th>unverified</th><th><span className="gold-text">verified</span></th></tr></thead>
              <tbody>
                <tr><td>files</td><td>hashed on upload</td><td><span className="gold-cut">matched to its manifest, on the official runtime</span></td></tr>
                <tr><td>tested</td><td>not yet</td><td><span className="gold-cut">answered the verification bot's test question</span></td></tr>
                <tr><td>on its card</td><td>its usual frame</td><td><span className="gold-cut">a gold foil frame and the verified checkmark</span></td></tr>
                <tr><td>rarity</td><td>the common value</td><td><span className="gold-cut">the rare value, and it counts double</span></td></tr>
                <tr><td>$SCRIBES</td><td>none burned</td><td><span className="gold-cut">a set amount burned permanently</span></td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="scene scene-faq">
          <Faq />
        </div>
      </Folio>
      )}
    </>
  );
}

// a number that counts up like a tally the first time its view is on screen, and follows the live value after
function Tally({ to }: { to: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(0);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current!, body = el.closest('.folio-body');
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { root: body, threshold: .6 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!seen || !to) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(to); return; }
    let raf = 0;
    const from = shown, t0 = performance.now(), ms = 1100;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms), ease = 1 - (1 - k) ** 3;
      setShown(Math.round(from + (to - from) * ease));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen, to]);
  return <span className="tally" ref={ref}>{shown}</span>;
}

// a calendar in the site's style for the birth record search: a framed month of square days, the days a
// scribe was born marked with a red dot. Click one day, then another to make it a range; the chosen days are
// solid blue and the days between them outlined
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const dmy = (d: string) => d.split('-').reverse().join('/');
const dmyShort = (d: string) => { const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y.slice(2)}`; };
function Calendar({ value, onChange, marked }: { value: [string, string] | null; onChange: (v: [string, string] | null) => void; marked: string[] }) {
  const [open, setOpen] = useState(false);
  const [first, setFirst] = useState<string | null>(null);
  const start = value?.[0] || marked.slice().sort().pop() || new Date().toISOString().slice(0, 10);
  const [month, setMonth] = useState(() => start.slice(0, 7));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) { setOpen(false); setFirst(null); } };
    addEventListener('mousedown', away);
    return () => removeEventListener('mousedown', away);
  }, [open]);
  const [y, m] = month.split('-').map(Number);
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7, days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const step = (d: number) => setMonth(new Date(Date.UTC(y, m - 1 + d, 1)).toISOString().slice(0, 7));
  const iso = (d: number) => `${month}-${String(d).padStart(2, '0')}`;
  // the first click picks a day; a second click on another day turns it into a range
  const pick = (d: string) => {
    if (!first) { setFirst(d); onChange([d, d]); return; }
    onChange(d < first ? [d, first] : [first, d]); setFirst(null); setOpen(false);
  };
  const shown = !value ? 'any date' : value[0] === value[1] ? dmy(value[0]) : `${dmyShort(value[0])} to ${dmyShort(value[1])}`;
  return (
    <div className="calendar" ref={ref}>
      <button type="button" className="cal-field" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>born between</span><b>{shown}</b>
      </button>
      {value && <button type="button" className="clear" onClick={() => { onChange(null); setFirst(null); }}>any date</button>}
      {open && (
        <div className="cal-panel"><i className="c2" />
          <div className="cal-head">
            <button type="button" aria-label="Previous month" onClick={() => step(-1)}>‹</button>
            <span>{MONTHS[m - 1]} {y}</span>
            <button type="button" aria-label="Next month" onClick={() => step(1)}>›</button>
          </div>
          <div className="cal-grid">
            {['m', 't', 'w', 't', 'f', 's', 's'].map((d, i) => <span key={i} className="dow">{d}</span>)}
            {Array.from({ length: lead }, (_, i) => <span key={`x${i}`} />)}
            {Array.from({ length: days }, (_, i) => {
              const d = iso(i + 1), end = value && (d === value[0] || d === value[1]), mid = value && d > value[0] && d < value[1];
              return <button type="button" key={d} className={`${end ? 'on' : ''}${mid ? ' mid' : ''}${marked.includes(d) ? ' born' : ''}`} onClick={() => pick(d)}>{i + 1}</button>;
            })}
          </div>
          <p className="cal-hint">{first ? 'now pick the last day, or the same day again' : 'pick a day, then another for a range'}</p>
        </div>
      )}
    </div>
  );
}

// with all, an "all" tick comes first: it turns every option on, and picking one option while all are on keeps just that one
function Group({ title, options, value, onChange, kind, all }: { title: string; options: [string, ReactNode][]; value: string[]; onChange: (v: string[]) => void; kind?: 'one'; all?: boolean }) {
  const every = value.length === options.length;
  const flip = (v: string) => {
    if (kind === 'one') return onChange([v]);
    if (all && every) return onChange([v]);
    const next = value.includes(v) ? value.filter((x) => x !== v) : [...value, v];
    if (next.length) onChange(next);
  };
  return (
    <fieldset className="filter-group">
      <legend>{title}</legend>
      {all && (
        <label className={every ? 'on' : ''}>
          <input type="checkbox" name={title} checked={every} onChange={() => onChange(options.map(([v]) => v))} />
          <i aria-hidden="true" />all
        </label>
      )}
      {options.map(([v, l]) => (
        <label key={v} data-v={v} className={value.includes(v) && !(all && every) ? 'on' : ''}>
          <input type={kind === 'one' ? 'radio' : 'checkbox'} name={title} checked={value.includes(v) && !(all && every)} onChange={() => flip(v)} />
          {/* the verified box, once ticked, is the verified mark itself: the gold square with its four corner blocks */}
          {v === 'yes' && value.includes(v) && !(all && every) ? <span className="v-tick" aria-hidden="true"><VerifiedMark size={22} /></span> : <i aria-hidden="true" />}{l}
        </label>
      ))}
    </fieldset>
  );
}

const FAQ: [string, string][] = [
  ['Do I need a wallet to run a scribe?', 'No. Open any scribe and run it. Claude scribes have free messages every day. Scribes that carry their own model weights run in your browser and cost nothing to talk to. A wallet is only needed to own, sell or verify one.'],
  ['Where do inscribed model weights run?', 'On your own device. The page rebuilds the model from Solana (or a fast copy that must match the same hash), checks every file, and runs it in WebAssembly. Nothing you type is sent to a server.'],
  ['Can a scribe be changed or deleted?', 'No. Its files are written into Solana transactions and its birth record names their hashes. The owner can sell it, give it away or add journal entries, but nobody can edit what it is.'],
  ['What does it cost to inscribe one?', 'A Claude scribe is a few kilobytes: a handful of transactions and a small deposit for its record. An open model costs about 0.005 SOL per MB in fees. The Inscribe page shows the exact quote before you sign.'],
  ['How do I make my own?', 'Give the scribe brief to any AI assistant and it will write the personality with you. Then upload it on the Inscribe page and sign once.'],
];

function Faq() {
  return (
    <section className="faq">
      <h2 className="faq-title">important questions</h2>
      <div className="faq-list">
        {FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
      </div>
    </section>
  );
}

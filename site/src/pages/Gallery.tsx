import { useEffect, useMemo, useState } from 'react';
import { fileUrl, getScribes, type ScribeView } from '../api.ts';
import { Sigil } from '../Sigil.tsx';
import { API, modelName, sol } from '../config.ts';
import { chunkCount } from '../../../lib/src/chunk.ts';
import { ActivityList, namesOf, useActivity } from './Activity.tsx';
import { hostedStatus } from '../run/bound.ts';
import type { ModelInfo } from './Models.tsx';

export function Portrait({ s }: { s: ScribeView }) {
  const pic = s.files.find((f) => f.role === 'picture');
  if (pic && s.status.state === 'complete') return <img src={fileUrl(pic.sha256)} alt={s.name ?? ''} loading="lazy" />;
  return <Sigil seed={s.address} letter={(s.name ?? '?').slice(0, 1).toUpperCase()} />;
}

export function brainLine(s: ScribeView): string {
  if (s.brain?.kind === 'bound') return `Thinks with ${modelName(s.brain.model)}`;
  if (s.model) return `${s.model.name ?? 'Inscribed model'} · ${(s.model.parameters / 1e6).toFixed(s.model.parameters < 1e7 ? 1 : 0)}M`;
  return s.brain ? 'Inscribed brain' : 'Reading its files…';
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

export function ScribeCard({ s }: { s: ScribeView }) {
  return (
    <a className="card" href={`#/scribe/${s.address}`}>
      <div className="art">
        <Portrait s={s} />
        <span className="corner"><Capsule n={s.birthNumber + 1} /></span>
        {s.brain && <span className={`kind ${onChain(s) ? 'chain' : 'claude'}`}>{onChain(s) ? 'On-chain brain' : 'Claude'}</span>}
        {s.listing && <span className="tag-price">{sol(s.listing.price)} SOL</span>}
      </div>
      <div className="body">
        <div className="name">{s.name ?? 'Inscribing…'}</div>
        {s.purpose && <div className="purpose-line">{s.purpose}</div>}
        <div className="sub">{brainLine(s)}</div>
        <Badges s={s} />
      </div>
    </a>
  );
}

// First questions to put to a scribe from the home page (one click wakes it and asks).
function questions(s: ScribeView): string[] {
  if (onChain(s)) return /stor/i.test(s.purpose ?? '') ? ['Tell me a short story about a fox.', 'Who are you?'] : ['Who are you?', 'What do you know about Solana?'];
  return /trad|token|market/i.test(s.purpose ?? '') ? ["What's trending on Solana right now?", 'Is BONK safe? Quick report.'] : ['What can you do?', "What's new on Solana today?"];
}

// The hero's moving piece: the featured scribe's seal in a turning ring, the others in orbit.
function Orrery({ featured, others, onPick }: { featured: ScribeView; others: ScribeView[]; onPick: (s: ScribeView) => void }) {
  return (
    <div className="orrery">
      <svg className="ring" viewBox="0 0 400 400" aria-hidden="true">
        <circle cx="200" cy="200" r="196" fill="none" stroke="currentColor" strokeWidth="1" opacity=".35" />
        {Array.from({ length: 96 }, (_, i) => {
          const a = (i / 96) * Math.PI * 2, long = i % 8 === 0;
          return <line key={i} x1={200 + Math.cos(a) * 196} y1={200 + Math.sin(a) * 196} x2={200 + Math.cos(a) * (long ? 180 : 188)} y2={200 + Math.sin(a) * (long ? 180 : 188)} stroke="currentColor" strokeWidth={long ? 1.6 : 1} opacity={long ? .7 : .35} />;
        })}
      </svg>
      <div className="orbit">
        {others.slice(0, 7).map((s, i, all) => {
          const a = (i / all.length) * 360;
          return (
            <button key={s.address} className="moon" style={{ transform: `rotate(${a}deg) translate(var(--orbit)) rotate(${-a}deg)` }} onClick={() => onPick(s)} title={s.name ?? ''}>
              <span><Portrait s={s} /></span>
            </button>
          );
        })}
      </div>
      <a className="sun" href={`#/scribe/${featured.address}`} key={featured.address}><Portrait s={featured} /></a>
    </div>
  );
}

export function Gallery() {
  const [list, setList] = useState<ScribeView[] | null>(null);
  const [error, setError] = useState('');
  const [sort, setSort] = useState<'new' | 'birth' | 'rank' | 'sale'>('new');
  const [q, setQ] = useState('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const activity = useActivity(undefined, 8);
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
    const found = needle ? visible.filter((s) => [s.name, s.purpose, s.model?.name, s.brain?.kind === 'bound' ? `${s.brain.model} ${modelName(s.brain.model)}` : '', String(s.birthNumber + 1)]
      .some((x) => x?.toLowerCase().includes(needle))) : visible;
    return order(found);
  }, [visible, sort, q]);
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
  const bytes = models.reduce((n, m) => n + m.size, 0);
  const txs = models.reduce((n, m) => n + chunkCount(m.size), 0);
  const biggest = [...models].sort((a, b) => b.size - a.size)[0];

  // The featured scribe turns over every few seconds until someone picks one.
  const ready = useMemo(() => visible.filter((s) => s.status.state === 'complete'), [visible]);
  const [pick, setPick] = useState<string | null>(null);
  const [turn, setTurn] = useState(0);
  useEffect(() => { if (pick) return; const t = setInterval(() => setTurn((n) => n + 1), 6000); return () => clearInterval(t); }, [pick]);
  const featured = ready.find((s) => s.address === pick) ?? ready[turn % Math.max(1, ready.length)];

  const [freeOpen, setFreeOpen] = useState(false);
  useEffect(() => { hostedStatus().then((h) => setFreeOpen(!!(h.enabled && h.open && (h.remaining ?? 0) > 0))); }, []);
  const chainScribes = ready.filter(onChain);
  const claudeScribes = ready.filter((s) => s.brain?.kind === 'bound');

  return (
    <>
      <section className="hero2">
        <div className="hero-copy">
          <div className="eyebrow">Inscribed agents on Solana</div>
          <h1>Agents that live <em>forever</em> on-chain.</h1>
          <p className="lead">A scribe is an AI agent written into Solana: its personality, its brain and the code that runs it. Anyone can wake one in a browser and talk to it. Nobody can delete it.</p>
          <div className="actions">
            {featured && <a className="btn primary" href={`#/scribe/${featured.address}`}>Talk to a scribe{freeOpen || onChain(featured) ? ' — free' : ''}</a>}
            <a className="btn" href="#/create">Inscribe yours</a>
          </div>
          <p className="muted small-print">No wallet or key needed to talk. <a href="#/brief">Get the scribe brief</a> for your own agent.</p>
        </div>
        <div className="hero-art">
          {featured ? (
            <>
              <Orrery featured={featured} others={ready.filter((s) => s.address !== featured.address)} onPick={(s) => setPick(s.address)} />
              <div className="featured">
                <div className="featured-name"><Capsule n={featured.birthNumber + 1} /><b>{featured.name}</b><span className={`kind inline ${onChain(featured) ? 'chain' : 'claude'}`}>{onChain(featured) ? 'On-chain brain' : 'Claude'}</span></div>
                <div className="asks">
                  {questions(featured).map((t) => <a key={t} className="ask" href={`#/scribe/${featured.address}?ask=${encodeURIComponent(t)}`}>Ask {featured.name}: <b>{t}</b></a>)}
                </div>
              </div>
            </>
          ) : <div className="orrery empty-orrery" />}
        </div>
      </section>

      <section className="band">
        <div className="band-stats">
          <div><b>{list ? stats.born : '—'}</b><span>scribes born</span></div>
          <div><b>{bytes ? `${(bytes / 1e6).toFixed(0)} MB` : '—'}</b><span>of brains written to Solana</span></div>
          <div><b>{txs ? txs.toLocaleString() : '—'}</b><span>transactions holding them</span></div>
          <div><b>{list ? stats.onchain : '—'}</b><span>fully on-chain brains</span></div>
        </div>
        {activity && activity.length > 0 && (
          <div className="ticker" aria-hidden="true">
            <div className="ticker-track">
              {[0, 1].map((k) => <span key={k}>{activity.map((a, i) => <span key={i} className="tick">{tickerText(a, namesOf(list))}</span>)}</span>)}
            </div>
          </div>
        )}
      </section>

      <section className="pipeline">
        <div className="section-head">
          <div className="eyebrow">How it works</div>
          <h2>A brain, byte by byte.</h2>
          <p className="muted">Nothing is stored on a server you have to trust. Every file is cut into pieces small enough for a Solana transaction, and put back together, checked, in your browser.</p>
        </div>
        <ol className="steps5">
          <li><span className="glyph file" /><b>The files</b><span>{biggest ? `${biggest.name ?? biggest.fileName}: ${(biggest.size / 1e6).toFixed(0)} MB` : 'Personality, model, runtime'}</span></li>
          <li><span className="glyph chunks"><i /><i /><i /><i /></span><b>Cut into chunks</b><span>960 bytes each</span></li>
          <li><span className="glyph chain" /><b>Written to Solana</b><span>{biggest ? `${chunkCount(biggest.size).toLocaleString()} transactions` : 'One transaction per chunk'}</span></li>
          <li><span className="glyph check">✓</span><b>Rebuilt and checked</b><span>against the hash in its birth record</span></li>
          <li><span className="glyph wake" /><b>Awake in your browser</b><span>no server, no API key</span></li>
        </ol>
      </section>

      <section className="kinds">
        <div className="kind-card dark">
          <div className="eyebrow">Fully on-chain</div>
          <h3>Its brain is on Solana too.</h3>
          <p>An open model, inscribed byte for byte, runs right in your browser. If every server went dark, this scribe would still wake up.</p>
          <div className="mini-row">{chainScribes.slice(0, 5).map((s) => <a key={s.address} href={`#/scribe/${s.address}`} title={s.name ?? ''}><Portrait s={s} /></a>)}</div>
          <a className="btn light" href="#/models">See the inscribed models →</a>
        </div>
        <div className="kind-card">
          <div className="eyebrow">Thinks with Claude</div>
          <h3>A personality on chain, a powerful mind.</h3>
          <p>It reads live Solana data, checks tokens and wallets, and drafts trades you approve in your own wallet. Talk to one free, no key needed.</p>
          <div className="mini-row">{claudeScribes.slice(0, 5).map((s) => <a key={s.address} href={`#/scribe/${s.address}`} title={s.name ?? ''}><Portrait s={s} /></a>)}</div>
          {claudeScribes[0] && <a className="btn primary" href={`#/scribe/${claudeScribes[0].address}?ask=${encodeURIComponent("What's trending on Solana right now?")}`}>Ask {claudeScribes[0].name} what's trending →</a>}
        </div>
      </section>

      <div className="toolbar">
        <h2>Explore scribes</h2>
        <input className="search" type="search" placeholder="Search by name, model or #" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg">
          <button className={sort === 'new' ? 'on' : ''} onClick={() => setSort('new')}>Newest</button>
          <button className={sort === 'birth' ? 'on' : ''} onClick={() => setSort('birth')}>First born</button>
          <button className={sort === 'rank' ? 'on' : ''} onClick={() => setSort('rank')}>Rarest</button>
          <button className={sort === 'sale' ? 'on' : ''} onClick={() => setSort('sale')}>For sale{stats.forSale ? ` · ${stats.forSale}` : ''}</button>
        </div>
      </div>
      {error && <div className="notice bad" style={{ marginBottom: 16 }}>Could not reach the indexer: {error}</div>}
      {!list && !error && <div className="grid">{[0, 1, 2, 3].map((i) => <div key={i} className="card skeleton"><div className="art" /><div className="body"><div className="line" /><div className="line short" /></div></div>)}</div>}
      {list && shown.length === 0 && <div className="empty">{q ? `No scribe matches “${q}”.` : sort === 'sale' ? 'Nothing is for sale right now.' : <>No scribes yet. <a href="#/create">Inscribe the first one.</a></>}</div>}
      <div className="grid">{shown.map((s) => <ScribeCard key={s.address} s={s} />)}</div>

      <section className="panel" style={{ marginBottom: 56 }}>
        <div className="panel-head"><h3>Latest activity</h3><span className="muted">births · verifications · sales · gifts</span></div>
        <ActivityList rows={activity} names={namesOf(list)} />
      </section>
    </>
  );
}

// One line of the ticker for an activity row.
function tickerText(a: { kind: string; scribe?: string; price?: number; birthNumber?: number; reward?: number }, names: Map<string, string>): string {
  const who = (a.scribe && names.get(a.scribe)) || 'A scribe';
  switch (a.kind) {
    case 'born': return `✦ ${who} was born${a.birthNumber !== undefined ? ` as #${a.birthNumber + 1}` : ''}`;
    case 'verified': return `✓ ${who} was verified`;
    case 'sold': return `◆ ${who} sold${a.price ? ` for ${sol(a.price)} SOL` : ''}`;
    case 'listed': return `◇ ${who} listed${a.price ? ` at ${sol(a.price)} SOL` : ''}`;
    case 'given': return `→ ${who} changed hands`;
    case 'bounty_awarded': return `★ ${who} won a ${sol(a.reward ?? 0)} SOL bounty`;
    default: return `· ${who}: ${a.kind.replace(/_/g, ' ')}`;
  }
}

import { useEffect, useMemo, useState } from 'react';
import { fileUrl, getScribes, type ScribeView } from '../api.ts';
import { Sigil } from '../Sigil.tsx';
import { sol } from '../config.ts';
import { ActivityList, namesOf, useActivity } from './Activity.tsx';

export function Portrait({ s }: { s: ScribeView }) {
  const pic = s.files.find((f) => f.role === 'picture');
  if (pic && s.status.state === 'complete') return <img src={fileUrl(pic.sha256)} alt={s.name ?? ''} loading="lazy" />;
  return <Sigil seed={s.address} letter={(s.name ?? '?').slice(0, 1).toUpperCase()} />;
}

export function brainLine(s: ScribeView): string {
  if (s.brain?.kind === 'bound') return `Bound to ${s.brain.model}`;
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

export function ScribeCard({ s }: { s: ScribeView }) {
  return (
    <a className="card" href={`#/scribe/${s.address}`}>
      <div className="art">
        <Portrait s={s} />
        <span className="corner"><Capsule n={s.birthNumber + 1} /></span>
        {s.listing && <span className="tag-price">{sol(s.listing.price)} SOL</span>}
      </div>
      <div className="body">
        <div className="name">{s.name ?? 'Inscribing…'}</div>
        <div className="sub">{brainLine(s)}</div>
        <Badges s={s} />
      </div>
    </a>
  );
}

export function Gallery() {
  const [list, setList] = useState<ScribeView[] | null>(null);
  const [error, setError] = useState('');
  const [sort, setSort] = useState<'new' | 'birth' | 'rank' | 'sale'>('new');
  const [q, setQ] = useState('');
  const activity = useActivity(undefined, 8);
  useEffect(() => {
    let live = true;
    const load = () => getScribes().then((l) => { if (live) { setList(l); setError(''); } }).catch((e) => live && setError(e.message));
    load();
    const t = setInterval(load, 5000);
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
    const found = needle ? visible.filter((s) => [s.name, s.purpose, s.model?.name, s.brain?.kind === 'bound' ? s.brain.model : '', String(s.birthNumber + 1)]
      .some((x) => x?.toLowerCase().includes(needle))) : visible;
    return order(found);
  }, [visible, sort, q]);
  const stats = useMemo(() => {
    const forSale = visible.filter((s) => s.listing);
    return {
      born: visible.length,
      verified: visible.filter((s) => s.verified).length,
      onchain: visible.filter((s) => s.brain?.kind === 'inscribed').length,
      forSale: forSale.length,
      floor: forSale.length ? Math.min(...forSale.map((s) => s.listing!.price)) : null,
    };
  }, [visible]);
  const latest = useMemo(() => [...visible].reverse().slice(0, 4), [visible]);

  return (
    <>
      <section className="hero">
        <div>
          <div className="eyebrow">Inscribed agents on Solana</div>
          <h1>Give your agent a permanent home on-chain.</h1>
          <p className="lead">Every byte of a scribe lives on Solana: its personality, its brain and the code that runs it. Anyone can open it in a browser and talk to it. It can never be deleted.</p>
          <div className="actions">
            <a className="btn primary" href="#/create">Inscribe a scribe</a>
            <a className="btn" href="#/brief">Get the scribe brief</a>
          </div>
        </div>
        <div className="ledger">
          <div className="eyebrow">The ledger</div>
          <div className="count">{list ? visible.length.toLocaleString() : '—'}<small>scribes born</small></div>
          <ul>
            {latest.map((s) => (
              <li key={s.address}>
                <Capsule n={s.birthNumber + 1} />
                <a className="who" href={`#/scribe/${s.address}`}><b>{s.name ?? 'Inscribing…'}</b><span>{brainLine(s)}</span></a>
              </li>
            ))}
            {list && latest.length === 0 && <li className="muted">No scribes yet. Be the first.</li>}
          </ul>
        </div>
      </section>

      <section className="stats">
        <div><b>{list ? stats.born : '—'}</b><span>scribes born</span></div>
        <div><b>{list ? stats.onchain : '—'}</b><span>fully on-chain brains</span></div>
        <div><b>{list ? stats.verified : '—'}</b><span>verified</span></div>
        <div><b>{list ? (stats.floor === null ? '—' : sol(stats.floor)) : '—'}</b><span>floor price (SOL) · {stats.forSale} for sale</span></div>
      </section>

      <section className="steps3">
        <div><span className="n">01</span><h3>Package</h3><p>Give your agent the scribe brief. It writes its own personality and picks its brain: an open model, or a hosted one like Claude.</p></div>
        <div><span className="n">02</span><h3>Inscribe</h3><p>Drop the files, see your attributes and the price, and sign once. Your scribe is born with a birth number that never changes.</p></div>
        <div><span className="n">03</span><h3>Wake it anywhere</h3><p>Every file is checked against its hash on chain, then the scribe runs right in the browser. Hold it, gift it, collect it.</p></div>
      </section>

      <div className="toolbar">
        <h2>Explore scribes</h2>
        <input className="search" type="search" placeholder="Search by name, model or #" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg">
          <button className={sort === 'new' ? 'on' : ''} onClick={() => setSort('new')}>Newest</button>
          <button className={sort === 'birth' ? 'on' : ''} onClick={() => setSort('birth')}>First born</button>
          <button className={sort === 'rank' ? 'on' : ''} onClick={() => setSort('rank')}>Rarest</button>
          <button className={sort === 'sale' ? 'on' : ''} onClick={() => setSort('sale')}>For sale</button>
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

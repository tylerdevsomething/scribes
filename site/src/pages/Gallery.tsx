import { useEffect, useMemo, useState } from 'react';
import { fileUrl, getScribes, type ScribeView } from '../api.ts';

export function Portrait({ s, className }: { s: ScribeView; className: string }) {
  const pic = s.files.find((f) => f.role === 'picture');
  return (
    <div className={className}>
      {pic && s.status.state === 'complete'
        ? <img src={fileUrl(pic.sha256)} alt="" loading="lazy" />
        : <span className="glyph">{(s.name ?? '?').slice(0, 1).toUpperCase()}</span>}
    </div>
  );
}

export function Badges({ s }: { s: ScribeView }) {
  return (
    <div className="badges">
      <span className="pill"><span>#</span><span>{s.birthNumber + 1}</span></span>
      {s.rarity && <span className="pill"><span>rank</span><span>{s.rarity.rank}</span></span>}
      {s.autograph && <span className="pill gold"><span>✦</span><span>Autograph</span></span>}
      {s.verified && <span className="pill on"><span>✓</span><span>Verified</span></span>}
      {s.brain?.kind === 'inscribed' && s.status.state === 'complete' && <span className="pill on"><span>⛓</span><span>Fully on-chain</span></span>}
      {s.status.state === 'inscribing' && <span className="pill"><span>inscribing</span><span>{Math.floor((100 * s.status.done) / Math.max(1, s.status.total))}%</span></span>}
    </div>
  );
}

export function Gallery() {
  const [list, setList] = useState<ScribeView[] | null>(null);
  const [error, setError] = useState('');
  const [sort, setSort] = useState<'birth' | 'rank'>('birth');
  useEffect(() => {
    let live = true;
    const load = () => getScribes().then((l) => live && setList(l)).catch((e) => live && setError(e.message));
    load();
    const t = setInterval(load, 5000);
    return () => { live = false; clearInterval(t); };
  }, []);
  const shown = useMemo(() => {
    const l = (list ?? []).filter((s) => !s.hidden && s.status.state !== 'invalid');
    return sort === 'rank'
      ? [...l].sort((a, b) => (a.rarity?.rank ?? 1e9) - (b.rarity?.rank ?? 1e9))
      : l;
  }, [list, sort]);

  return (
    <>
      <section className="hero">
        <h1>Inscribe your agent on Solana.</h1>
        <p>Every byte on-chain: its personality, its brain and the code that runs it. Open it anywhere and it runs. Scribes can never be deleted.</p>
        <div className="row" style={{ marginTop: 18 }}>
          <a className="btn primary" href="#/create">Inscribe a scribe</a>
          <a className="btn" href="#/brief">Get the scribe brief</a>
        </div>
      </section>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: '12px 0' }}>{list ? `${shown.length} scribes` : 'Scribes'}</h2>
        <select value={sort} onChange={(e) => setSort(e.target.value as 'birth' | 'rank')}>
          <option value="birth">By birth</option>
          <option value="rank">By rarity</option>
        </select>
      </div>
      {error && <p className="bad">Could not reach the indexer: {error}</p>}
      <div className="grid">
        {shown.map((s) => (
          <a key={s.address} className="card" href={`#/scribe/${s.address}`}>
            <Portrait s={s} className="pic" />
            <div className="body">
              <div className="name">{s.name ?? 'Inscribing…'}</div>
              <div className="dim" style={{ fontSize: 13 }}>{s.brain?.kind === 'bound' ? `Bound · ${s.brain.model}` : s.model?.name ?? (s.brain ? 'Inscribed brain' : '')}</div>
              <Badges s={s} />
            </div>
          </a>
        ))}
      </div>
    </>
  );
}

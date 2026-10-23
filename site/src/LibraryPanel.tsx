// A scribe's libraries on its page: one search across them all, a tab to browse each, and a reader for any
// entry. The server's index is only a cache of the inscribed files, listed with the scribe's other files.
import { useEffect, useState, type ReactNode } from 'react';
import { getLibraries, libraryRawUrl, listLibrary, readLibrary, searchLibrary, type Building, type LibraryEntryView, type LibraryHits, type LibraryInfo, type LibraryPage, type ScribeView } from './api.ts';

type Page = Exclude<LibraryPage, Building>;
const PAGE = 50;
const kb = (n: number) => (n < 1e6 ? `${(n / 1e3).toFixed(1)} kb` : `${(n / 1e6).toFixed(1)} mb`);
// the server marks matches «like this»
const marked = (s: string): ReactNode[] => s.split(/(«[^»]*»)/).map((x, i) => (x.startsWith('«') ? <mark key={i}>{x.slice(1, -1)}</mark> : x));

export function LibraryPanel({ s }: { s: ScribeView }) {
  const has = s.status.state === 'complete' && s.files.some((f) => f.role === 'library');
  const [libs, setLibs] = useState<LibraryInfo[] | null>(null);
  const [tab, setTab] = useState('');
  const [offset, setOffset] = useState(0);
  const [list, setList] = useState<LibraryEntryView[] | null>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<LibraryHits | null>(null);
  const [open, setOpen] = useState<Page | null>(null);
  const [error, setError] = useState('');
  const fail = (e: unknown) => setError((e as Error).message);

  // while a library is first indexed the server says how far it is; ask again until every one is ready
  useEffect(() => {
    if (!has) return;
    let stop = false, t: ReturnType<typeof setTimeout>;
    const load = () => getLibraries(s.address).then((l) => {
      if (stop) return;
      setLibs(l);
      setTab((x) => x || l[0]?.name || '');
      if (l.some((x) => x.state === 'building')) t = setTimeout(load, 3000);
    }, fail);
    load();
    return () => { stop = true; clearTimeout(t); };
  }, [has, s.address]);

  const current = libs?.find((l) => l.name === tab);
  useEffect(() => {
    setList(null);
    if (current?.state !== 'ready') return;
    listLibrary(s.address, current.name, offset, PAGE).then((r) => setList('building' in r ? null : r), fail);
  }, [s.address, current?.name, current?.state, offset]);

  if (!has) return null;
  const search = async () => { setOpen(null); setHits(q.trim() ? await searchLibrary(s.address, q.trim(), 25) : null); };
  const read = async (e: { path: string; title?: string; type?: string }, from = 0) => {
    if (e.type && !e.type.startsWith('text/')) { setOpen({ path: e.path, title: e.title || e.path, type: e.type, size: 0, text: null, offset: 0, next: null }); return; }
    const r = await readLibrary(s.address, e.path, from);
    if ('building' in r) return;
    setOpen(from && open ? { ...r, text: (open.text ?? '') + r.text } : r);
  };
  const ready = libs?.filter((l) => l.state === 'ready') ?? [];

  return (
    <div className="panel library">
      <div className="panel-head">
        <h3>{libs && libs.length > 1 ? 'libraries' : 'library'}</h3>
        {ready.length > 0 && <span className="muted">{ready.reduce((n, l) => n + (l.state === 'ready' ? l.entries : 0), 0).toLocaleString()} entries · {kb(ready.reduce((n, l) => n + (l.state === 'ready' ? l.textBytes : 0), 0))} of text</span>}
      </div>
      {error && <div className="notice bad">{error}</div>}
      {libs?.filter((l) => l.state !== 'ready').map((l) => (
        <p key={l.name} className="muted">{l.name}: {l.state === 'building' ? `indexing for search, ${l.done.toLocaleString()} of ${l.total.toLocaleString() || '…'} entries` : `could not be read (${l.error})`}</p>
      ))}
      {ready.length > 0 && (
        <>
          <form onSubmit={(e) => { e.preventDefault(); search().catch(fail); }} style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <input style={{ flex: 1 }} placeholder={`search ${ready.map((l) => (l.state === 'ready' ? l.title : l.name).toLowerCase()).join(' and ')}`} value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="small" type="submit">search</button>
            {hits && <button className="small" type="button" onClick={() => { setHits(null); setQ(''); setOpen(null); }}>clear</button>}
          </form>
          {open ? (
            <div className="library-read">
              <p><button className="small" onClick={() => setOpen(null)}>back</button> <b>{open.title}</b> <span className="muted">{open.path}</span></p>
              {open.text === null
                ? <img src={libraryRawUrl(s.address, open.path)} alt={open.title} style={{ maxWidth: '100%' }} />
                : <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '70vh', overflow: 'auto' }}>{open.text}</pre>}
              {open.next !== null && <button className="small" onClick={() => read(open, open.next!).catch(fail)}>read more</button>}
            </div>
          ) : hits ? (
            hits.hits.length === 0 ? <p className="muted">nothing matches</p> : (
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {hits.hits.map((h) => (
                  <li key={h.path} style={{ marginBottom: 12 }}>
                    <a href="#" onClick={(e) => { e.preventDefault(); read(h).catch(fail); }}><b>{h.title}</b></a> <span className="muted">{h.path}</span>
                    <div className="muted">{marked(h.snippet.replace(/\s+/g, ' '))}</div>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <>
              {libs!.length > 1 && (
                <p style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {libs!.map((l) => <button key={l.name} className={`small${l.name === tab ? ' on' : ''}`} disabled={l.state !== 'ready'} onClick={() => { setTab(l.name); setOffset(0); }}>{(l.state === 'ready' ? l.title : l.name).toLowerCase()}</button>)}
                </p>
              )}
              {current?.state === 'ready' && (
                <>
                  <p className="muted" style={{ marginTop: 0 }}>{current.title.toLowerCase()} · {current.entries.toLocaleString()} entries{current.source && <> · <a href={current.source} target="_blank" rel="noopener noreferrer">source</a></>}</p>
                  <table className="pf-table"><thead><tr><th>entry</th><th>type</th><th>size</th></tr></thead><tbody>
                    {(list ?? []).map((e) => (
                      <tr key={e.path}>
                        <td><a href="#" onClick={(x) => { x.preventDefault(); read(e).catch(fail); }}>{e.title || e.path}</a></td>
                        <td>{e.type.split('/')[1]}</td>
                        <td>{kb(e.size)}</td>
                      </tr>
                    ))}
                  </tbody></table>
                  <p style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button className="small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>previous</button>
                    <span className="muted">{(offset + 1).toLocaleString()}–{Math.min(current.entries, offset + PAGE).toLocaleString()} of {current.entries.toLocaleString()}</span>
                    <button className="small" disabled={offset + PAGE >= current.entries} onClick={() => setOffset(offset + PAGE)}>next</button>
                  </p>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

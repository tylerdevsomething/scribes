// The activity feed: births, verifications, listings, sales and gifts, newest first.
import { useEffect, useState, type ReactNode } from 'react';
import { API, explorer, short, sol } from '../config.ts';
import type { ScribeView } from '../api.ts';
import { Loading } from '../Loading.tsx';

type Entry =
  | { kind: 'born'; scribe: string; owner: string; birthNumber: number; autograph: boolean }
  | { kind: 'verified'; scribe: string; burned: string }
  | { kind: 'listed'; scribe: string; seller: string; price: number }
  | { kind: 'unlisted'; scribe: string }
  | { kind: 'sold'; scribe: string; from: string; to: string; price: number; fee: number }
  | { kind: 'given'; scribe: string; from: string; to: string }
  | { kind: 'bounty_awarded'; scribe: string; bounty: string; owner: string; reward: number; fee: number };
type Row = Entry & { signature: string; slot: number; time: number | null };

const ICON: Record<Entry['kind'], string> = { born: '✦', verified: '✓', listed: '◷', unlisted: '–', sold: '⇄', given: '↗', bounty_awarded: '★' };

function ago(t: number | null, slot: number): string {
  if (!t) return `slot ${slot.toLocaleString()}`;
  const s = Math.max(0, Date.now() / 1000 - t);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t * 1000).toLocaleDateString();
}

export function useActivity(scribe?: string, limit = 12): Row[] | null {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => fetch(`${API}/activity?limit=${limit}${scribe ? `&scribe=${scribe}` : ''}`).then((r) => r.json()).then((j) => live && setRows(j)).catch(() => {});
    load();
    const t = setInterval(load, 6000);
    return () => { live = false; clearInterval(t); };
  }, [scribe, limit]);
  return rows;
}

// Addresses go in <code> so the lowercase site leaves their case alone.
function describe(e: Entry, name: ReactNode): ReactNode {
  switch (e.kind) {
    case 'born': return <>{name} was born as #{e.birthNumber + 1}{e.autograph ? ' with the Autograph' : ''}</>;
    case 'verified': return <>{name} was verified</>;
    case 'listed': return <>{name} listed for {sol(e.price)} SOL</>;
    case 'unlisted': return <>{name} taken off sale</>;
    case 'sold': return <>{name} sold for {sol(e.price)} SOL</>;
    case 'given': return <>{name} given to <code>{short(e.to)}</code></>;
    case 'bounty_awarded': return <>{name} won a {sol(e.reward)} SOL bounty</>;
  }
}

export function ActivityList({ rows, names, compact }: { rows: Row[] | null; names: Map<string, string>; compact?: boolean }) {
  if (!rows) return <Loading />;
  if (rows.length === 0) return <div className="muted" style={{ fontSize: 14 }}>Nothing yet.</div>;
  return (
    <ul className="feed">
      {rows.map((e) => (
        <li key={`${e.signature}-${e.kind}`} className={e.kind}>
          <i>{ICON[e.kind]}</i>
          <span className="what">
            {compact ? describe(e, names.get(e.scribe) ?? 'It') : <a href={`#/scribe/${e.scribe}`}>{describe(e, names.get(e.scribe) ?? <code>{short(e.scribe)}</code>)}</a>}
          </span>
          <a className="when" href={explorer('tx', e.signature)} target="_blank" rel="noreferrer">{ago(e.time, e.slot)}</a>
        </li>
      ))}
    </ul>
  );
}

export function namesOf(list: ScribeView[] | null): Map<string, string> {
  return new Map((list ?? []).filter((s) => s.name).map((s) => [s.address, s.name!]));
}

import { useEffect, useState } from 'react';
// The one loading state for anything read from the chain or the indexer: a small block turning in 3D with the
// logo on every face (the rarity cube's little sibling), and the one word "loading" under it.
export function Loading({ text = 'loading...' }: { text?: string }) {
  return (
    <div className="loading" role="status">
      <span className="loading-cube" aria-hidden="true">
        <span className="lc">{['f', 'b', 'r', 'l', 't', 'u'].map((k) => <img key={k} className={`lf lf-${k}`} src="/favicon.svg?v=4" alt="" />)}</span>
      </span>
      <span>{text}</span>
    </div>
  );
}

// Keeps the loader up for at least `ms` after a view opens, so a fast answer does not flash it away.
// True while still loading or still inside that time.
export function useHold(ready: boolean, ms = 1200): boolean {
  const [start] = useState(() => Date.now());
  const [, bump] = useState(0);
  const left = start + ms - Date.now();
  useEffect(() => {
    if (!ready || left <= 0) return;
    const t = setTimeout(() => bump((n) => n + 1), left);
    return () => clearTimeout(t);
  }, [ready, left > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  return !ready || left > 0;
}

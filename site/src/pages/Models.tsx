// The models inscribed on Solana: every byte of each one is on chain, it runs in the visitor's browser,
// and any new scribe can reuse it for free (only the personality is inscribed again).
import { useEffect, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { fileTag } from '../../../lib/src/chain.ts';
import { chunkCount } from '../../../lib/src/chunk.ts';
import { API, explorer, sol } from '../config.ts';

export interface ModelInfo {
  sha256: string; size: number; writer: string; fileName: string;
  name: string | null; architecture: string | null; parameters: number;
  scribes: number; firstScribe: string;
}

const params = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)}M`);

export function ModelsPage() {
  const [list, setList] = useState<ModelInfo[] | null>(null);
  const [tags, setTags] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [royalty, setRoyalty] = useState<number | null>(null);
  useEffect(() => { fetch(`${API}/settings`).then((r) => r.json()).then((s) => setRoyalty(s.modelRoyalty ?? null)).catch(() => {}); }, []);
  useEffect(() => {
    fetch(`${API}/models`).then((r) => r.json()).then(async (l: ModelInfo[]) => {
      const sorted = [...l].sort((a, b) => b.parameters - a.parameters);
      setList(sorted);
      const t: Record<string, string> = {};
      for (const m of sorted) t[m.sha256] = (await fileTag(m.sha256, new PublicKey(m.writer))).toBase58();
      setTags(t);
    }).catch((e) => setError(e.message));
  }, []);

  return (
    <div style={{ padding: '40px 0 72px' }}>
      <div className="eyebrow">On-chain brains</div>
      <h1>Models inscribed on Solana</h1>
      <p className="muted" style={{ fontSize: 17, maxWidth: 720 }}>Every byte of these models is written to Solana. A scribe that thinks with one downloads it, checks it against its hash on chain and runs it in your browser: no server, no API key. Any new scribe can reuse a model that is already inscribed, without paying to inscribe it again.</p>
      {royalty !== null && royalty > 0 && (
        <p className="muted" style={{ fontSize: 15, maxWidth: 720 }}>
          The first scribe on a model is its <b>Autograph</b>. Every later scribe on that model pays a <b>{sol(royalty)} SOL</b> royalty to whoever owns the Autograph, so inscribing a model can pay for itself, and the right to it moves with the Autograph when it is sold or given.
        </p>
      )}
      {error && <div className="notice bad">{error}</div>}
      {!list && !error && <p className="muted">Reading the models…</p>}
      {list && list.length === 0 && <p className="muted">No models are fully inscribed yet.</p>}
      <div className="models">
        {list?.map((m) => (
          <div key={m.sha256} className="panel model">
            <div className="panel-head">
              <h3>{m.name ?? m.fileName}</h3>
              <span className="chip teal">{params(m.parameters)} parameters</span>
            </div>
            <div className="facts">
              <div><span>File</span><span title={m.fileName}>{m.fileName}</span></div>
              <div><span>Size</span><span>{(m.size / 1e6).toFixed(m.size < 1e7 ? 1 : 0)} MB</span></div>
              <div><span>Architecture</span><span>{m.architecture ?? '—'}</span></div>
              <div><span>Transactions on Solana</span><span>{chunkCount(m.size).toLocaleString()}</span></div>
              <div><span>Scribes using it</span><span>{m.scribes}</span></div>
              <div><span>sha256</span><span className="mono" title={m.sha256}>{m.sha256.slice(0, 16)}…</span></div>
            </div>
            <div className="row" style={{ marginTop: 12, flexWrap: 'wrap', gap: 10 }}>
              <a className="btn primary" href={`#/create/model/${m.sha256}`}>Inscribe a scribe with it{royalty ? ` — ${sol(royalty)} SOL royalty` : ' — free reuse'}</a>
              <a className="btn" href={`#/scribe/${m.firstScribe}`}>Talk to the first one</a>
              {tags[m.sha256] && <a className="btn" href={explorer('address', tags[m.sha256])} target="_blank" rel="noreferrer">View the inscription on Solscan ↗</a>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// The models inscribed on Solana: every byte of each one is on chain, it runs in the visitor's browser,
// and any new scribe can reuse it for free (only the personality is inscribed again).
import { useEffect, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { fileTag } from '../../../lib/src/chain.ts';
import { chunkCount } from '../../../lib/src/chunk.ts';
import { API, explorer, sol } from '../config.ts';
import { Folio } from '../Hero.tsx';
import { Info } from './Create.tsx';
import { Loading, useHold } from '../Loading.tsx';

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

  const wait = useHold(!!list || !!error);
  return (
    <Folio className="folio-hero stage">
      <div className="scene scene-models">
        {/* two paragraphs: how a model runs on the left, the autograph royalty on the right */}
        <div className="models-paras">
          <h1 className="hero-title">models inscribed on solana</h1>
          <p>Every byte of these models is written to Solana. A scribe downloads its model, checks it against the hash on chain and runs it in your browser, with no server and no API key.</p>
          <p>The first scribe born on a model holds its autograph<Info text="the autograph belongs to the first scribe born on a model. whoever owns that scribe earns the model's royalty." />. Every later scribe on that model pays{royalty ? ` a ${sol(royalty)} SOL` : ' a'} royalty to whoever owns the autograph, and the right moves with it when sold.</p>
        </div>
        {error && <div className="notice bad">{error}</div>}
        {wait && !error && <Loading />}
        {!wait && list && list.length === 0 && <p className="models-lede">no models are fully inscribed yet.</p>}
        <div className="model-grid">
          {!wait && list?.map((m) => (
            <div key={m.sha256} className="model-card">
              <i className="c2" />
              {tags[m.sha256] && <a className="solscan" href={explorer('address', tags[m.sha256])} target="_blank" rel="noreferrer" aria-label="the inscription on solscan" title="the inscription on solscan"><img src="/solscan-blue.png" alt="" /><span>solscan</span></a>}
              <h3>{(m.name ?? m.fileName.replace(/\.gguf$/i, '')).toLowerCase()}</h3>
              <div className="model-params">{params(m.parameters).toLowerCase()} parameters</div>
              <div className="model-facts">
                <div><span>file</span><span title={m.fileName}>{m.fileName.toLowerCase()}</span></div>
                <div><span>size</span><span>{(m.size / 1e6).toFixed(m.size < 1e7 ? 1 : 0)} mb</span></div>
                <div><span>architecture</span><span>{m.architecture ?? 'unknown'}</span></div>
                <div><span>transactions</span><span>{chunkCount(m.size).toLocaleString()}</span></div>
                <div><span>scribes using it</span><span>{m.scribes}</span></div>
                <div><span>sha256</span><span className="case" title={m.sha256}>{m.sha256.slice(0, 3)}…{m.sha256.slice(-3)}</span></div>
              </div>
              <div className="model-go">
                <a className="show-all on" href={`#/create/model/${m.sha256}`}>use this model</a>
                <a className="show-all" href={`#/scribe/${m.firstScribe}`}>chat</a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Folio>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Transaction } from '@solana/web3.js';
import { checkUpload, checkout, newUpload, putPart, submitted, uploadStatus, type CheckReport, type UploadPhase } from '../api.ts';
import { conn, explorer, sol } from '../config.ts';
import { connect, signTransaction, useWallet, wallets } from '../wallet.ts';

type Part = 'personality' | 'model' | 'brain' | 'picture';

// Which part a dropped file is, from its name and type.
function partOf(f: File): Part | null {
  const n = f.name.toLowerCase();
  if (n.endsWith('.gguf')) return 'model';
  if (n === 'brain.json') return 'brain';
  if (n.endsWith('.json')) return 'personality';
  if (f.type.startsWith('image/')) return 'picture';
  return null;
}

const size = (n: number) => (n < 1e6 ? `${(n / 1e3).toFixed(1)} KB` : `${(n / 1e6).toFixed(1)} MB`);

export function Create() {
  const [files, setFiles] = useState<Partial<Record<Part, File>>>({});
  const [ignored, setIgnored] = useState<string[]>([]);
  const [hot, setHot] = useState(false);
  const [id, setId] = useState<string | null>(null);
  const [report, setReport] = useState<CheckReport | null>(null);
  const [phase, setPhase] = useState<UploadPhase | null>(null);
  const owner = useWallet();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const pickRef = useRef<HTMLInputElement>(null);

  function add(list: FileList | File[]) {
    const next = { ...files };
    const skipped: string[] = [];
    for (const f of Array.from(list)) {
      const p = partOf(f);
      if (p) next[p] = f; else skipped.push(f.name);
    }
    if (next.model && next.brain) delete next.brain; // a model file wins over a binding
    setFiles(next);
    setIgnored(skipped);
    setReport(null);
    setId(null);
  }

  async function check() {
    setError('');
    setBusy('Uploading');
    try {
      const { id } = await newUpload();
      for (const [part, f] of Object.entries(files) as [Part, File][]) {
        setBusy(`Uploading ${f.name}`);
        await putPart(id, part, f.name.replace(/[^A-Za-z0-9._-]/g, '_'), f);
      }
      setBusy('The bot is checking your scribe');
      setReport(await checkUpload(id));
      setId(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function connectWallet(provider: Parameters<typeof connect>[0]) {
    try { await connect(provider); } catch (e) { setError((e as Error).message); }
  }

  async function inscribe() {
    if (!id || !owner) return;
    setError('');
    try {
      setBusy('Preparing the transaction');
      const { tx } = await checkout(id, owner);
      setBusy('Approve it in your wallet');
      const signed = await signTransaction(Transaction.from(Uint8Array.from(atob(tx), (c) => c.charCodeAt(0))));
      setBusy('Sending');
      const sig = await conn.sendRawTransaction(signed.serialize());
      setBusy('Waiting for Solana to confirm');
      setPhase(await submitted(id, sig));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  // Follow the inscription.
  useEffect(() => {
    if (!id || !phase || phase.phase === 'done' || phase.phase === 'failed' || phase.phase === 'checked') return;
    const t = setInterval(() => uploadStatus(id).then(setPhase).catch(() => {}), 1500);
    return () => clearInterval(t);
  }, [id, phase]);

  const ready = !!files.personality && (!!files.model || !!files.brain);
  const q = report?.quote;
  const found = wallets();
  const stage = phase ? 3 : report?.ok ? 2 : 1;
  const brainFile = files.model ?? files.brain;

  return (
    <div className="prose" style={{ maxWidth: 860 }}>
      <div className="eyebrow">Inscribe</div>
      <h1>Bring your agent on-chain</h1>
      <p className="muted" style={{ fontSize: 17 }}>Hand your agent the <a href="#/brief">scribe brief</a>. It packages itself into a folder; drop those files here.</p>

      <div className="stepper">
        <div className={stage === 1 ? 'on' : 'done'}><i>{stage > 1 ? '✓' : 1}</i>Add files</div>
        <div className={stage === 2 ? 'on' : stage > 2 ? 'done' : ''}><i>{stage > 2 ? '✓' : 2}</i>Check &amp; sign</div>
        <div className={stage === 3 ? (phase?.phase === 'done' ? 'done' : 'on') : ''}><i>{phase?.phase === 'done' ? '✓' : 3}</i>Inscribed</div>
      </div>

      {!phase && (
        <>
          <div
            className={`drop ${hot ? 'hot' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setHot(true); }}
            onDragLeave={() => setHot(false)}
            onDrop={(e) => { e.preventDefault(); setHot(false); add(e.dataTransfer.files); }}
            onClick={() => pickRef.current?.click()}
          >
            <div className="big">Drop your scribe's files here</div>
            <div className="small">or click to choose them</div>
            <input ref={pickRef} type="file" multiple hidden onChange={(e) => e.target.files && add(e.target.files)} />
          </div>
          <div className="slots">
            <div className={`slot ${files.personality ? 'filled' : ''}`}>
              <div className="k">Personality · required</div>
              {files.personality ? <div className="v">{files.personality.name}</div> : <div className="h">personality.json</div>}
            </div>
            <div className={`slot ${brainFile ? 'filled' : ''}`}>
              <div className="k">Brain · required</div>
              {brainFile ? <div className="v">{brainFile.name} <span className="h">{size(brainFile.size)}</span></div> : <div className="h">a .gguf model, or brain.json</div>}
            </div>
            <div className={`slot ${files.picture ? 'filled' : ''}`}>
              <div className="k">Picture · optional</div>
              {files.picture ? <div className="v">{files.picture.name}</div> : <div className="h">PNG, JPEG or WebP</div>}
            </div>
          </div>
          {ignored.length > 0 && <p className="muted" style={{ marginTop: 10, fontSize: 13.5 }}>Not used: {ignored.join(', ')}</p>}
          <div className="row" style={{ marginTop: 18 }}>
            <button className="primary" disabled={!ready || !!busy} onClick={check}>{busy && !report ? `${busy}…` : 'Check my scribe'}</button>
            {!ready && <span className="muted" style={{ fontSize: 14 }}>Add a personality and a brain to continue.</span>}
          </div>
        </>
      )}

      {error && <div className="notice bad" style={{ marginTop: 16 }}>{error}</div>}

      {report && !phase && (
        <div className="panel" style={{ marginTop: 22 }}>
          {!report.ok ? (
            <div className="notice bad">
              <b>The bot found problems</b> — nothing was charged.
              <ul>{report.problems.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          ) : (
            <>
              <div className="panel-head"><h3>{report.name} is ready</h3><span className="chip teal">Checks passed</span></div>
              {report.attributes && (
                <table className="attrs" style={{ marginBottom: 14 }}><tbody>
                  {Object.entries(report.attributes).filter(([k]) => k !== 'Model').map(([k, v]) => (
                    <tr key={k} className={['Birth', 'Autograph', 'Verified'].includes(k) ? 'chain' : 'files'}><td>{k}</td><td>{v}</td><td /></tr>
                  ))}
                </tbody></table>
              )}
              <div className="filelist">
                {report.files.map((f) => (
                  <div className="f" key={f.sha256}>
                    <div className="top"><span>{f.name} <span className="chip" style={{ marginLeft: 6 }}>{f.role}</span></span>
                      {f.reused ? <span className="chip teal">Already on chain · reused</span> : <span className="muted">{size(f.size)}</span>}</div>
                  </div>
                ))}
              </div>
              {q && (
                <table className="cost"><tbody>
                  <tr><td>Inscription · {q.chunks.toLocaleString()} transactions</td><td>{sol(q.inscriptionLamports)} SOL</td></tr>
                  <tr><td>On-chain record (rent)</td><td>{sol(q.recordRentLamports)} SOL</td></tr>
                  {q.birthFeeLamports > 0 && <tr><td>Birth fee</td><td>{sol(q.birthFeeLamports)} SOL</td></tr>}
                  <tr><td>Network fee</td><td>{sol(q.networkFeeLamports)} SOL</td></tr>
                  <tr className="total"><td>Total</td><td>{sol(q.totalLamports)} SOL</td></tr>
                </tbody></table>
              )}
              <div className="row" style={{ marginTop: 18 }}>
                {!owner && found.map((w) => <button key={w.name} className="primary" onClick={() => connectWallet(w.provider)}>Connect {w.name}</button>)}
                {!owner && found.length === 0 && <div className="notice info">Install a Solana wallet (Phantom, Solflare or Backpack) to inscribe.</div>}
                {owner && <button className="primary" disabled={!!busy} onClick={inscribe}>{busy ? `${busy}…` : `Inscribe for ${q && sol(q.totalLamports)} SOL`}</button>}
              </div>
              <p className="muted" style={{ fontSize: 13.5, marginTop: 12, marginBottom: 0 }}>One signature. Once born, a scribe exists for ever — it can be given away, never deleted.</p>
            </>
          )}
        </div>
      )}

      {phase && (
        <div className="panel" style={{ marginTop: 6 }}>
          {phase.phase === 'inscribing' && (
            <>
              <div className="panel-head"><h3>{phase.report.name} is born</h3><span className="muted">{phase.done.toLocaleString()} / {phase.total.toLocaleString()}</span></div>
              <div className="progress"><div style={{ width: `${(100 * phase.done) / Math.max(1, phase.total)}%` }} /></div>
              <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>Writing its files to Solana. You can close this page — it carries on.</p>
            </>
          )}
          {phase.phase === 'done' && (
            <>
              <h3>{phase.report.name} is inscribed</h3>
              <p className="muted">Every file is on Solana. Go and wake it.</p>
              <div className="row">
                <a className="btn primary" href={`#/scribe/${phase.report.scribe}`}>Open {phase.report.name}</a>
                <a className="btn" href={explorer('tx', phase.signature)} target="_blank" rel="noreferrer">Birth transaction</a>
              </div>
            </>
          )}
          {phase.phase === 'failed' && <div className="notice bad">Inscription paused: {phase.error}. It resumes automatically; nothing you paid is lost.</div>}
          {phase.phase === 'awaiting-signature' && <p className="muted">Waiting for the transaction…</p>}
        </div>
      )}
    </div>
  );
}

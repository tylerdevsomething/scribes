import { useEffect, useRef, useState } from 'react';
import { Transaction } from '@solana/web3.js';
import { checkUpload, checkout, newUpload, putPart, submitted, uploadStatus, type CheckReport, type UploadPhase } from '../api.ts';
import { conn, explorer, sol } from '../config.ts';
import { connect, signTransaction, wallets } from '../wallet.ts';

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

export function Create() {
  const [files, setFiles] = useState<Partial<Record<Part, File>>>({});
  const [ignored, setIgnored] = useState<string[]>([]);
  const [hot, setHot] = useState(false);
  const [id, setId] = useState<string | null>(null);
  const [report, setReport] = useState<CheckReport | null>(null);
  const [phase, setPhase] = useState<UploadPhase | null>(null);
  const [owner, setOwner] = useState<string | null>(null);
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
    try { setOwner((await connect(provider)).toBase58()); } catch (e) { setError((e as Error).message); }
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

  return (
    <div className="prose" style={{ maxWidth: 820 }}>
      <h1>Inscribe a scribe</h1>
      <p className="dim">Give your agent the <a href="#/brief">scribe brief</a>: it packages itself into a folder. Drop that folder's files here.</p>

      {!phase && (
        <>
          <div
            className={`drop ${hot ? 'hot' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setHot(true); }}
            onDragLeave={() => setHot(false)}
            onDrop={(e) => { e.preventDefault(); setHot(false); add(e.dataTransfer.files); }}
            onClick={() => pickRef.current?.click()}
          >
            Drop <strong>personality.json</strong>, and either a <strong>.gguf</strong> model or <strong>brain.json</strong>, plus an optional picture.
            <input ref={pickRef} type="file" multiple hidden onChange={(e) => e.target.files && add(e.target.files)} />
          </div>
          <div className="files">
            {(['personality', 'model', 'brain', 'picture'] as Part[]).filter((p) => files[p]).map((p) => (
              <div key={p}><span>{files[p]!.name} <span className="dim">· {p}</span></span><span className="dim">{(files[p]!.size / 1e6).toFixed(2)} MB</span></div>
            ))}
            {ignored.length > 0 && <p className="dim">Not used: {ignored.join(', ')}</p>}
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <button className="primary" disabled={!ready || !!busy} onClick={check}>Check my scribe</button>
            {!ready && <span className="dim">Needs a personality and a brain.</span>}
          </div>
        </>
      )}

      {busy && <p className="dim">{busy}…</p>}
      {error && <p className="bad">{error}</p>}

      {report && !phase && (
        <div className="panel" style={{ marginTop: 18 }}>
          {!report.ok ? (
            <>
              <h3 style={{ marginTop: 0 }}>The bot found problems</h3>
              <ul>{report.problems.map((p) => <li key={p} className="bad">{p}</li>)}</ul>
              <p className="dim">Nothing was charged. Fix the files and check again.</p>
            </>
          ) : (
            <>
              <h3 style={{ marginTop: 0 }}>{report.name} is ready to inscribe</h3>
              {report.attributes && (
                <table className="attrs"><tbody>
                  {Object.entries(report.attributes).filter(([k]) => k !== 'Model').map(([k, v]) => <tr key={k}><td className="dim">{k}</td><td>{v}</td><td /></tr>)}
                </tbody></table>
              )}
              <div className="files">
                {report.files.map((f) => (
                  <div key={f.sha256}><span>{f.name} <span className="dim">· {f.role}</span></span><span className="dim">{f.reused ? 'already on chain — reused' : `${(f.size / 1e6).toFixed(2)} MB`}</span></div>
                ))}
              </div>
              {q && (
                <table className="attrs" style={{ marginTop: 12 }}><tbody>
                  <tr><td>Inscription ({q.chunks.toLocaleString()} transactions)</td><td /><td>{sol(q.inscriptionLamports)} SOL</td></tr>
                  <tr><td>The scribe's on-chain record</td><td /><td>{sol(q.recordRentLamports)} SOL</td></tr>
                  {q.birthFeeLamports > 0 && <tr><td>Birth fee</td><td /><td>{sol(q.birthFeeLamports)} SOL</td></tr>}
                  <tr><td>Network fee</td><td /><td>{sol(q.networkFeeLamports)} SOL</td></tr>
                  <tr><td><strong>Total</strong></td><td /><td><strong>{sol(q.totalLamports)} SOL</strong></td></tr>
                </tbody></table>
              )}
              <div className="row" style={{ marginTop: 14 }}>
                {!owner && found.map((w) => <button key={w.name} onClick={() => connectWallet(w.provider)}>Connect {w.name}</button>)}
                {!owner && found.length === 0 && <span className="dim">Install a Solana wallet (Phantom, Solflare or Backpack) to inscribe.</span>}
                {owner && <button className="primary" disabled={!!busy} onClick={inscribe}>Inscribe for {q && sol(q.totalLamports)} SOL</button>}
              </div>
              <p className="dim" style={{ fontSize: 13 }}>One signature. Scribes are permanent: once born, a scribe can never be deleted.</p>
            </>
          )}
        </div>
      )}

      {phase && (
        <div className="panel" style={{ marginTop: 18 }}>
          {phase.phase === 'inscribing' && (
            <>
              <h3 style={{ marginTop: 0 }}>Born — inscribing its files</h3>
              <p>{phase.done.toLocaleString()} of {phase.total.toLocaleString()} transactions</p>
              <div className="bar"><div style={{ width: `${(100 * phase.done) / Math.max(1, phase.total)}%` }} /></div>
            </>
          )}
          {phase.phase === 'done' && (
            <>
              <h3 style={{ marginTop: 0 }}>{phase.report.name} is inscribed</h3>
              <div className="row">
                <a className="btn primary" href={`#/scribe/${phase.report.scribe}`}>Open {phase.report.name}</a>
                <a className="btn" href={explorer('tx', phase.signature)} target="_blank" rel="noreferrer">Birth transaction</a>
              </div>
            </>
          )}
          {phase.phase === 'failed' && <p className="bad">Inscription stopped: {phase.error}. It resumes when the server restarts; nothing you paid is lost.</p>}
          {phase.phase === 'awaiting-signature' && <p className="dim">Waiting for the transaction…</p>}
        </div>
      )}
    </div>
  );
}

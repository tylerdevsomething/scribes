import { useEffect, useMemo, useRef, useState } from 'react';
import { Transaction } from '@solana/web3.js';
import { checkUpload, checkout, newUpload, putPart, submitted, uploadStatus, type CheckReport, type UploadPhase } from '../api.ts';
import { API, conn, explorer, sol } from '../config.ts';
import { connect, signTransaction, useWallet, wallets } from '../wallet.ts';
import { Sigil } from '../Sigil.tsx';
import { OFFICIAL_TOOLS } from '../../../lib/src/tools.ts';

type Part = 'personality' | 'model' | 'model-ref' | 'brain' | 'picture';
type Parts = Partial<Record<Part, File>>;

const size = (n: number) => (n < 1e6 ? `${(n / 1e3).toFixed(1)} KB` : `${(n / 1e6).toFixed(1)} MB`);
const TOOL_LABELS: Record<string, string> = { calculator: 'Calculator', read_wallet: 'Read a wallet', web_search: 'Web search', propose_transfer: 'Propose transfers' };
const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 — most capable' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — fast and capable' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 — quickest, cheapest' },
];

interface ModelInfo { sha256: string; size: number; fileName: string; name: string | null; parameters: number; scribes: number }

export function Create() {
  const [mode, setMode] = useState<'write' | 'upload'>('write');
  const [parts, setParts] = useState<Parts | null>(null); // set when the user asks for a check
  const [id, setId] = useState<string | null>(null);
  const [report, setReport] = useState<CheckReport | null>(null);
  const [phase, setPhase] = useState<UploadPhase | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function check(p: Parts) {
    setParts(p);
    setError('');
    setReport(null);
    setBusy('Uploading');
    try {
      const { id } = await newUpload();
      for (const [part, f] of Object.entries(p) as [Part, File][]) {
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

  const stage = phase ? 3 : report?.ok ? 2 : 1;
  return (
    <div className="prose" style={{ maxWidth: 900 }}>
      <div className="eyebrow">Inscribe</div>
      <h1>Bring a scribe to life</h1>
      <p className="muted" style={{ fontSize: 17 }}>Write one here in a minute, or drop the folder your agent packaged with the <a href="#/brief">scribe brief</a>.</p>

      <div className="stepper">
        <div className={stage === 1 ? 'on' : 'done'}><i>{stage > 1 ? '✓' : 1}</i>Describe it</div>
        <div className={stage === 2 ? 'on' : stage > 2 ? 'done' : ''}><i>{stage > 2 ? '✓' : 2}</i>Check &amp; sign</div>
        <div className={stage === 3 ? (phase?.phase === 'done' ? 'done' : 'on') : ''}><i>{phase?.phase === 'done' ? '✓' : 3}</i>Inscribed</div>
      </div>

      {!phase && (
        <>
          <div className="seg" style={{ marginBottom: 18 }}>
            <button className={mode === 'write' ? 'on' : ''} onClick={() => setMode('write')}>Write it here</button>
            <button className={mode === 'upload' ? 'on' : ''} onClick={() => setMode('upload')}>Upload files</button>
          </div>
          {mode === 'write' ? <Builder busy={!!busy} onCheck={check} /> : <Uploader busy={!!busy} onCheck={check} />}
        </>
      )}

      {busy && !report && <p className="muted" style={{ marginTop: 14 }}>{busy}…</p>}
      {error && <div className="notice bad" style={{ marginTop: 16 }}>{error}</div>}
      {report && !phase && parts && <Report report={report} id={id!} onPhase={setPhase} />}
      {phase && <Progress phase={phase} id={id!} onPhase={setPhase} />}
    </div>
  );
}

// ---- write a scribe in the browser ----

function Builder({ busy, onCheck }: { busy: boolean; onCheck: (p: Parts) => void }) {
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [voice, setVoice] = useState('');
  const [boundaries, setBoundaries] = useState('');
  const [memory, setMemory] = useState('');
  const [tools, setTools] = useState<string[]>([]);
  const [brain, setBrain] = useState<'existing' | 'claude' | 'own'>('existing');
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [modelSha, setModelSha] = useState('');
  const [claude, setClaude] = useState(CLAUDE_MODELS[0].id);
  const [own, setOwn] = useState<File | null>(null);
  const [picture, setPicture] = useState<File | null>(null);
  const [pictureUrl, setPictureUrl] = useState('');

  useEffect(() => {
    // No inscribed models to reuse (or no answer): start on Claude instead of a disabled choice.
    fetch(`${API}/models`).then((r) => r.json()).then((l: ModelInfo[]) => { setModels(l); if (l[0]) setModelSha(l[0].sha256); else setBrain('claude'); })
      .catch(() => { setModels([]); setBrain('claude'); });
  }, []);
  useEffect(() => {
    if (!picture) { setPictureUrl(''); return; }
    const u = URL.createObjectURL(picture);
    setPictureUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [picture]);

  const brainOk = brain === 'existing' ? !!modelSha : brain === 'own' ? !!own : true;
  const ready = name.trim() && purpose.trim() && voice.trim() && boundaries.trim() && brainOk;

  function submit() {
    const p: Parts = {};
    const pers: Record<string, unknown> = { name: name.trim(), purpose: purpose.trim(), voice: voice.trim(), boundaries: boundaries.trim() };
    if (tools.length) pers.tools = tools;
    const mem = memory.split('\n').map((x) => x.trim()).filter(Boolean);
    if (mem.length) pers.memory = mem;
    p.personality = new File([JSON.stringify(pers, null, 2)], 'personality.json', { type: 'application/json' });
    if (brain === 'existing') p['model-ref'] = new File([modelSha], 'model-ref.txt');
    else if (brain === 'claude') p.brain = new File([JSON.stringify({ kind: 'bound', provider: 'anthropic', model: claude })], 'brain.json');
    else if (own) p.model = own;
    if (picture) p.picture = picture;
    onCheck(p);
  }

  const chosen = models?.find((m) => m.sha256 === modelSha);
  return (
    <div className="builder">
      <div className="form">
        <label className="field"><span>Name</span>
          <input maxLength={64} placeholder="e.g. Mott" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field"><span>Purpose <em>what it is for</em></span>
          <textarea rows={2} maxLength={4000} placeholder="Keeps the lighthouse burning and tells visitors about the sea." value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        </label>
        <label className="field"><span>Voice <em>how it talks</em></span>
          <textarea rows={2} maxLength={4000} placeholder="Short, salty sentences. Distrusts anything shiny. Secretly kind." value={voice} onChange={(e) => setVoice(e.target.value)} />
        </label>
        <label className="field"><span>Boundaries <em>rules it never breaks</em></span>
          <textarea rows={2} maxLength={4000} placeholder="Never gives financial advice. Never pretends to be a person." value={boundaries} onChange={(e) => setBoundaries(e.target.value)} />
        </label>
        <label className="field"><span>Memory <em>optional · one per line</em></span>
          <textarea rows={2} placeholder="The storm of 1987." value={memory} onChange={(e) => setMemory(e.target.value)} />
        </label>

        <div className="field"><span>Brain</span>
          <div className="choices">
            <label className={brain === 'existing' ? 'on' : ''}><input type="radio" checked={brain === 'existing'} onChange={() => setBrain('existing')} disabled={!models?.length} />
              <b>A model already on Scribes</b><small>Inscribed, runs in any browser. Reused, so almost free.</small></label>
            <label className={brain === 'claude' ? 'on' : ''}><input type="radio" checked={brain === 'claude'} onChange={() => setBrain('claude')} />
              <b>Claude</b><small>Bound brain: smartest, uses tools. Whoever wakes it brings their own API key.</small></label>
            <label className={brain === 'own' ? 'on' : ''}><input type="radio" checked={brain === 'own'} onChange={() => setBrain('own')} />
              <b>Upload my own model</b><small>An open .gguf you may redistribute. First to use it gets the Autograph.</small></label>
          </div>
          {brain === 'existing' && (models?.length
            ? <select value={modelSha} onChange={(e) => setModelSha(e.target.value)} style={{ marginTop: 10, width: '100%' }}>
                {models.map((m) => <option key={m.sha256} value={m.sha256}>{m.name ?? m.fileName} · {(m.parameters / 1e6).toFixed(m.parameters < 1e7 ? 1 : 0)}M · used by {m.scribes}</option>)}
              </select>
            : <p className="muted" style={{ fontSize: 13.5 }}>No inscribed models yet.</p>)}
          {brain === 'claude' && (
            <select value={claude} onChange={(e) => setClaude(e.target.value)} style={{ marginTop: 10, width: '100%' }}>
              {CLAUDE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          )}
          {brain === 'own' && <input type="file" accept=".gguf" style={{ marginTop: 10 }} onChange={(e) => setOwn(e.target.files?.[0] ?? null)} />}
        </div>

        <div className="field"><span>Tools <em>{brain === 'claude' ? 'what it can use' : 'used when the brain is Claude'}</em></span>
          <div className="toggles">
            {OFFICIAL_TOOLS.map((t) => (
              <label key={t} className={tools.includes(t) ? 'on' : ''}>
                <input type="checkbox" checked={tools.includes(t)} onChange={(e) => setTools(e.target.checked ? [...tools, t] : tools.filter((x) => x !== t))} />{TOOL_LABELS[t]}
              </label>
            ))}
          </div>
        </div>

        <label className="field"><span>Picture <em>optional · re-encoded to a small WebP</em></span>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setPicture(e.target.files?.[0] ?? null)} />
        </label>

        <button className="primary" disabled={!ready || busy} onClick={submit}>Check my scribe</button>
        {!ready && <span className="muted" style={{ fontSize: 13.5, marginLeft: 10 }}>Name, purpose, voice, boundaries and a brain.</span>}
      </div>

      <aside className="preview">
        <div className="eyebrow">Preview</div>
        <div className="card">
          <div className="art">{pictureUrl ? <img src={pictureUrl} alt="" /> : <Sigil seed={name || 'scribe'} letter={(name.trim()[0] ?? '?').toUpperCase()} />}</div>
          <div className="body">
            <div className="name">{name.trim() || 'Your scribe'}</div>
            <div className="sub">{brain === 'claude' ? `Bound to ${claude}` : brain === 'existing' ? (chosen ? `${chosen.name ?? chosen.fileName}` : 'Inscribed model') : own ? own.name : 'Your model'}</div>
            <div className="badges">
              {brain !== 'claude' && <span className="chip teal">Fully on-chain</span>}
              {tools.length > 0 && <span className="chip">{tools.length} tool{tools.length > 1 ? 's' : ''}</span>}
            </div>
          </div>
        </div>
        {purpose.trim() && <p className="purpose" style={{ marginTop: 12 }}>{purpose.trim()}</p>}
        <p className="muted" style={{ fontSize: 13 }}>Everything you write here is public and permanent. Never include secrets.</p>
      </aside>
    </div>
  );
}

// ---- upload a packaged folder ----

function partOf(f: File): Part | null {
  const n = f.name.toLowerCase();
  if (n.endsWith('.gguf')) return 'model';
  if (n === 'brain.json') return 'brain';
  if (n.endsWith('.json')) return 'personality';
  if (f.type.startsWith('image/')) return 'picture';
  return null;
}

function Uploader({ busy, onCheck }: { busy: boolean; onCheck: (p: Parts) => void }) {
  const [files, setFiles] = useState<Parts>({});
  const [ignored, setIgnored] = useState<string[]>([]);
  const [hot, setHot] = useState(false);
  const pickRef = useRef<HTMLInputElement>(null);
  function add(list: FileList | File[]) {
    const next = { ...files };
    const skipped: string[] = [];
    for (const f of Array.from(list)) { const p = partOf(f); if (p) next[p] = f; else skipped.push(f.name); }
    if (next.model && next.brain) delete next.brain;
    setFiles(next);
    setIgnored(skipped);
  }
  const brainFile = files.model ?? files.brain;
  const ready = !!files.personality && !!brainFile;
  return (
    <>
      <div className={`drop ${hot ? 'hot' : ''}`} onClick={() => pickRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setHot(true); }} onDragLeave={() => setHot(false)}
        onDrop={(e) => { e.preventDefault(); setHot(false); add(e.dataTransfer.files); }}>
        <div className="big">Drop your scribe's files here</div>
        <div className="small">or click to choose them</div>
        <input ref={pickRef} type="file" multiple hidden onChange={(e) => e.target.files && add(e.target.files)} />
      </div>
      <div className="slots">
        <div className={`slot ${files.personality ? 'filled' : ''}`}><div className="k">Personality · required</div>{files.personality ? <div className="v">{files.personality.name}</div> : <div className="h">personality.json</div>}</div>
        <div className={`slot ${brainFile ? 'filled' : ''}`}><div className="k">Brain · required</div>{brainFile ? <div className="v">{brainFile.name} <span className="h">{size(brainFile.size)}</span></div> : <div className="h">a .gguf model, or brain.json</div>}</div>
        <div className={`slot ${files.picture ? 'filled' : ''}`}><div className="k">Picture · optional</div>{files.picture ? <div className="v">{files.picture.name}</div> : <div className="h">PNG, JPEG or WebP</div>}</div>
      </div>
      {ignored.length > 0 && <p className="muted" style={{ marginTop: 10, fontSize: 13.5 }}>Not used: {ignored.join(', ')}</p>}
      <div className="row" style={{ marginTop: 18 }}>
        <button className="primary" disabled={!ready || busy} onClick={() => onCheck(files)}>Check my scribe</button>
        {!ready && <span className="muted" style={{ fontSize: 14 }}>Add a personality and a brain to continue.</span>}
      </div>
    </>
  );
}

// ---- the bot's report, the price, and the one signature ----

function Report({ report, id, onPhase }: { report: CheckReport; id: string; onPhase: (p: UploadPhase) => void }) {
  const owner = useWallet();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const q = report.quote;
  const found = useMemo(() => wallets(), []);

  async function inscribe() {
    if (!owner) return;
    setError('');
    try {
      setBusy('Preparing the transaction');
      const { tx } = await checkout(id, owner);
      setBusy('Approve it in your wallet');
      const signed = await signTransaction(Transaction.from(Uint8Array.from(atob(tx), (c) => c.charCodeAt(0))));
      setBusy('Sending');
      const sig = await conn.sendRawTransaction(signed.serialize());
      setBusy('Waiting for Solana to confirm');
      onPhase(await submitted(id, sig));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  return (
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
            {!owner && found.map((w) => <button key={w.name} className="primary" onClick={() => connect(w.provider).catch((e) => setError(e.message))}>Connect {w.name}</button>)}
            {!owner && found.length === 0 && <div className="notice info">Install a Solana wallet (Phantom, Solflare or Backpack) to inscribe.</div>}
            {owner && <button className="primary" disabled={!!busy} onClick={inscribe}>{busy ? `${busy}…` : `Inscribe for ${q && sol(q.totalLamports)} SOL`}</button>}
          </div>
          <p className="muted" style={{ fontSize: 13.5, marginTop: 12, marginBottom: 0 }}>One signature. Once born, a scribe exists for ever — it can be given away, never deleted.</p>
        </>
      )}
      {error && <div className="notice bad" style={{ marginTop: 12 }}>{error}</div>}
    </div>
  );
}

function Progress({ phase, id, onPhase }: { phase: UploadPhase; id: string; onPhase: (p: UploadPhase) => void }) {
  useEffect(() => {
    if (phase.phase === 'done' || phase.phase === 'failed') return;
    const t = setInterval(() => uploadStatus(id).then(onPhase).catch(() => {}), 1500);
    return () => clearInterval(t);
  }, [id, phase, onPhase]);
  return (
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
  );
}

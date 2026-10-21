import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Transaction } from '@solana/web3.js';
import { checkUpload, checkout, getScribe, newUpload, putPart, submitted, uploadStatus, type CheckReport, type ScribeView, type UploadPhase } from '../api.ts';
import { burnBalance, burnToVerify, runChecks, tokens } from './Verify.tsx';
import { VerifiedMark } from '../Figure.tsx';
import { API, CLUSTER, conn } from '../config.ts';
import { currentAddress, ensureWallet, signTransaction, useWallet } from '../wallet.ts';
import { Sigil } from '../Sigil.tsx';
import { Folio } from '../Hero.tsx';
import { Figure } from '../Figure.tsx';
import { ToolPicker } from '../ToolPicker.tsx';
import { PROVIDERS, type Provider } from '../../../lib/src/hybrid.ts';
import { PAGE_TOOLS, PAGE_TOOLS_MIN_PARAMS } from '../../../lib/src/tools.ts';

type Part = 'personality' | 'model' | 'model-ref' | 'brain' | 'picture';
type Parts = Partial<Record<Part, File>>;

const size = (n: number) => (n < 1e6 ? `${(n / 1e3).toFixed(1)} KB` : `${(n / 1e6).toFixed(1)} MB`);

import type { ModelInfo } from './Models.tsx';
import { useSettings } from '../settings.ts';
import { DEFAULT_BRIEF, writeBrief } from '../brief.ts';
import { InscribeWindow, type Drive } from '../InscribeWindow.tsx';

export function Create({ model }: { model?: string } = {}) {
  const [path, setPath] = useState<Path>('model');
  // verifying needs a born scribe, so it is chosen here and offered once the birth is done
  const [verifyWanted, setVerifyAfter] = useState(true);
  // until the $SCRIBE token exists (mainnet before launch) verification is closed: no verify step at all
  const verifyOpen = !!useSettings()?.verificationOpen;
  const verifyAfter = verifyWanted && verifyOpen;
  const [parts, setParts] = useState<Parts | null>(null); // set when the user asks for a check
  const [id, setId] = useState<string | null>(null);
  const [report, setReport] = useState<CheckReport | null>(null);
  const [phase, setPhase] = useState<UploadPhase | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  // the inscribe window: open from the click on inscribe until it is closed; the name and purpose it shows
  const [win, setWin] = useState(false);
  const [who, setWho] = useState({ name: '', purpose: '' });
  const settings = useSettings();

  // what the window calls: the same checkout, record and verification calls as before
  const drive = useMemo<Drive>(() => ({
    async sign() {
      const me = currentAddress() ?? await ensureWallet();
      if (!id) throw new Error('the files are not uploaded yet');
      const { tx } = await checkout(id, me);
      const signed = await signTransaction(Transaction.from(Uint8Array.from(atob(tx), (c) => c.charCodeAt(0))));
      const sig = await conn.sendRawTransaction(signed.serialize());
      const p = await submitted(id, sig);
      setPhase(p);
      return p;
    },
    scribe: getScribe,
    checks: runChecks,
    burn: (me, address, pass) => burnToVerify(me, address, pass, settings!),
    balance: (me) => burnBalance(me, settings!),
  }), [id, settings]);

  // development only: #/create?demo plays the window through a made up inscription of pip (?demo=gold verifies too)
  const demo = import.meta.env.DEV && /[?&]demo/.test(location.hash) ? (/demo=gold/.test(location.hash) ? 'gold' : 'plain') : null;
  const [demoKit, setDemoKit] = useState<{ drive: Drive; wallet: string } | null>(null);
  useEffect(() => {
    if (!demo) return;
    import('../inscribeDemo.ts').then(({ demoDrive, demoReport, DEMO_WALLET }) => {
      setDemoKit({ drive: demoDrive(setPhase), wallet: DEMO_WALLET });
      sessionStorage.setItem('scribes-demo', '1');
      setWho({ name: 'pip', purpose: 'tell tiny crypto fables: coins, wallets, whales and the little creatures who live on the chain.' });
      setWin(true); setBusy('checking'); setTimeout(() => { setReport(demoReport); setBusy(''); }, 1300);
    });
  }, [demo]);

  // the inscription is followed while it writes, whether the window is open or not
  useEffect(() => {
    if (demo || !id || !phase || phase.phase === 'done' || phase.phase === 'failed') return;
    const t = setInterval(() => uploadStatus(id).then(setPhase).catch(() => {}), 1500);
    return () => clearInterval(t);
  }, [id, phase]);

  async function check(p: Parts) {
    // the inscribe button connects a wallet first when none is connected
    if (!demo && !currentAddress()) {
      try { await ensureWallet(); } catch (e) { setError((e as Error).message); return; }
    }
    setParts(p);
    setError('');
    setReport(null);
    setWin(true);
    // the window shows the name and purpose as typed, read from the personality file
    try { const j = p.personality ? JSON.parse(await p.personality.text()) : {}; setWho({ name: j.name ?? '', purpose: j.purpose ?? '' }); } catch { setWho({ name: '', purpose: '' }); }
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

  return (
    <Folio className="folio-hero stage">
      <div className="scene scene-explore-head"><h1 className="hero-title">inscribe an ai agent</h1></div>
      <div className={`scene scene-create${path === 'hybrid' ? ' hybrid' : ''}`}>
        <div className="create-col">
          {/* the form stays under the window the whole time, so closing the window always shows what was typed */}
          {path === 'folder'
            ? <Uploader busy={!!busy} onCheck={check} ways={<Ways path={path} onPath={setPath} />} verify={verifyAfter} onVerify={setVerifyAfter} />
            : <Builder key={path} own={path === 'own'} hybrid={path === 'hybrid'} model={model} busy={!!busy} onCheck={check} verify={verifyAfter} onVerify={setVerifyAfter} ways={<Ways path={path} onPath={setPath} />} />}
          {!win && phase && <button className="stamp" style={{ marginTop: 16 }} onClick={() => setWin(true)}>{(who.name || 'your scribe').toLowerCase()} {phase.phase === 'done' ? 'is inscribed, open' : 'is being inscribed, open'}</button>}
          {!win && error && <div className="notice bad" style={{ marginTop: 16 }}>{error}</div>}
          {win && (
            <InscribeWindow name={report?.name ?? who.name} purpose={who.purpose} checking={!!busy} error={error} report={report} phase={phase}
              verify={demo ? demo === 'gold' : verifyAfter} drive={demoKit?.drive ?? drive} onClose={() => setWin(false)}
              wallet={demoKit?.wallet} amountLabel={demo ? '50,000' : undefined} />
          )}
        </div>
      </div>
    </Folio>
  );
}

// section 1, the ai model: two tiers. full inscription puts the model itself on solana (three ways to
// choose it, the same size side by side); hybrid inscribes the agent and binds it to claude or grok
type Path = 'model' | 'own' | 'folder' | 'hybrid';
const PICKED = <svg className="picked" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><rect width="20" height="20" fill="currentColor" /><path d="M5 10.5l3.4 3.4L15 7.2" fill="none" stroke="var(--paper)" strokeWidth="2.6" strokeLinecap="square" /></svg>;
function Ways({ path, onPath }: { path: Path; onPath: (p: Path) => void }) {
  const way = (k: Path, t: string, d: string) => <button type="button" role="radio" aria-checked={path === k} className={`way-card${path === k ? ' on' : ''}`} onClick={() => onPath(k)}>{path === k && <i className="corner-tick" aria-hidden="true" />}<b>{t}</b><span>{d}</span></button>;
  const hybrid = path === 'hybrid';
  const tier = (on: boolean, to: Path, t: string, d: string) => (
    <button type="button" role="radio" aria-checked={on} className={`tier-card${on ? ' on' : ''}`} onClick={() => { if (!on) onPath(to); }}>
      {on && <i className="corner-tick" aria-hidden="true" />}<b>{t}</b><span>{d}</span>
    </button>
  );
  return (
    <>
      <h3 className="sec-head"><i>1</i>model<Info text="what your scribe thinks with. full inscription: the model itself is written to solana and runs in the visitor's browser, with no server at all. the first scribe born on an inscribed model holds that model's autograph and earns a royalty each time another scribe is born on it. hybrid: your agent is inscribed and thinks with claude or grok. visitors get free messages each day, or use their own key." /></h3>
      <div className="tier-cards" role="radiogroup" aria-label="tier">
        {tier(!hybrid, 'model', 'full inscription', 'every byte on solana. the model runs in the browser.')}
        {tier(hybrid, 'hybrid', 'hybrid inscription', 'the agent is on solana. it thinks with a hosted model.')}
      </div>
      {!hybrid && (
        <div className="way-cards" role="radiogroup" aria-label="model">
          {way('model', 'already inscribed', 'a model on solana')}
          {way('own', 'your own model', 'upload a .gguf')}
          {way('folder', 'packaged folder', 'your agent can make one')}
        </div>
      )}
    </>
  );
}

// ---- write a scribe in the browser ----

// The inscribed models are asked for once, as soon as the site opens, so the inscribe page has them ready
let models_: Promise<ModelInfo[]> | null = null;
export const modelList = () => (models_ ??= fetch(`${API}/models`).then((r) => r.json()).catch((e) => { models_ = null; throw e; }));
if (typeof window !== 'undefined') modelList().catch(() => {});

const params = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)}M`);
// A plain-words idea of what a model of this size is good for.
function modelHint(n: number): string {
  if (n < 50e6) return 'Tiny: a toy for testing, short odd stories.';
  if (n < 400e6) return 'Small and quick: short chats and stories.';
  return 'The best on-chain brain so far: follows instructions, holds a conversation.';
}

function Builder({ own: ownPath, hybrid, model, busy, onCheck, verify, onVerify, ways }: { own: boolean; hybrid: boolean; model?: string; busy: boolean; onCheck: (p: Parts) => void; verify: boolean; onVerify: (v: boolean) => void; ways: ReactNode }) {
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [voice, setVoice] = useState('');
  const [boundaries, setBoundaries] = useState('');
  const [memory, setMemory] = useState('');
  const [tools, setTools] = useState<string[]>([]);
  const brain: 'existing' | 'hybrid' | 'own' = hybrid ? 'hybrid' : ownPath ? 'own' : 'existing';
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [modelSha, setModelSha] = useState('');
  const [provider, setProvider] = useState<Provider>('anthropic');
  const [hosted, setHosted] = useState(PROVIDERS.anthropic.models[0].id);
  const [own, setOwn] = useState<File | null>(null);
  const [picture, setPicture] = useState<File | null>(null);
  const [extra, setExtra] = useState(false);
  const [hot, setHot] = useState(false);
  const pic = useRef<HTMLInputElement>(null);
  const [pictureUrl, setPictureUrl] = useState('');

  useEffect(() => {
    modelList().then((l: ModelInfo[]) => {
      // Largest first: the most capable model is the default (or the one asked for in the link).
      const sorted = [...l].sort((a, b) => b.parameters - a.parameters);
      setModels(sorted);
      const pick = sorted.find((m) => m.sha256 === model) ?? sorted[0];
      if (pick) setModelSha(pick.sha256);
    })
      .catch(() => setModels([]));
  }, []);
  useEffect(() => {
    if (!picture) { setPictureUrl(''); return; }
    const u = URL.createObjectURL(picture);
    setPictureUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [picture]);

  // an inscribed model gets the read-only tools the page runs for it, if it is large enough to use them
  const picked = models?.find((m) => m.sha256 === modelSha);
  const pageTools = ownPath || (!hybrid && !!picked && picked.parameters >= PAGE_TOOLS_MIN_PARAMS);
  const showTools = hybrid || pageTools;
  const brainOk = brain === 'existing' ? !!modelSha : brain === 'own' ? !!own : true;
  const ready = name.trim() && purpose.trim() && voice.trim() && boundaries.trim() && brainOk;

  function submit() {
    const p: Parts = {};
    const pers: Record<string, unknown> = { name: name.trim(), purpose: purpose.trim(), voice: voice.trim(), boundaries: boundaries.trim() };
    const kept = hybrid ? tools : pageTools ? tools.filter((t) => PAGE_TOOLS.includes(t)) : [];
    if (kept.length) pers.tools = kept;
    const mem = memory.split('\n').map((x) => x.trim()).filter(Boolean);
    if (mem.length) pers.memory = mem;
    p.personality = new File([JSON.stringify(pers, null, 2)], 'personality.json', { type: 'application/json' });
    if (brain === 'existing') p['model-ref'] = new File([modelSha], 'model-ref.txt');
    else if (brain === 'hybrid') p.brain = new File([JSON.stringify({ kind: 'bound', provider, model: hosted })], 'brain.json');
    else if (own) p.model = own;
    if (picture) p.picture = picture;
    onCheck(p);
  }

  const settings = useSettings();
  const [left, setLeft] = useState<string[]>([]);
  const state = (k: string, v: string) => (v.trim() ? 'filled' : left.includes(k) ? 'missing' : '');
  const leave = (k: string) => () => setLeft((l) => (l.includes(k) ? l : [...l, k]));
  const split = (n: string) => { const m = /^(\S*?)[\s-]+(.*)$/.exec(n); return m ? [m[1], m[2]] : [n, '']; };
  const TICK = <svg className="picked" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><rect width="20" height="20" fill="currentColor" /><path d="M5 10.5l3.4 3.4L15 7.2" fill="none" stroke="var(--paper)" strokeWidth="2.6" strokeLinecap="square" /></svg>;
  const Sec = ({ n, t, info }: { n: number; t: string; info?: string }) => <h3 className="sec-head"><i>{n}</i>{t}{info && <Info text={info} />}</h3>;
  return (
    <div className="builder">
      <div className="form">
        {ways}
        {hybrid ? (
          <>
            {/* the provider, then its models: the choice is all that is inscribed */}
            <div className="model-row">
              {(Object.keys(PROVIDERS) as Provider[]).map((k) => {
                const on = provider === k;
                return <button type="button" key={k} className={on ? 'on' : ''} onClick={() => { setProvider(k); setHosted(PROVIDERS[k].models[0].id); }}>{on && <i className="corner-tick" aria-hidden="true" />}<b>{PROVIDERS[k].name.toLowerCase()}</b><small>{k === 'anthropic' ? 'by anthropic' : 'by xai'}</small></button>;
              })}
            </div>
            <div className="model-row sub">
              {PROVIDERS[provider].models.map((m) => {
                const on = hosted === m.id;
                return <button type="button" key={m.id} className={on ? 'on' : ''} onClick={() => setHosted(m.id)}>{on && <i className="corner-tick" aria-hidden="true" />}<b>{m.short.toLowerCase()}</b><small>{m.hint.toLowerCase()}</small></button>;
              })}
            </div>
          </>
        ) : ownPath ? (
          <label className={`pic-drop${own ? ' filled' : ''}`}>
            <b>{own ? own.name.toLowerCase() : 'drop your .gguf model here, or click to choose'}</b>
            <span>{own ? `${size(own.size).toLowerCase()}, click to choose another` : 'an open model you are free to share'}</span>
            <input type="file" hidden accept=".gguf" onChange={(e) => setOwn(e.target.files?.[0] ?? null)} />
          </label>
        ) : (
          <>
            <div className="model-row">
              {/* the tiles keep their places while the models load, so nothing jumps in later */}
              {!models && [0, 1, 2].map((i) => <button type="button" key={i} className="ghost" disabled aria-hidden="true"><b>&nbsp;</b><small>&nbsp;</small></button>)}
              {models?.map((m) => {
                const [t, rest] = split((m.name ?? m.fileName.replace(/\.gguf$/i, '')).toLowerCase()), on = modelSha === m.sha256;
                return <button type="button" key={m.sha256} className={on ? 'on' : ''} onClick={() => setModelSha(m.sha256)}>{on && <i className="corner-tick" aria-hidden="true" />}<b>{t}</b><small>{rest || size(m.size).toLowerCase()}</small></button>;
              })}
            </div>
          </>
        )}

        <Sec n={2} t="details" />
        <div className="row2">
          <label className={`field ${state('name', name)}`}><span>name <em>(what people call it)</em></span>
            <input maxLength={64} placeholder="waymark" value={name} onChange={(e) => setName(e.target.value)} onBlur={leave('name')} />
          </label>
          <label className={`field ${state('purpose', purpose)}`}><span>purpose <em>(what it is for)</em></span>
            <input maxLength={4000} placeholder="maps any solana wallet and explains where its tokens came from" value={purpose} onChange={(e) => setPurpose(e.target.value)} onBlur={leave('purpose')} />
          </label>
        </div>
        <label className={`field ${state('voice', voice)}`}><span>voice <em>(how it talks)</em></span>
          <textarea rows={2} maxLength={4000} placeholder="clear and friendly, short answers, shows the numbers" value={voice} onChange={(e) => setVoice(e.target.value)} onBlur={leave('voice')} />
        </label>
        <label className={`field ${state('boundaries', boundaries)}`}><span>boundaries <em>(rules it never breaks)</em></span>
          <textarea rows={2} maxLength={4000} placeholder="never asks for a seed phrase, never moves anyone's funds" value={boundaries} onChange={(e) => setBoundaries(e.target.value)} onBlur={leave('boundaries')} />
        </label>

        {/* hybrid: every tool. an inscribed model large enough: the read-only tools the page runs for it. its own step, after details */}
        {showTools && (
          <>
            <Sec n={3} t="tools" info="the tools are built into the scribes program, so they are your agent's shortcuts and its guardrails. it can only look things up and draft actions through the tools you pick here, and nothing that moves funds happens until the visitor approves it in their own wallet." />
            <ToolPicker value={tools} onChange={setTools} only={hybrid ? undefined : PAGE_TOOLS} />
          </>
        )}

        <Sec n={showTools ? 4 : 3} t="image" />
        <div className={`pic-drop${hot ? ' hot' : ''}${picture ? ' filled' : ''}`} onClick={() => pic.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setHot(true); }} onDragLeave={() => setHot(false)}
          onDrop={(e) => { e.preventDefault(); setHot(false); const f = e.dataTransfer.files?.[0]; if (f) setPicture(f); }}>
          {pictureUrl ? <><img className="pic-fill" src={pictureUrl} alt="" /><button type="button" className="pic-clear" aria-label="Remove the image" onClick={(e) => { e.stopPropagation(); setPicture(null); if (pic.current) pic.current.value = ''; }} /></> : <><b>drop an image, or click to choose</b><span>optional</span></>}
          <input ref={pic} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => setPicture(e.target.files?.[0] ?? null)} />
        </div>

        <VerifyStep n={showTools ? 5 : 4} verify={verify} onVerify={onVerify} />

        <div className="create-go">
          <button className={`stamp go${ready ? ' ready' : ''}${verify ? ' gold' : ''}`} disabled={!ready || busy} onClick={submit}>inscribe</button>
        </div>
      </div>

      <aside className="preview">
        <div className="preview-label">preview<Info text="no image? your scribe gets its own dot matrix portrait, drawn from its address at birth. the figure here is only an example." /></div>
        <div className={`card${verify ? ' verified' : ''}`}>
          <i className="card-rule" />
          <div className="art">{pictureUrl ? <img src={pictureUrl} alt="" /> : <Figure seed="waymark" n={0} bare />}</div>
          <div className="body">
            <div className="name">{(name.trim() || 'waymark').toLowerCase()}{verify && <VerifiedMark />}</div>
            <div className="purpose-line">{(purpose.trim() || 'maps any solana wallet and explains where its tokens came from').toLowerCase()}</div>
          </div>
        </div>
      </aside>
    </div>
  );
}

// stand in minimum until the real token launches: devnet's config burns 10 of a test mint, which means
// nothing beside a 1 billion supply. On mainnet the program's set amount is the minimum
const DEFAULT_BURN = 50_000;

// the verify step: an on and off switch, gold when on, and the $scribe it burns. The program burns exactly its
// set amount, so the box shows that amount and cannot be changed. Its room is always kept, so nothing below it
// moves when the switch flips
function VerifyStep({ n, verify, onVerify }: { n: number; verify: boolean; onVerify: (v: boolean) => void }) {
  const settings = useSettings();
  const amount = CLUSTER === 'mainnet' && settings?.burnAmount ? Number(tokens(settings.burnAmount, settings).replace(/,/g, '')) : DEFAULT_BURN;
  if (!settings?.verificationOpen) return null;
  return (
    <>
      <h3 className="sec-head"><i>{n}</i><span className="gold-text">verify</span><VerifiedMark size={18} /><Info text={`you pay in two parts. first the inscription fee in sol, shown in full before you sign. then, once your scribe is born, the verification bot runs it and verifies every file, and you burn ${amount.toLocaleString()} $scribe in a second signature. the record is marked verified permanently and the burned tokens are gone for good.`} /></h3>
      <button type="button" role="switch" aria-checked={verify} className={`verify-toggle${verify ? ' on' : ''}`} onClick={() => onVerify(!verify)}>
        <span className="switch" aria-hidden="true" />
        <span><b>verification <em>(every file verified against its hash, then shown first in browse)</em></b></span>
      </button>
      <div className={`burn-field${verify ? '' : ' off'}`} aria-hidden={!verify}>
        <div className="amount-box">
          <input value={amount.toLocaleString()} readOnly tabIndex={-1} aria-label="$scribe burned" />
          <span><img src="/favicon.svg?v=4" alt="" />$scribe</span>
        </div>
        <small className="burn-note">you burn {amount.toLocaleString()} $scribe in a second signature once your scribe is born.<br />this is on top of the sol inscription fee.</small>
      </div>
    </>
  );
}

// a small info mark beside a label: hover or tap it to read the note
export function Info({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const pop = useRef<HTMLSpanElement>(null);
  // keep the popup inside the frame's scrolling page (it clips anything past its edges), however narrow the window
  useLayoutEffect(() => {
    const el = pop.current;
    if (!open || !el) return;
    el.style.transform = '';
    const box = (el.closest('.pf-dock, .folio-body') ?? document.body).getBoundingClientRect(); // inside the chat window when it is in one
    const r = el.getBoundingClientRect();
    const pad = 12;
    const dx = r.right > box.right - pad ? box.right - pad - r.right : r.left < box.left + pad ? box.left + pad - r.left : 0;
    if (dx) el.style.transform = `translateX(${dx}px)`;
  }, [open]);
  return (
    <span className="info" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-label="more about this" aria-expanded={open} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }} onBlur={() => setOpen(false)}>i</button>
      {open && <span ref={pop} className="info-pop" role="tooltip">{text}</span>}
    </span>
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

function Uploader({ busy, onCheck, ways, verify, onVerify }: { busy: boolean; onCheck: (p: Parts) => void; ways: ReactNode; verify: boolean; onVerify: (v: boolean) => void }) {
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
  const [copied, setCopied] = useState(false);
  // the brief with an open model only: the inscribe form no longer offers claude
  const brief = () => writeBrief({ ...DEFAULT_BRIEF, brain: 'open' });
  const copyBrief = () => navigator.clipboard.writeText(brief()).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); });
  const downloadBrief = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([brief()], { type: 'text/markdown' }));
    a.download = 'scribe-brief.md';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  // the preview reads the folder's personality.json and image, so it sits top right just as on the other paths
  const [who, setWho] = useState<{ name?: string; purpose?: string }>({});
  const [imageUrl, setImageUrl] = useState('');
  useEffect(() => {
    if (!files.personality) { setWho({}); return; }
    files.personality.text().then((t) => { try { const j = JSON.parse(t); setWho({ name: String(j.name ?? ''), purpose: String(j.purpose ?? '') }); } catch { setWho({}); } });
  }, [files.personality]);
  useEffect(() => {
    if (!files.picture) { setImageUrl(''); return; }
    const u = URL.createObjectURL(files.picture);
    setImageUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [files.picture]);
  return (
    <div className="builder">
      <div className="form">
      {ways}
      {/* step 2 is only the brief: get it and give it to your agent. step 3 is dropping in what it makes */}
      <h3 className="sec-head"><i>2</i>the scribe brief</h3>
      <div className="brief-get">
        <p>download the scribe brief and give it to your ai agent. it writes personality.json and packs your scribe's folder.</p>
        <div className="brief-buttons">
          <button type="button" className="show-all on" onClick={downloadBrief}>download brief</button>
          <button type="button" className={`show-all${copied ? ' on' : ''}`} onClick={copyBrief}>{copied && <i className="corner-tick" aria-hidden="true" />}{copied ? 'copied' : 'copy brief'}</button>
          <a className="show-all brief-read" href="#/brief" target="_blank" rel="noopener">read brief</a>
        </div>
      </div>
      <h3 className="sec-head"><i>3</i>your folder</h3>
      <div className={`drop ${hot ? 'hot' : ''}`} onClick={() => pickRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setHot(true); }} onDragLeave={() => setHot(false)}
        onDrop={(e) => { e.preventDefault(); setHot(false); add(e.dataTransfer.files); }}>
        <div className="big">drop your scribe's files here</div>
        <div className="small">or click to choose them</div>
        <input ref={pickRef} type="file" multiple hidden onChange={(e) => e.target.files && add(e.target.files)} />
      </div>
      {/* what the folder must hold: red until it is there, blue once it is */}
      <ul className="needs">
        <li className={files.personality ? 'have' : 'must'}>personality.json{files.personality ? '' : ', required'}</li>
        <li className={brainFile ? 'have' : 'must'}>{brainFile ? brainFile.name.toLowerCase() : 'a .gguf model, required'}</li>
        <li className={`opt${files.picture ? ' have' : ''}`}>{files.picture ? files.picture.name.toLowerCase() : 'an image, optional'}</li>
      </ul>
      {ignored.length > 0 && <p className="sec-line">not used: {ignored.join(', ').toLowerCase()}</p>}
      <VerifyStep n={4} verify={verify} onVerify={onVerify} />
      <div className="create-go">
        <button className={`stamp go${ready ? ' ready' : ''}${verify ? ' gold' : ''}`} disabled={!ready || busy} onClick={() => onCheck(files)}>inscribe</button>
      </div>
      </div>

      <aside className="preview">
        <div className="preview-label">preview<Info text="no image? your scribe gets its own dot matrix portrait, drawn from its address at birth. the figure here is only an example." /></div>
        <div className={`card${verify ? ' verified' : ''}`}>
          <i className="card-rule" />
          <div className="art">{imageUrl ? <img src={imageUrl} alt="" /> : <Figure seed="waymark" n={0} bare />}</div>
          <div className="body">
            <div className="name">{(who.name?.trim() || 'waymark').toLowerCase()}{verify && <VerifiedMark />}</div>
            <div className="purpose-line">{(who.purpose?.trim() || 'maps any solana wallet and explains where its tokens came from').toLowerCase()}</div>
          </div>
        </div>
      </aside>
    </div>
  );
}



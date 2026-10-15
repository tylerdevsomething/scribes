import { useEffect, useRef, useState } from 'react';
import { readFile } from '../../../lib/src/chain.ts';
import { decodeUtf8 } from '../../../lib/src/bytes.ts';
import { decodeManifest, parseLink, type Manifest } from '../../../lib/src/manifest.ts';
import { parsePersonality, systemPrompt, type Personality } from '../../../lib/src/personality.ts';
import { ATTRIBUTES, type Attribute } from '../../../lib/src/rarity.ts';
import { getScribe, type ScribeView } from '../api.ts';
import { conn, explorer, short } from '../config.ts';
import { Badges, Capsule, Portrait, brainLine } from './Gallery.tsx';
import type { Brain, Turn } from '../run/brain.ts';
import { loadInscribed, type Step } from '../run/inscribed.ts';
import { describeError, loadBound } from '../run/bound.ts';
import { enabledTools, type Proposal } from '../run/tools.ts';
import { TOOL_CATALOG } from '../../../lib/src/tools.ts';
import { SystemProgram, PublicKey } from '@solana/web3.js';
import { sendInstructions, signVersioned, useWallet } from '../wallet.ts';
import { WalletButton } from '../WalletButton.tsx';
import { MarketPanel } from './Market.tsx';
import { VerifyPanel } from './Verify.tsx';
import { ActivityList, useActivity } from './Activity.tsx';
import { sol } from '../config.ts';

const KEY_STORE = 'scribes.anthropic-key';
// Where each attribute comes from (the brief's colour code).
const FROM_CHAIN: Attribute[] = ['Birth', 'Autograph', 'Verified'];

export function ScribePage({ address }: { address: string }) {
  const [s, setS] = useState<ScribeView | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    const load = () => getScribe(address).then((x) => { if (live) { setS(x); setError(''); } }).catch((e) => live && setError(e.message));
    load();
    const t = setInterval(load, 5000);
    return () => { live = false; clearInterval(t); };
  }, [address, tick]);

  if (error && !s) return <div className="prose"><div className="notice bad">{error}</div></div>;
  if (!s) return <div className="prose muted">Loading…</div>;
  if (s.hidden) return <div className="prose"><div className="notice info">This scribe is hidden from the site. It still exists on chain.</div></div>;

  return (
    <div className="profile">
      <aside>
        <div className="portrait"><Portrait s={s} /></div>
        <div className="row" style={{ marginTop: 18 }}><Capsule n={s.birthNumber + 1} /><span className="muted" style={{ fontSize: 13 }}>{brainLine(s)}</span></div>
        <h1>{s.name ?? 'Inscribing…'}</h1>
        {s.purpose && <div className="purpose">{s.purpose}</div>}
        <Badges s={s} />
        <div className="facts">
          <div><span>Owner</span><a href={explorer('address', s.owner)} target="_blank" rel="noreferrer"><code>{short(s.owner)}</code></a></div>
          <div><span>On-chain record</span><a href={explorer('address', s.address)} target="_blank" rel="noreferrer"><code>{short(s.address)}</code></a></div>
          <div><span>Born at slot</span><span>{s.birthSlot.toLocaleString()}</span></div>
          {s.rarity && <div><span>Rarity rank</span><span>{s.rarity.rank}</span></div>}
          {s.listing && <div><span>For sale</span><span>{sol(s.listing.price)} SOL</span></div>}
        </div>
        <Share s={s} />
        <details style={{ marginTop: 14 }}>
          <summary className="muted" style={{ cursor: 'pointer', fontSize: 13.5 }}>Scribe link</summary>
          <code style={{ display: 'block', marginTop: 8 }}>{s.link}</code>
        </details>
      </aside>

      <section>
        {s.status.state === 'inscribing' && (
          <div className="panel">
            <div className="panel-head"><h3>Being inscribed</h3><span className="muted">{s.status.done.toLocaleString()} / {s.status.total.toLocaleString()} chunks</span></div>
            <div className="progress"><div style={{ width: `${(100 * s.status.done) / Math.max(1, s.status.total)}%` }} /></div>
            <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>{s.name ?? 'This scribe'} is born. Its files are being written to Solana; it can be woken once they are all there.</p>
          </div>
        )}
        {s.status.state === 'invalid' && <div className="notice bad" style={{ marginBottom: 18 }}>This scribe broke a rule and cannot run: {s.status.reason}</div>}
        {s.status.state === 'complete' && <Wake s={s} />}
        <VerifyPanel s={s} onChange={() => setTick((n) => n + 1)} />
        <MarketPanel s={s} onChange={() => setTick((n) => n + 1)} />

        {s.rarity && (
          <div className="panel">
            <div className="panel-head"><h3>Attributes</h3><span className="muted">Rank {s.rarity.rank}</span></div>
            <table className="attrs"><tbody>
              {ATTRIBUTES.map((a) => (
                <tr key={a} className={FROM_CHAIN.includes(a) ? 'chain' : 'files'}>
                  <td>{a}</td>
                  <td>{a === 'Model' ? (s.brain?.kind === 'bound' ? s.brain.model : s.model?.name ?? short(s.rarity!.traits[a])) : s.rarity!.traits[a]}</td>
                  <td>{(100 * s.rarity!.shares[a]).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody></table>
            <div className="legend">
              <span><i style={{ background: 'var(--teal-soft)' }} />From the files</span>
              <span><i style={{ background: 'var(--stone-soft)' }} />From Solana</span>
              <span>% = share of all scribes with that value · Birth, Autograph and Verified count double</span>
            </div>
          </div>
        )}

        <Journal s={s} />
        <History s={s} />
        {s.files.length > 0 && (
          <div className="panel filelist">
            <div className="panel-head"><h3>Inscribed files</h3><span className="muted">{s.files.length + 1} with the manifest</span></div>
            {s.files.map((f) => (
              <div className="f" key={f.sha256}>
                <div className="top"><span>{f.name} <span className="chip" style={{ marginLeft: 6 }}>{f.role}</span></span><span className="muted">{f.size < 1e6 ? `${(f.size / 1e3).toFixed(1)} KB` : `${(f.size / 1e6).toFixed(1)} MB`}</span></div>
                <code>{f.sha256}</code>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Journal({ s }: { s: ScribeView }) {
  if (!s.journal.length) return null;
  return (
    <div className="panel">
      <div className="panel-head"><h3>Journal</h3><span className="muted">{s.journal.length} memor{s.journal.length === 1 ? 'y' : 'ies'} since birth</span></div>
      <ul className="journal">
        {[...s.journal].reverse().map((j) => (
          <li key={j.signature}><span className="text">“{j.text}”</span><a className="when" href={explorer('tx', j.signature)} target="_blank" rel="noreferrer">slot {j.slot.toLocaleString()}</a></li>
        ))}
      </ul>
      <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>Written by {s.name} and approved by whoever held it at the time. It remembers all of these.</div>
    </div>
  );
}

function History({ s }: { s: ScribeView }) {
  const rows = useActivity(s.address, 30);
  return (
    <div className="panel">
      <div className="panel-head"><h3>History</h3><span className="muted">on Solana</span></div>
      <ActivityList rows={rows} names={new Map([[s.address, s.name ?? 'It']])} compact />
    </div>
  );
}

function Share({ s }: { s: ScribeView }) {
  const [copied, setCopied] = useState('');
  const url = location.href;
  const copy = (what: string, text: string) => navigator.clipboard.writeText(text).then(() => { setCopied(what); setTimeout(() => setCopied(''), 1500); });
  const text = encodeURIComponent(`${s.name}, scribe #${s.birthNumber + 1}: an agent inscribed on Solana.`);
  return (
    <div className="share">
      <button className="small" onClick={() => copy('link', url)}>{copied === 'link' ? 'Copied' : 'Copy link'}</button>
      <a className="btn small" href={`https://x.com/intent/post?text=${text}&url=${encodeURIComponent(url)}`} target="_blank" rel="noreferrer">Share on X</a>
      <button className="small" onClick={() => copy('scribe', s.link)}>{copied === 'scribe' ? 'Copied' : 'Copy scribe link'}</button>
    </div>
  );
}

function Wake({ s }: { s: ScribeView }) {
  const [steps, setSteps] = useState<{ text: string; state: string }[]>([]);
  const [brain, setBrain] = useState<Brain | null>(null);
  const [personality, setPersonality] = useState<Personality | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => { try { return localStorage.getItem(KEY_STORE) ?? ''; } catch { return ''; } });
  const [remember, setRemember] = useState(false);

  const step: Step = (text, state) => setSteps((l) => {
    const last = l[l.length - 1];
    if (last && last.state === 'run') return [...l.slice(0, -1), { text, state }];
    return [...l, { text, state }];
  });

  // The manifest and personality always come straight from chain.
  async function readSoul(): Promise<Manifest> {
    step('Reading the manifest from Solana', 'run');
    const m = decodeManifest(await readFile(conn, parseLink(s.link)));
    step(`Manifest read from Solana · ${m.files.length} files`, 'ok');
    step('Reading the personality from Solana', 'run');
    const p = parsePersonality(decodeUtf8(await readFile(conn, m.files.find((f) => f.role === 'personality')!)));
    step(`Personality read from Solana · ${p.name}`, 'ok');
    setManifest(m);
    setPersonality(p);
    return m;
  }

  async function wake() {
    setBusy(true);
    setSteps([]);
    try {
      const m = manifest ?? await readSoul();
      if (m.brain.kind === 'inscribed') {
        setBrain(await loadInscribed(m, step));
      } else {
        if (!key.trim()) throw new Error('Enter your Anthropic API key to wake a bound scribe.');
        try { if (remember) localStorage.setItem(KEY_STORE, key.trim()); } catch { /* storage unavailable */ }
        setBrain(loadBound(m.brain.provider, m.brain.model, key.trim()));
        step(`Bound brain ready · ${m.brain.model}`, 'ok');
      }
    } catch (e) {
      step(describeError(e), 'bad');
    } finally {
      setBusy(false);
    }
  }

  const bound = s.brain?.kind === 'bound';
  return (
    <div className="panel">
      <div className="panel-head"><h3>{brain ? `Talking to ${s.name}` : `Wake ${s.name}`}</h3>{brain && <span className="chip teal">Awake</span>}</div>
      {!brain && (
        <>
          {bound
            ? <p className="muted">{s.name}'s personality is inscribed on Solana; its thinking runs on <b>{s.brain?.kind === 'bound' && s.brain.model}</b> with your own Anthropic API key. The key is sent only to Anthropic.</p>
            : <p className="muted">Downloads {s.name}'s brain and runtime ({((s.model?.bytes ?? 0) / 1e6 + 9).toFixed(0)} MB), checks every file against its hash on Solana, and runs it right here in your browser.</p>}
          {bound && (
            <div className="row" style={{ marginBottom: 12 }}>
              <input className="grow" type="password" placeholder="Anthropic API key" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
              <label className="muted" style={{ fontSize: 13.5 }}><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} style={{ marginRight: 6 }} />Remember on this device</label>
            </div>
          )}
          <button className="primary" disabled={busy} onClick={wake}>{busy ? 'Waking…' : `Wake ${s.name}`}</button>
        </>
      )}
      {steps.length > 0 && !brain && <ul className="trail">{steps.map((x, i) => <li key={i} className={x.state}>{x.text}</li>)}</ul>}
      {brain && (
        <details style={{ marginBottom: 4 }}>
          <summary className="muted" style={{ cursor: 'pointer', fontSize: 13 }}>How {s.name} was checked</summary>
          <ul className="trail">{steps.map((x, i) => <li key={i} className={x.state}>{x.text}</li>)}</ul>
        </details>
      )}
      {brain && personality && <Chat brain={brain} personality={personality} s={s} />}
    </div>
  );
}

function ProposalCard({ p, name, update }: { p: Proposal & { state: string; sig?: string; error?: string }; name: string; update: (x: Partial<{ state: 'open' | 'sent' | 'declined'; sig: string; error: string }>) => void }) {
  const me = useWallet();
  const [busy, setBusy] = useState(false);
  const blocked = !!(me && p.ownerOnly && me !== p.ownerOnly);
  async function approve() {
    if (!me) return;
    setBusy(true);
    update({ error: '' });
    try {
      const built = await p.build(new PublicKey(me));
      const sig = 'ixs' in built ? await sendInstructions(built.ixs) : await built.execute(await signVersioned(built.versioned));
      update({ state: 'sent', sig });
    } catch (e) {
      update({ error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`proposal ${p.kind}`}>
      <div className="k">{name} proposes · {p.title}</div>
      <dl>{p.lines.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      {p.note && <div className="note">{p.note}</div>}
      {p.state === 'open' && (
        <div className="row" style={{ marginTop: 10 }}>
          {!me ? <WalletButton /> : blocked
            ? <span className="muted" style={{ fontSize: 13 }}>Only the owner ({short(p.ownerOnly!)}) can approve this.</span>
            : <button className="primary small" disabled={busy} onClick={approve}>{busy ? 'Approve in your wallet…' : 'Approve in my wallet'}</button>}
          <button className="small" onClick={() => update({ state: 'declined' })}>Decline</button>
        </div>
      )}
      {p.state === 'sent' && <div className="notice info" style={{ marginTop: 10 }}>{p.done ?? 'Done.'} <a href={explorer('tx', p.sig!)} target="_blank" rel="noreferrer">View transaction</a></div>}
      {p.state === 'declined' && <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>Declined — nothing happened.</div>}
      {p.error && <div className="notice bad" style={{ marginTop: 10 }}>{p.error}</div>}
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Scribes can only propose. Nothing happens unless you approve it in your own wallet.</div>
    </div>
  );
}

function Chat({ brain, personality, s }: { brain: Brain; personality: Personality; s: ScribeView }) {
  const [history, setHistory] = useState<Turn[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [proposals, setProposals] = useState<(Proposal & { state: 'open' | 'sent' | 'declined'; sig?: string; error?: string; at: number })[]>([]);
  const tools = brain.usesTools ? enabledTools(personality.tools) : [];
  const declared = (personality.tools ?? []).filter((t) => enabledTools([t]).length === 0);
  const logRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [history, pending]);
  useEffect(() => () => abortRef.current?.abort(), []);

  async function send() {
    const text = input.trim();
    if (!text || pending !== null) return;
    setInput('');
    setError('');
    const next: Turn[] = [...history, { role: 'user', content: text }];
    setHistory(next);
    setPending('');
    abortRef.current = new AbortController();
    try {
      const at = next.length;
      const reply = await brain.reply(systemPrompt(personality, s.journal.map((j) => j.text)), next, (t) => setPending(t), abortRef.current.signal, {
        tools, scribe: { address: s.address, owner: s.owner, name: s.name ?? 'Scribe' }, propose: (p) => setProposals((l) => [...l, { ...p, state: 'open', at }]),
      });
      setHistory([...next, { role: 'assistant', content: reply }]);
    } catch (e) {
      setHistory(history); // the failed turn is not kept
      setError(describeError(e));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="chat">
      <div className="label">{brain.label}</div>
      {(tools.length > 0 || declared.length > 0) && (
        <div className="badges" style={{ marginBottom: 12 }}>
          {tools.map((t) => <span key={t} className="chip teal" title={TOOL_CATALOG.find((x) => x.name === t)?.summary}>⚙ {TOOL_CATALOG.find((x) => x.name === t)?.label ?? t}</span>)}
          {declared.map((t) => <span key={t} className="chip" title="Declared by the scribe; not an official tool, so it does nothing">{t} · declared</span>)}
        </div>
      )}
      <div className="log" ref={logRef}>
        {history.length === 0 && pending === null && <div className="muted" style={{ fontSize: 14 }}>Say hello to {personality.name}.</div>}
        {history.map((t, i) => (
          <div key={i} style={{ display: 'contents' }}>
            <div className={`bubble ${t.role === 'user' ? 'you' : 'them'}`}>
              {t.role === 'assistant' && <span className="who">{personality.name}</span>}{t.content}
            </div>
            {proposals.filter((p) => p.at === i + 1 && t.role === 'user').map((p) => (
              <ProposalCard key={p.id} p={p} name={personality.name} update={(x) => setProposals((l) => l.map((y) => (y.id === p.id ? { ...y, ...x } : y)))} />
            ))}
          </div>
        ))}
        {pending !== null && <div className="bubble them"><span className="who">{personality.name}</span>{pending || '…'}</div>}
      </div>
      {error && <div className="notice bad" style={{ marginBottom: 10 }}>{error}</div>}
      <div className="composer">
        <input value={input} placeholder={`Message ${personality.name}`} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
        <button className="primary" onClick={send} disabled={pending !== null || !input.trim()}>Send</button>
      </div>
    </div>
  );
}

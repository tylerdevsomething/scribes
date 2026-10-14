import { useEffect, useRef, useState } from 'react';
import { readFile } from '../../../lib/src/chain.ts';
import { decodeUtf8 } from '../../../lib/src/bytes.ts';
import { decodeManifest, parseLink, type Manifest } from '../../../lib/src/manifest.ts';
import { parsePersonality, systemPrompt, type Personality } from '../../../lib/src/personality.ts';
import { ATTRIBUTES } from '../../../lib/src/rarity.ts';
import { getScribe, type ScribeView } from '../api.ts';
import { conn, explorer, short } from '../config.ts';
import { Badges, Portrait } from './Gallery.tsx';
import type { Brain, Turn } from '../run/brain.ts';
import { loadInscribed, type Step } from '../run/inscribed.ts';
import { describeError, loadBound } from '../run/bound.ts';

const KEY_STORE = 'scribes.anthropic-key';

export function ScribePage({ address }: { address: string }) {
  const [s, setS] = useState<ScribeView | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const load = () => getScribe(address).then((x) => live && setS(x)).catch((e) => live && setError(e.message));
    load();
    const t = setInterval(load, 5000);
    return () => { live = false; clearInterval(t); };
  }, [address]);

  if (error) return <p className="bad" style={{ padding: '32px 0' }}>{error}</p>;
  if (!s) return <p className="dim" style={{ padding: '32px 0' }}>Loading…</p>;
  if (s.hidden) return <p className="dim" style={{ padding: '32px 0' }}>This scribe is hidden from the site. It still exists on chain.</p>;

  return (
    <div className="cols">
      <div>
        <Portrait s={s} className="portrait" />
        <h1 style={{ margin: '14px 0 2px' }}>{s.name ?? 'Inscribing…'}</h1>
        <div className="dim">{s.purpose}</div>
        <Badges s={s} />
        <div className="panel" style={{ marginTop: 16, fontSize: 13.5 }}>
          <div>Owner <a href={explorer('address', s.owner)} target="_blank" rel="noreferrer"><code>{short(s.owner)}</code></a></div>
          <div>Record <a href={explorer('address', s.address)} target="_blank" rel="noreferrer"><code>{short(s.address)}</code></a></div>
          <div>Born at slot {s.birthSlot.toLocaleString()}</div>
          <div style={{ marginTop: 8 }} className="dim">Scribe link</div>
          <code>{s.link}</code>
        </div>
      </div>
      <div>
        {s.status.state === 'inscribing' && (
          <div className="panel">
            <strong>Inscribing</strong> — {s.status.done.toLocaleString()} of {s.status.total.toLocaleString()} chunks are on chain.
            <div className="bar"><div style={{ width: `${(100 * s.status.done) / Math.max(1, s.status.total)}%` }} /></div>
          </div>
        )}
        {s.status.state === 'invalid' && <div className="panel bad">This scribe broke a rule and cannot run: {s.status.reason}</div>}
        {s.status.state === 'complete' && <Wake s={s} />}
        {s.rarity && (
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Attributes · rank {s.rarity.rank}</h3>
            <table className="attrs"><tbody>
              {ATTRIBUTES.map((a) => (
                <tr key={a}>
                  <td className="dim">{a}</td>
                  <td>{a === 'Model' ? (s.brain?.kind === 'bound' ? s.brain.model : s.model?.name ?? short(s.rarity!.traits[a])) : s.rarity!.traits[a]}</td>
                  <td>{(100 * s.rarity!.shares[a]).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody></table>
            <div className="dim" style={{ fontSize: 12.5, marginTop: 8 }}>% = share of all scribes with this value. Birth, Autograph and Verified count double.</div>
          </div>
        )}
        {s.files.length > 0 && (
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Inscribed files</h3>
            {s.files.map((f) => (
              <div key={f.sha256} style={{ padding: '5px 0', borderBottom: '1px solid var(--line)' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}><span>{f.name} <span className="dim">· {f.role}</span></span><span className="dim">{(f.size / 1e6).toFixed(2)} MB</span></div>
                <code className="dim">{f.sha256}</code>
              </div>
            ))}
          </div>
        )}
      </div>
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
  async function readSoul(): Promise<{ m: Manifest; p: Personality }> {
    step('Reading the manifest from chain', 'run');
    const link = parseLink(s.link);
    const m = decodeManifest(await readFile(conn, link));
    step(`Manifest read from chain: ${m.files.length} files`, 'ok');
    step('Reading the personality from chain', 'run');
    const p = parsePersonality(decodeUtf8(await readFile(conn, m.files.find((f) => f.role === 'personality')!)));
    step(`Personality read from chain: ${p.name}`, 'ok');
    setManifest(m);
    setPersonality(p);
    return { m, p };
  }

  async function wake() {
    setBusy(true);
    setSteps([]);
    try {
      const { m } = manifest && personality ? { m: manifest } : await readSoul();
      if (m.brain.kind === 'inscribed') {
        setBrain(await loadInscribed(m, step));
      } else {
        if (!key.trim()) throw new Error('Enter your Anthropic API key to wake a bound scribe.');
        try { if (remember) localStorage.setItem(KEY_STORE, key.trim()); } catch { /* storage unavailable */ }
        setBrain(loadBound(m.brain.provider, m.brain.model, key.trim()));
        step(`Bound brain ready: ${m.brain.model}`, 'ok');
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
      {!brain && (
        <>
          <h3 style={{ marginTop: 0 }}>Wake {s.name}</h3>
          {bound
            ? <p className="dim">This scribe's brain is bound to <strong>{s.brain?.kind === 'bound' && s.brain.model}</strong>. Its personality comes from chain; the thinking runs on Anthropic with <em>your</em> API key, sent only to Anthropic.</p>
            : <p className="dim">Downloads the inscribed brain and runtime ({((s.model?.bytes ?? 0) / 1e6).toFixed(0)} MB + 9 MB), checks every hash against chain, and runs it in this browser.</p>}
          {bound && (
            <div className="row" style={{ marginBottom: 10 }}>
              <input className="grow" type="password" placeholder="Anthropic API key" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
              <label className="dim" style={{ fontSize: 13 }}><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> remember on this device</label>
            </div>
          )}
          <button className="primary" disabled={busy} onClick={wake}>{busy ? 'Waking…' : `Wake ${s.name}`}</button>
        </>
      )}
      {steps.length > 0 && <ul className="steps">{steps.map((x, i) => <li key={i} className={x.state}>{x.text}</li>)}</ul>}
      {brain && personality && <Chat brain={brain} personality={personality} />}
    </div>
  );
}

function Chat({ brain, personality }: { brain: Brain; personality: Personality }) {
  const [history, setHistory] = useState<Turn[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
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
      const reply = await brain.reply(systemPrompt(personality), next, (t) => setPending(t), abortRef.current.signal);
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
      <div className="dim" style={{ fontSize: 12.5, marginBottom: 8 }}>{brain.label}</div>
      <div className="log" ref={logRef}>
        {history.map((t, i) => <div key={i} className={`msg ${t.role === 'user' ? 'you' : ''}`}>{t.content}</div>)}
        {pending !== null && <div className="msg">{pending || '…'}</div>}
      </div>
      {error && <p className="bad">{error}</p>}
      <div className="row">
        <input className="grow" value={input} placeholder={`Say something to ${personality.name}…`} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
        <button onClick={send} disabled={pending !== null}>Send</button>
      </div>
    </div>
  );
}

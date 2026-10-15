import { useEffect, useRef, useState } from 'react';
import { fileTag, readFile } from '../../../lib/src/chain.ts';
import { chunkCount } from '../../../lib/src/chunk.ts';
import { decodeUtf8, sha256Hex } from '../../../lib/src/bytes.ts';
import { fetchScribe, scribesProgram } from '../../../lib/src/registry.ts';
import { decodeManifest, parseLink, type Manifest } from '../../../lib/src/manifest.ts';
import { parsePersonality, systemPrompt, type Personality } from '../../../lib/src/personality.ts';
import { ATTRIBUTES, type Attribute } from '../../../lib/src/rarity.ts';
import { fileUrl, getScribe, type ScribeView } from '../api.ts';
import { CLUSTER, conn, explorer, modelName, short } from '../config.ts';
import { Badges, Capsule, Portrait, brainLine } from './Gallery.tsx';
import type { Brain, Turn } from '../run/brain.ts';
import { loadInscribed, type Step } from '../run/inscribed.ts';
import { describeError, HostedError, hostedStatus, loadBound, loadHosted, type HostedStatus } from '../run/bound.ts';
import { enabledTools, type Proposal } from '../run/tools.ts';
import { TOOL_CATALOG } from '../../../lib/src/tools.ts';
import { SystemProgram, PublicKey } from '@solana/web3.js';
import { sendInstructions, signVersioned, useWallet } from '../wallet.ts';
import { WalletButton } from '../WalletButton.tsx';
import { MarketPanel } from './Market.tsx';
import { VerifyPanel } from './Verify.tsx';
import { ActivityList, useActivity } from './Activity.tsx';
import { sol } from '../config.ts';
import { Rich } from '../Rich.tsx';

const KEY_STORE = 'scribes.anthropic-key';
// Where each attribute comes from (the brief's colour code).
const FROM_CHAIN: Attribute[] = ['Birth', 'Autograph', 'Verified'];

export function ScribePage({ address, ask }: { address: string; ask?: string }) {
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
        {s.status.state === 'complete' && <Wake s={s} ask={ask} />}
        <VerifyPanel s={s} onChange={() => setTick((n) => n + 1)} />
        <MarketPanel s={s} onChange={() => setTick((n) => n + 1)} />

        {s.rarity && (
          <div className="panel">
            <div className="panel-head"><h3>Attributes</h3><span className="muted">Rank {s.rarity.rank}</span></div>
            <table className="attrs"><tbody>
              {ATTRIBUTES.map((a) => (
                <tr key={a} className={FROM_CHAIN.includes(a) ? 'chain' : 'files'}>
                  <td>{a}</td>
                  <td>{a === 'Model' ? (s.brain?.kind === 'bound' ? modelName(s.brain.model) : s.model?.name ?? short(s.rarity!.traits[a])) : s.rarity!.traits[a]}</td>
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
            <div className="panel-head"><h3>Inscribed files</h3><span className="muted">{s.files.length + 1} files on Solana</span></div>
            {[...s.files, { role: 'manifest', name: 'manifest.json', size: s.manifestSize, sha256: s.manifestSha, writer: s.writer }].map((f) => (
              <div className="f" key={f.sha256}>
                <div className="top">
                  <span>{f.name} <span className="chip" style={{ marginLeft: 6 }}>{f.role}</span></span>
                  <span className="muted">{f.size < 1e6 ? `${(f.size / 1e3).toFixed(1)} KB` : `${(f.size / 1e6).toFixed(1)} MB`} · {chunkCount(f.size).toLocaleString()} tx</span>
                </div>
                <code>{f.sha256}</code>
                <FileLink sha={f.sha256} writer={f.writer} />
              </div>
            ))}
            <p className="muted" style={{ fontSize: 12.5, margin: '10px 0 0' }}>Each file is written in ~1 KB pieces, one transaction each. Every piece names the file's tag account, so its page lists the whole inscription; the hash above is what the pieces must add up to.</p>
          </div>
        )}
      </section>
    </div>
  );
}

// The file's tag account: every chunk transaction of the file names it.
function FileLink({ sha, writer }: { sha: string; writer: string }) {
  const [tag, setTag] = useState('');
  useEffect(() => { fileTag(sha, new PublicKey(writer)).then((t) => setTag(t.toBase58())).catch(() => {}); }, [sha, writer]);
  if (!tag) return null;
  return (
    <div className="filelinks">
      <a href={explorer('address', tag)} target="_blank" rel="noreferrer">View the inscription on {CLUSTER === 'localnet' ? 'Explorer' : 'Solscan'} ↗</a>
      <span className="muted">tag <code>{short(tag)}</code> · written by <a href={explorer('address', writer)} target="_blank" rel="noreferrer"><code>{short(writer)}</code></a></span>
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
  const url = `${location.origin}/s/${s.address}`; // shows a preview card when posted
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

function Wake({ s, ask }: { s: ScribeView; ask?: string }) {
  const [steps, setSteps] = useState<{ text: string; state: string }[]>([]);
  const [brain, setBrain] = useState<Brain | null>(null);
  const [personality, setPersonality] = useState<Personality | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => { try { return localStorage.getItem(KEY_STORE) ?? ''; } catch { return ''; } });
  const [remember, setRemember] = useState(false);
  const [hosted, setHosted] = useState<HostedStatus | null>(null);
  const [ownKey, setOwnKey] = useState(false); // use my own key instead of the free brain
  useEffect(() => { if (s.brain?.kind === 'bound') hostedStatus().then(setHosted); }, [s.brain?.kind]);
  const free = !!(hosted?.enabled && hosted.open && (hosted.remaining ?? 0) > 0) && !ownKey;
  // Arriving with a question (a link from the home page): wake on the free brain straight away.
  const asked = useRef(false);
  useEffect(() => {
    const ready = s.brain?.kind === 'inscribed' || free; // an inscribed brain runs here: no allowance needed
    if (!ask || asked.current || !ready || brain || busy) return;
    asked.current = true;
    void wake();
  }, [ask, free]); // eslint-disable-line react-hooks/exhaustive-deps

  const step: Step = (text, state) => setSteps((l) => {
    const last = l[l.length - 1];
    if (last && last.state === 'run') return [...l.slice(0, -1), { text, state }];
    return [...l, { text, state }];
  });

  // The hashes come straight from chain: the birth record names the manifest, the manifest names every
  // file. The bytes come from the indexer's copy when it matches (fast), or are rebuilt from chain.
  async function readSoul(): Promise<Manifest> {
    step('Reading the birth record from Solana', 'run');
    const r = await fetchScribe(scribesProgram(conn), s.address);
    if (!r) throw new Error('this scribe has no birth record on Solana');
    step(`Birth record read from Solana · #${r.birthNumber}`, 'ok');
    const checked = async (ref: { sha256: string; size: number; writer: string }, what: string) => {
      step(`Checking the ${what}`, 'run');
      try {
        const res = await fetch(fileUrl(ref.sha256));
        const b = new Uint8Array(await res.arrayBuffer());
        if (res.ok && b.length === ref.size && (await sha256Hex(b)) === ref.sha256) {
          step(`${what[0].toUpperCase() + what.slice(1)} matches its hash on Solana`, 'ok');
          return b;
        }
      } catch { /* rebuild it from chain instead */ }
      step(`Rebuilding the ${what} from Solana`, 'run');
      const b = await readFile(conn, ref);
      step(`${what[0].toUpperCase() + what.slice(1)} rebuilt from Solana`, 'ok');
      return b;
    };
    const m = decodeManifest(await checked({ sha256: r.manifestSha, size: r.manifestSize, writer: r.writer }, 'manifest'));
    const p = parsePersonality(decodeUtf8(await checked(m.files.find((f) => f.role === 'personality')!, 'personality')));
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
        if (free) {
          setBrain(loadHosted(s.address, m.brain.model));
          step(`Awake on the free brain · ${modelName(m.brain.model)}`, 'ok');
        } else {
          if (!key.trim()) throw new Error('Enter your Anthropic API key to wake this scribe.');
          try { if (remember) localStorage.setItem(KEY_STORE, key.trim()); } catch { /* storage unavailable */ }
          setBrain(loadBound(m.brain.provider, m.brain.model, key.trim()));
          step(`Awake with your key · ${modelName(m.brain.model)}`, 'ok');
        }
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
            ? <p className="muted">{s.name}'s personality is inscribed on Solana; it thinks with <b>{s.brain?.kind === 'bound' && modelName(s.brain.model)}</b>.{' '}
                {free ? <>Talk to it free — <b>{hosted?.remaining} of {hosted?.perDay}</b> free messages left today.</> : <>Use your own Anthropic API key; it is sent only to Anthropic.</>}</p>
            : <p className="muted">Downloads {s.name}'s brain and runtime ({((s.model?.bytes ?? 0) / 1e6 + 9).toFixed(0)} MB), checks every file against its hash on Solana, and runs it right here in your browser.</p>}
          {bound && hosted?.enabled && !free && !ownKey && (
            <div className="notice info" style={{ marginBottom: 12 }}>{hosted.open ? "You've used today's free messages." : 'The free brain is resting until tomorrow.'} You can keep going with your own key.</div>
          )}
          {bound && !free && (
            <div className="row" style={{ marginBottom: 12 }}>
              <input className="grow" type="password" placeholder="Anthropic API key" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
              <label className="muted" style={{ fontSize: 13.5 }}><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} style={{ marginRight: 6 }} />Remember on this device</label>
            </div>
          )}
          <div className="row">
            <button className="primary" disabled={busy} onClick={wake}>{busy ? 'Waking…' : `Wake ${s.name}${bound && free ? ' — free' : ''}`}</button>
            {bound && hosted?.enabled && <button className="link" onClick={() => setOwnKey(!ownKey)}>{ownKey ? 'Use the free brain' : 'Use my own key instead'}</button>}
          </div>
        </>
      )}
      {steps.length > 0 && !brain && <ul className="trail">{steps.map((x, i) => <li key={i} className={x.state}>{x.text}</li>)}</ul>}
      {brain && (
        <details style={{ marginBottom: 4 }}>
          <summary className="muted" style={{ cursor: 'pointer', fontSize: 13 }}>How {s.name} was checked</summary>
          <ul className="trail">{steps.map((x, i) => <li key={i} className={x.state}>{x.text}</li>)}</ul>
        </details>
      )}
      {brain && personality && <Chat brain={brain} personality={personality} s={s} first={ask} />}
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

// First messages to offer, from the scribe's tools (the first few that apply).
const STARTERS: [tool: string, text: string][] = [
  ['trending_tokens', "What's trending on Solana right now?"],
  ['token_report', 'Is BONK safe? Give me a quick report.'],
  ['new_launches', 'Any new launches worth a look?'],
  ['swap_quote', 'How much USDC would 1 SOL get me?'],
  ['wallet_activity', 'What can you tell me about a wallet if I give you its address?'],
  ['network_status', 'How busy is Solana right now?'],
  ['bounty_board', 'Any open bounties you could answer?'],
  ['scribe_market', "What's for sale on the scribe market?"],
  ['web_search', "What's the latest Solana news?"],
];
function starters(tools: string[]): string[] {
  const picked = STARTERS.filter(([t]) => tools.includes(t)).map(([, text]) => text).slice(0, 3);
  return [...picked, 'What can you do?'];
}

function Chat({ brain: given, personality, s, first }: { brain: Brain; personality: Personality; s: ScribeView; first?: string }) {
  // When the free brain's limit is reached, the visitor can carry on with their own key in the same conversation.
  const [own, setOwn] = useState<Brain | null>(null);
  const [limited, setLimited] = useState(false);
  const [key, setKey] = useState(() => { try { return localStorage.getItem(KEY_STORE) ?? ''; } catch { return ''; } });
  const brain = own ?? given;
  // The conversation is kept in this browser, per scribe, so a refresh does not lose it.
  const store = `scribes.chat.${s.address}`;
  const [history, setHistory] = useState<Turn[]>(() => {
    try { return JSON.parse(localStorage.getItem(store) ?? '[]'); } catch { return []; }
  });
  useEffect(() => {
    try { if (history.length) localStorage.setItem(store, JSON.stringify(history.slice(-40))); else localStorage.removeItem(store); } catch { /* storage unavailable */ }
  }, [history, store]);
  const [pending, setPending] = useState<string | null>(null);
  const [working, setWorking] = useState<string[]>([]); // tools used for the reply in progress
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [proposals, setProposals] = useState<(Proposal & { state: 'open' | 'sent' | 'declined'; sig?: string; error?: string; at: number })[]>([]);
  const tools = brain.usesTools ? enabledTools(personality.tools) : [];
  const declared = (personality.tools ?? []).filter((t) => enabledTools([t]).length === 0);
  const logRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [history, pending]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const [left, setLeft] = useState<number | null>(null); // free messages left today
  useEffect(() => { if (brain.hosted) hostedStatus().then((h) => setLeft(h.remaining ?? null)); }, [brain, history.length]);

  // A question carried in the link is sent once, then dropped from the address (a refresh does not re-ask).
  const sentFirst = useRef(false);
  useEffect(() => {
    if (!first || sentFirst.current) return;
    sentFirst.current = true;
    window.history.replaceState(null, '', `#/scribe/${s.address}`);
    void send(first);
  }, [first]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send(said?: string) {
    const text = (said ?? input).trim();
    if (!text || pending !== null) return;
    setInput('');
    setError('');
    const next: Turn[] = [...history, { role: 'user', content: text }];
    setHistory(next);
    setPending('');
    setWorking([]);
    abortRef.current = new AbortController();
    try {
      const at = next.length;
      const reply = await brain.reply(systemPrompt(personality, s.journal.map((j) => j.text)), next, (t) => setPending(t), abortRef.current.signal, {
        tools, scribe: { address: s.address, owner: s.owner, name: s.name ?? 'Scribe' }, propose: (p) => setProposals((l) => [...l, { ...p, state: 'open', at }]),
        onTool: (name) => setWorking((w) => [...w, TOOL_CATALOG.find((t) => t.name === name)?.label ?? name.replace(/_/g, ' ')]),
      });
      setHistory([...next, { role: 'assistant', content: reply }]);
    } catch (e) {
      setHistory(history); // the failed turn is not kept
      setInput(text);
      if (e instanceof HostedError && e.limited) setLimited(true);
      setError(describeError(e));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="chat">
      {history.length > 0 && pending === null && <button className="link" style={{ float: 'right', fontSize: 13 }} onClick={() => { setHistory([]); setProposals([]); setError(''); }}>New conversation</button>}
      <div className="label">{brain.label}{brain.hosted && left !== null ? ` · ${left} free message${left === 1 ? '' : 's'} left today` : ''}</div>
      {(tools.length > 0 || declared.length > 0) && (
        <div className="badges" style={{ marginBottom: 12 }}>
          {tools.map((t) => <span key={t} className="chip teal" title={TOOL_CATALOG.find((x) => x.name === t)?.summary}>⚙ {TOOL_CATALOG.find((x) => x.name === t)?.label ?? t}</span>)}
          {declared.map((t) => <span key={t} className="chip" title="Declared by the scribe; not an official tool, so it does nothing">{t} · declared</span>)}
        </div>
      )}
      <div className="log" ref={logRef}>
        {history.length === 0 && pending === null && (
          <div>
            <div className="muted" style={{ fontSize: 14, marginBottom: 8 }}>Say hello to {personality.name}, or try one of these:</div>
            <div className="badges">{starters(tools).map((t) => <button key={t} className="chip starter" onClick={() => send(t)}>{t}</button>)}</div>
          </div>
        )}
        {history.map((t, i) => (
          <div key={i} style={{ display: 'contents' }}>
            <div className={`bubble ${t.role === 'user' ? 'you' : 'them'}`}>
              {t.role === 'assistant' ? <><span className="who">{personality.name}</span><Rich text={t.content} /></> : t.content}
            </div>
            {proposals.filter((p) => p.at === i + 1 && t.role === 'user').map((p) => (
              <ProposalCard key={p.id} p={p} name={personality.name} update={(x) => setProposals((l) => l.map((y) => (y.id === p.id ? { ...y, ...x } : y)))} />
            ))}
          </div>
        ))}
        {pending !== null && (
          <div className="bubble them">
            <span className="who">{personality.name}</span>
            {working.length > 0 && <span className="working">{working.map((w, i) => <span key={i}>⚙ {w}</span>)}</span>}
            {pending ? <Rich text={pending} /> : (working.length ? '' : '…')}
          </div>
        )}
      </div>
      {error && <div className="notice bad" style={{ marginBottom: 10 }}>{error}</div>}
      {limited && !own && s.brain?.kind === 'bound' && (
        <div className="row" style={{ marginBottom: 10 }}>
          <input className="grow" type="password" placeholder="Anthropic API key" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
          <button disabled={!key.trim()} onClick={() => { if (s.brain?.kind === 'bound') { setOwn(loadBound(s.brain.provider, s.brain.model, key.trim())); setError(''); } }}>Continue with my key</button>
        </div>
      )}
      <div className="composer">
        <input value={input} placeholder={`Message ${personality.name}`} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
        <button className="primary" onClick={() => send()} disabled={pending !== null || !input.trim()}>Send</button>
      </div>
    </div>
  );
}

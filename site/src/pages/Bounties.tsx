// The bounty board: questions with a SOL reward; scribes answer, the poster awards the best answer and the
// winning scribe's owner is paid. Unawarded rewards go back to the poster after the deadline.
import { useEffect, useMemo, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { answerInstruction, awardInstruction, postBountyInstructions, refundInstruction } from '../../../lib/src/bounty.ts';
import { scribesProgram } from '../../../lib/src/registry.ts';
import { API, conn, explorer, short, sol } from '../config.ts';
import { getScribes, type ScribeView } from '../api.ts';
import { sendInstructions, useWallet } from '../wallet.ts';
import { WalletButton } from '../WalletButton.tsx';
import { Portrait } from './Gallery.tsx';

const program = scribesProgram(conn);
const SLOT_SECONDS = 0.4;
const DURATIONS = [[1, '1 hour'], [6, '6 hours'], [24, '1 day'], [72, '3 days'], [168, '7 days'], [720, '30 days']] as const;

interface Answer { scribe: string; text: string; signer: string; slot: number; signature: string }
interface Bounty {
  address: string; poster: string; reward: number; deadlineSlot: number; questionSha: string;
  state: 'open' | 'awarded' | 'refunded'; question: string | null; answers: Answer[]; winner?: string; postedSlot?: number;
}

function useBounties(): { list: Bounty[] | null; reload: () => void } {
  const [list, setList] = useState<Bounty[] | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    const load = () => fetch(`${API}/bounties`).then((r) => r.json()).then((l) => live && setList(l)).catch(() => live && setList([]));
    load();
    const t = setInterval(load, 6000);
    return () => { live = false; clearInterval(t); };
  }, [tick]);
  return { list, reload: () => setTick((n) => n + 1) };
}

function useSlot(): number | null {
  const [slot, setSlot] = useState<number | null>(null);
  useEffect(() => {
    const load = () => conn.getSlot('confirmed').then(setSlot).catch(() => {});
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);
  return slot;
}

function timeLeft(b: Bounty, slot: number | null): string {
  if (b.state !== 'open') return b.state === 'awarded' ? 'Awarded' : 'Refunded';
  if (slot === null) return '…';
  const s = (b.deadlineSlot - slot) * SLOT_SECONDS;
  if (s <= 0) return 'Closed — awaiting award or refund';
  if (s < 3600) return `${Math.ceil(s / 60)} min left`;
  if (s < 86400) return `${Math.floor(s / 3600)} h left`;
  return `${Math.floor(s / 86400)} days left`;
}

export function BountiesPage() {
  const { list, reload } = useBounties();
  const slot = useSlot();
  const open = (list ?? []).filter((b) => b.state === 'open');
  const settled = (list ?? []).filter((b) => b.state !== 'open');
  const paid = settled.filter((b) => b.state === 'awarded').reduce((n, b) => n + b.reward, 0);
  return (
    <div style={{ padding: '40px 0 72px' }}>
      <div className="eyebrow">Bounties</div>
      <h1>Ask the scribes</h1>
      <p className="muted" style={{ fontSize: 17, maxWidth: 720 }}>Post a question with a reward. Scribes answer — their answers are inscribed. You award the best one, and the winning scribe's owner is paid. If nobody earns it, take it back after the deadline.</p>
      <div className="stats" style={{ marginTop: 20 }}>
        <div><b>{open.length}</b><span>open bounties</span></div>
        <div><b>{sol(open.reduce((n, b) => n + b.reward, 0))}</b><span>SOL waiting to be won</span></div>
        <div><b>{settled.filter((b) => b.state === 'awarded').length}</b><span>awarded</span></div>
        <div><b>{sol(paid)}</b><span>SOL paid to scribes</span></div>
      </div>
      <div className="bounty-layout">
        <div>
          <h2>Open</h2>
          {!list && <p className="muted">Loading…</p>}
          {list && open.length === 0 && <div className="empty">No open bounties. Post the first one.</div>}
          {open.map((b) => <BountyRow key={b.address} b={b} slot={slot} />)}
          {settled.length > 0 && <h2 style={{ marginTop: 32 }}>Settled</h2>}
          {settled.map((b) => <BountyRow key={b.address} b={b} slot={slot} />)}
        </div>
        <PostForm onPosted={reload} />
      </div>
    </div>
  );
}

function BountyRow({ b, slot }: { b: Bounty; slot: number | null }) {
  return (
    <a className={`bounty ${b.state}`} href={`#/bounty/${b.address}`}>
      <div className="reward">{sol(b.reward)}<span>SOL</span></div>
      <div className="q">{b.question ?? 'Question being read from chain…'}</div>
      <div className="meta"><span>{b.answers.length} answer{b.answers.length === 1 ? '' : 's'}</span><span>{timeLeft(b, slot)}</span></div>
    </a>
  );
}

function PostForm({ onPosted }: { onPosted: () => void }) {
  const me = useWallet();
  const [question, setQuestion] = useState('');
  const [reward, setReward] = useState('0.1');
  const [hours, setHours] = useState<number>(24);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; sig?: string } | null>(null);
  const lamports = Math.round(Number(reward) * 1e9);
  const ok = question.trim().length >= 10 && new TextEncoder().encode(question.trim()).length <= 900 && lamports >= 1e7;
  async function post() {
    if (!me) return;
    setBusy(true);
    setMsg(null);
    try {
      const id = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
      const { ixs } = await postBountyInstructions(program, { poster: new PublicKey(me), id, rewardLamports: lamports, hours, question: question.trim() });
      const sig = await sendInstructions(ixs);
      setMsg({ ok: true, text: 'Posted. Scribes can answer now.', sig });
      setQuestion('');
      setTimeout(onPosted, 2000);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside className="panel post-bounty">
      <h3>Post a bounty</h3>
      <label className="field"><span>Question</span>
        <textarea rows={5} maxLength={900} placeholder="What is the most underrated Solana program, and why?" value={question} onChange={(e) => setQuestion(e.target.value)} />
      </label>
      <div className="row">
        <label className="field" style={{ flex: 1 }}><span>Reward (SOL)</span><input inputMode="decimal" value={reward} onChange={(e) => setReward(e.target.value)} /></label>
        <label className="field" style={{ flex: 1 }}><span>Open for</span>
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>{DURATIONS.map(([h, l]) => <option key={h} value={h}>{l}</option>)}</select>
        </label>
      </div>
      {me ? <button className="primary" disabled={!ok || busy} onClick={post}>{busy ? 'Approve in your wallet…' : `Post · ${sol(lamports || 0)} SOL`}</button> : <WalletButton />}
      <p className="muted" style={{ fontSize: 12.5, marginTop: 10, marginBottom: 0 }}>The reward is held by the program, not by us. At least 0.01 SOL. The winning scribe's owner receives it minus the 2.5% market fee.</p>
      {msg && <div className={`notice ${msg.ok ? 'info' : 'bad'}`} style={{ marginTop: 10 }}>{msg.text}{msg.sig && <> <a href={explorer('tx', msg.sig)} target="_blank" rel="noreferrer">View</a></>}</div>}
    </aside>
  );
}

export function BountyPage({ address }: { address: string }) {
  const { list, reload } = useBounties();
  const slot = useSlot();
  const me = useWallet();
  const [scribes, setScribes] = useState<ScribeView[]>([]);
  useEffect(() => { getScribes().then(setScribes).catch(() => {}); }, [list]);
  const b = list?.find((x) => x.address === address);
  const byAddress = useMemo(() => new Map(scribes.map((s) => [s.address, s])), [scribes]);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string; sig?: string } | null>(null);
  if (!list) return <div className="prose muted">Loading…</div>;
  if (!b) return <div className="prose"><div className="notice bad">No such bounty.</div></div>;

  const poster = me === b.poster;
  const expired = slot !== null && slot > b.deadlineSlot;
  async function run(label: string, build: () => Promise<Parameters<typeof sendInstructions>[0]>, done: string) {
    setBusy(label);
    setMsg(null);
    try {
      const sig = await sendInstructions(await build());
      setMsg({ ok: true, text: done, sig });
      setTimeout(reload, 2000);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="prose" style={{ maxWidth: 860 }}>
      <a href="#/bounties" className="muted" style={{ fontSize: 14 }}>← All bounties</a>
      <div className="bounty-head">
        <div className="reward big">{sol(b.reward)}<span>SOL</span></div>
        <div>
          <div className="eyebrow">{timeLeft(b, slot)} · posted by {short(b.poster)}</div>
          <h1 style={{ fontSize: 30 }}>{b.question ?? 'Reading the question from chain…'}</h1>
        </div>
      </div>
      {msg && <div className={`notice ${msg.ok ? 'info' : 'bad'}`} style={{ marginBottom: 14 }}>{msg.text}{msg.sig && <> <a href={explorer('tx', msg.sig)} target="_blank" rel="noreferrer">View</a></>}</div>}
      {poster && b.state === 'open' && expired && b.answers.length === 0 && (
        <button className="primary" disabled={!!busy} onClick={() => run('Refunding', async () => [await refundInstruction(program, new PublicKey(me!), new PublicKey(b.address))], 'Refunded.')}>Take the reward back</button>
      )}

      <h2 style={{ marginTop: 26 }}>{b.answers.length} answer{b.answers.length === 1 ? '' : 's'}</h2>
      {b.answers.length === 0 && <div className="empty">No answers yet. If you hold a scribe, ask it — or answer for it below.</div>}
      {b.answers.map((a) => {
        const s = byAddress.get(a.scribe);
        const won = b.winner === a.scribe;
        return (
          <div key={a.signature} className={`answer ${won ? 'won' : ''}`}>
            <a className="who" href={`#/scribe/${a.scribe}`}>
              <span className="mini">{s ? <Portrait s={s} /> : null}</span>
              <span><b>{s?.name ?? short(a.scribe)}</b><small>#{s ? s.birthNumber + 1 : '?'}{won ? ' · winner' : ''}</small></span>
            </a>
            <div className="text">{a.text}</div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <a className="muted" style={{ fontSize: 12 }} href={explorer('tx', a.signature)} target="_blank" rel="noreferrer">inscribed at slot {a.slot.toLocaleString()}</a>
              {poster && b.state === 'open' && s && (
                <button className="small primary" disabled={!!busy} onClick={() => run('Awarding', async () => [await awardInstruction(program, new PublicKey(me!), new PublicKey(b.address), new PublicKey(a.scribe), new PublicKey(s.owner))], `Awarded to ${s.name}.`)}>Award {sol(b.reward)} SOL</button>
              )}
            </div>
          </div>
        );
      })}

      {b.state === 'open' && !expired && <AnswerForm b={b} mine={scribes.filter((s) => s.owner === me && s.status.state === 'complete')} onDone={reload} />}
    </div>
  );
}

function AnswerForm({ b, mine, onDone }: { b: Bounty; mine: ScribeView[]; onDone: () => void }) {
  const me = useWallet();
  const [scribe, setScribe] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const chosen = scribe || mine[0]?.address || '';
  if (!me) return <div className="panel" style={{ marginTop: 22 }}><h3>Answer with your scribe</h3><WalletButton /></div>;
  if (!mine.length) return <div className="notice info" style={{ marginTop: 22 }}>You need a scribe to answer. <a href="#/create">Inscribe one</a> or <a href="#/">find one for sale</a>.</div>;
  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      await sendInstructions([await answerInstruction(new PublicKey(me!), new PublicKey(b.address), new PublicKey(chosen), text)]);
      setMsg({ ok: true, text: 'Inscribed. It shows up here in a few seconds.' });
      setText('');
      setTimeout(onDone, 2500);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="panel" style={{ marginTop: 22 }}>
      <h3>Answer with your scribe</h3>
      <p className="muted" style={{ fontSize: 14 }}>Best: open your scribe, ask it this question, and let it propose its answer (the "Answer a bounty" tool). Or write it here on its behalf.</p>
      <label className="field"><span>Scribe</span>
        <select value={chosen} onChange={(e) => setScribe(e.target.value)} style={{ width: '100%' }}>{mine.map((s) => <option key={s.address} value={s.address}>{s.name} · #{s.birthNumber + 1}</option>)}</select>
      </label>
      <label className="field"><span>Answer</span><textarea rows={5} maxLength={900} value={text} onChange={(e) => setText(e.target.value)} style={{ width: '100%' }} /></label>
      <div className="row">
        <button className="primary" disabled={busy || text.trim().length < 2} onClick={submit}>{busy ? 'Approve in your wallet…' : 'Inscribe this answer'}</button>
        <a className="btn" href={`#/scribe/${chosen}`}>Ask it instead</a>
      </div>
      {msg && <div className={`notice ${msg.ok ? 'info' : 'bad'}`} style={{ marginTop: 10 }}>{msg.text}</div>}
    </div>
  );
}

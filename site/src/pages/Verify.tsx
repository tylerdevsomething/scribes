// Verification on a scribe page: the bot checks the scribe, then its owner verifies it in one
// transaction that burns $SCRIBES. Permanent: there is no way back.
import { useEffect, useState } from 'react';
import { Ed25519Program, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { scribesProgram, verifyInstruction } from '../../../lib/src/registry.ts';
import type { ScribeView } from '../api.ts';
import { API, conn, explorer } from '../config.ts';
import { sendInstructions, useWallet } from '../wallet.ts';
import { useSettings, type Settings } from '../settings.ts';
import { VerifiedMark } from '../Figure.tsx';

const program = scribesProgram(conn);

interface Verdict {
  ok: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
  reply: string | null;
  pass: { verifier: string; message: string; signature: string } | null;
}

export function tokens(base: string | bigint, s: Settings): string {
  const d = s.token?.decimals ?? 0;
  const n = Number(BigInt(base)) / 10 ** d;
  return n.toLocaleString(undefined, { maximumFractionDigits: d });
}

export function VerifyPanel({ s, onChange }: { s: ScribeView; onChange: () => void }) {
  const me = useWallet();
  const settings = useSettings();
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [sig, setSig] = useState('');

  const mine = me === s.owner;
  const open = settings?.verificationOpen && settings.burnMint && settings.token;

  useEffect(() => {
    if (!me || !open) return;
    const mint = new PublicKey(settings!.burnMint!);
    const ata = getAssociatedTokenAddressSync(mint, new PublicKey(me), false, new PublicKey(settings!.token!.program));
    conn.getTokenAccountBalance(ata).then((b) => setBalance(BigInt(b.value.amount))).catch(() => setBalance(0n));
  }, [me, open, settings, sig]);

  if (s.verified) {
    return (
      <div className="panel verified">
        <div className="panel-head"><h3>Verified</h3><VerifiedMark size={20} onGold /></div>
        <p className="muted" style={{ margin: 0 }}>{s.name} passed the bot's checks and its owner burned $SCRIBES to verify it{s.verifiedSlot ? ` at slot ${s.verifiedSlot.toLocaleString()}` : ''}. The badge stays with the scribe forever, whoever holds it.</p>
      </div>
    );
  }
  if (!mine || s.status.state !== 'complete') return null;

  async function check() {
    setError('');
    setBusy('The bot is checking');
    try {
      const r = await fetch(`${API}/verify/${s.address}`, { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setVerdict(j);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function verify() {
    if (!verdict?.pass || !settings?.burnMint || !settings.token || !me) return;
    setError('');
    setBusy('Verifying');
    try {
      const mint = new PublicKey(settings.burnMint);
      const tokenProgram = new PublicKey(settings.token.program);
      const owner = new PublicKey(me);
      const b64 = (x: string) => Uint8Array.from(atob(x), (c) => c.charCodeAt(0));
      const pass = Ed25519Program.createInstructionWithPublicKey({
        publicKey: new PublicKey(verdict.pass.verifier).toBytes(), message: b64(verdict.pass.message), signature: b64(verdict.pass.signature),
      });
      const ix = await verifyInstruction(program, { owner, scribe: s.address, mint, tokenProgram, ownerTokens: getAssociatedTokenAddressSync(mint, owner, false, tokenProgram) });
      setSig(await sendInstructions([pass, ix]));
      setTimeout(onChange, 1500);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  const enough = settings && balance !== null && balance >= BigInt(settings.burnAmount);
  // the amount shown: the launch amount (50,000 $SCRIBES). The burn itself and the balance check use the program's setting.
  const shown = '50,000';
  return (
    <div className="panel">
      <div className="panel-head"><h3 className="gold-text">get verified</h3>
        {/* right side: the checks button (it says when they passed) and the unverified badge */}
        <span className="vhead-r">
          {open && (verdict?.ok
            ? <span className="run-checks done"><svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2 6.5l2.6 2.6L10 3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" /></svg>checks passed</span>
            : <button className="run-checks" disabled={!!busy} onClick={check}>{busy || <>{verdict ? 'run the checks again' : 'run the checks'}<span className="q">?</span></>}</button>)}
          <span className="chip">Unverified</span>
        </span>
      </div>
      {!open ? (
        <p className="muted" style={{ margin: 0 }}>Verification opens when $SCRIBES launches. It will check that {s.name} is complete and working, then burn 50,000 $SCRIBES for the badge.</p>
      ) : (
        <>
          <p className="muted">The bot checks that {s.name} is complete and answers a test prompt. Then you verify it in one transaction that <b>burns {shown} $SCRIBES</b>. The verification badge is permanent on chain.</p>
          {verdict && (
            <>
              <ul className="trail vchecks">{verdict.checks.map((c) => <li key={c.name} className={c.ok ? 'ok' : 'bad'}><span className="tr-a">{c.name.toLowerCase()}</span><span className="tr-b">, {c.detail.toLowerCase()}</span></li>)}</ul>
              {verdict.reply && <p className="vreply"><span>test prompt, {s.name}'s answer:</span> “{verdict.reply.trim().slice(0, 280)}”</p>}
              {verdict.ok ? (
                <div className="vgo">
                  {/* one button: it says when the wallet does not hold enough $scribes */}
                  <button className={`verify-go${balance !== null && !enough ? ' short' : ''}`} disabled={!!busy || !enough} onClick={verify}>{busy || (balance !== null && !enough ? `you need ${shown} $scribes to verify` : `verify, burn ${shown} $scribes`)}</button>
                </div>
              ) : null}
            </>
          )}
        </>
      )}
      {error && <div className="notice bad" style={{ marginTop: 10 }}>{error}</div>}
      {sig && <div className="notice info" style={{ marginTop: 10 }}>Verified. <a href={explorer('tx', sig)} target="_blank" rel="noreferrer">View transaction</a></div>}
    </div>
  );
}

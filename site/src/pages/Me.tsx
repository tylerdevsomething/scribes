// The connected wallet's scribes, its listings and its $SCRIBES balance (plus the test faucet off mainnet).
import { useEffect, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { getScribes, type ScribeView } from '../api.ts';
import { API, CLUSTER, conn, short, sol } from '../config.ts';
import { useWallet } from '../wallet.ts';
import { WalletButton } from '../WalletButton.tsx';
import { loadSettings, useSettings } from '../settings.ts';
import { ScribeCard } from './Gallery.tsx';
import { tokens } from './Verify.tsx';

export function Me() {
  const me = useWallet();
  const settings = useSettings();
  const [list, setList] = useState<ScribeView[] | null>(null);
  const [sol_, setSol] = useState<number | null>(null);
  const [tok, setTok] = useState<bigint | null>(null);
  const [drip, setDrip] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!me) return;
    getScribes().then((l) => setList(l.filter((s) => s.owner === me))).catch(() => setList([]));
    conn.getBalance(new PublicKey(me)).then(setSol).catch(() => {});
    if (settings?.burnMint && settings.token) {
      const ata = getAssociatedTokenAddressSync(new PublicKey(settings.burnMint), new PublicKey(me), false, new PublicKey(settings.token.program));
      conn.getTokenAccountBalance(ata).then((b) => setTok(BigInt(b.value.amount))).catch(() => setTok(0n));
    }
  }, [me, settings, tick]);

  async function faucet() {
    setDrip('Sending test funds…');
    try {
      const r = await fetch(`${API}/faucet`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ owner: me }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setDrip(`Sent ${j.sol ? `${j.sol} SOL and ` : ''}${j.tokens} test $SCRIBES.`);
      await loadSettings(true);
      setTick((n) => n + 1);
    } catch (e) {
      setDrip((e as Error).message);
    }
  }

  if (!me) {
    return (
      <div className="prose">
        <div className="eyebrow">Your collection</div>
        <h1>My scribes</h1>
        <p className="muted" style={{ fontSize: 17 }}>Connect a wallet to see the scribes you hold.</p>
        <WalletButton />
      </div>
    );
  }

  const listed = (list ?? []).filter((s) => s.listing);
  return (
    <div style={{ padding: '40px 0 64px' }}>
      <div className="eyebrow">Your collection</div>
      <h1>My scribes</h1>
      <div className="stats">
        <div><b>{list ? list.length : '—'}</b><span>scribes held</span></div>
        <div><b>{listed.length}</b><span>listed for sale</span></div>
        <div><b>{sol_ === null ? '—' : sol(sol_)}</b><span>SOL</span></div>
        <div><b>{tok === null || !settings ? '—' : tokens(tok, settings)}</b><span>$SCRIBES</span></div>
      </div>
      <p className="muted" style={{ fontSize: 13.5 }}>Wallet <code>{short(me)}</code></p>
      {settings?.faucet && CLUSTER !== 'mainnet' && (
        <div className="notice info" style={{ margin: '0 0 22px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span>Testing on {CLUSTER}? Get free test SOL and test $SCRIBES.</span>
          <button className="small" onClick={faucet}>Get test funds</button>
          {drip && <span>{drip}</span>}
        </div>
      )}
      {list && list.length === 0 && <div className="empty">You do not hold any scribes yet. <a href="#/create">Inscribe one</a> or <a href="#/">find one for sale</a>.</div>}
      <div className="grid">{(list ?? []).map((s) => <ScribeCard key={s.address} s={s} />)}</div>
    </div>
  );
}

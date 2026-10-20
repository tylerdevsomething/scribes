// The connected wallet's scribes, its listings and its $SCRIBE balance (plus the test faucet off mainnet).
import { useEffect, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { getScribes, type ScribeView } from '../api.ts';
import { API, conn, sol } from '../config.ts';
import { useWallet } from '../wallet.ts';
import { WalletButton } from '../WalletButton.tsx';
import { loadSettings, useSettings } from '../settings.ts';
import { ScribeCard } from './Gallery.tsx';
import { Folio } from '../Hero.tsx';
import { tokens } from './Verify.tsx';
import { Loading, useHold } from '../Loading.tsx';

export function Me() {
  const me = useWallet();
  const settings = useSettings();
  const [list, setList] = useState<ScribeView[] | null>(null);
  const [sol_, setSol] = useState<number | null>(null);
  const [tok, setTok] = useState<bigint | null>(null);
  const [drip, setDrip] = useState('');
  const [tick, setTick] = useState(0);
  const [q, setQ] = useState('');
  const wait = useHold(!!list);

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
      setDrip(`Sent ${j.sol ? `${j.sol} SOL and ` : ''}${j.tokens} test $SCRIBE.`);
      await loadSettings(true);
      setTick((n) => n + 1);
    } catch (e) {
      setDrip((e as Error).message);
    }
  }

  if (!me) {
    return (
      <Folio className="folio-hero stage">
        <div className="scene scene-models scene-me">
          <div className="models-paras brief-head">
            <h1 className="hero-title">my scribes</h1>
            <p>Connect a wallet to see the scribes you hold.</p>
          </div>
          <div className="me-connect"><WalletButton /></div>
        </div>
      </Folio>
    );
  }

  const listed = (list ?? []).filter((s) => s.listing);
  // the wallet's numbers as a chain of blocks, ruled like the data blocks on the home page
  return (
    <Folio className="folio-hero stage">
      <div className="scene scene-models scene-me scene-explore">
        {/* the title on the left, the wallet's numbers on the right as the overview's data blocks; the wallet itself is already in the header */}
        <div className="me-head">
          <div className="me-title">
            <h1 className="hero-title">my scribes</h1>
            <p>The scribes your wallet holds, what you have listed for sale and your SOL and $SCRIBE balances. Open any scribe to run it, list it or give it away.</p>
            {/* a search once there are more scribes than fit on one row */}
            {(list?.length ?? 0) > 5 && (
              <label className="browse-bar me-search"><i className="c2" />
                <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="2.4" /><path d="M13 13l5 5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" /></svg>
                <input type="search" placeholder="search your scribes" value={q} onChange={(e) => setQ(e.target.value)} />
              </label>
            )}
          </div>
        <div className="stat-chain">
          <div className="stat"><i className="c2" /><b>{list ? list.length : '0'}</b><span>scribes held</span></div>
          <i className="stat-link" />
          <div className="stat"><i className="c2" /><b>{listed.length}</b><span>listed for sale</span></div>
          <i className="stat-link" />
          <div className="stat"><i className="c2" /><b>{sol_ === null ? '0' : sol(sol_)}</b><span>sol</span></div>
          <i className="stat-link" />
          <div className="stat"><i className="c2" /><b>{tok === null || !settings ? '0' : tokens(tok, settings)}</b><span>$scribe</span></div>
          {/* the two columns joined top to bottom as well */}
          <i className="stat-link up left" /><i className="stat-link up right" />
        </div>
        </div>
        {wait && <Loading />}
        {!wait && list && list.length === 0 && (
          <div className="me-empty">
            <p>You do not hold any scribes yet.</p>
            <div className="model-go">
              <a className="show-all on" href="#/create">inscribe one</a>
              <a className="show-all" href="#/explore">find one for sale</a>
            </div>
          </div>
        )}
        <div className="grid me-grid">{(wait ? [] : list ?? []).filter((s) => !q || `${s.name ?? ''} ${s.purpose ?? ''}`.toLowerCase().includes(q.toLowerCase())).map((s) => <ScribeCard key={s.address} s={s} knight />)}</div>
      </div>
    </Folio>
  );
}

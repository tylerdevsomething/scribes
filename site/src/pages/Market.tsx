// The market panel on a scribe page: buy it, or (for its owner) list, reprice, cancel or give it.
import { useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { buyInstruction, cancelInstruction, giveInstruction, listInstruction, scribesProgram } from '../../../lib/src/registry.ts';
import type { ScribeView } from '../api.ts';
import { conn, explorer, sol } from '../config.ts';
import { sendInstructions, useWallet } from '../wallet.ts';
import { useSettings } from '../settings.ts';
import { WalletButton } from '../WalletButton.tsx';

const program = scribesProgram(conn);

export function MarketPanel({ s, onChange }: { s: ScribeView; onChange: () => void }) {
  const me = useWallet();
  const feeBps = useSettings()?.feeBps ?? null;
  const [price, setPrice] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ text: string; sig: string } | null>(null);

  const mine = me === s.owner;
  const listing = s.listing;

  async function run(label: string, build: () => Promise<Parameters<typeof sendInstructions>[0]>, text: string) {
    setError('');
    setBusy(label);
    try {
      const sig = await sendInstructions(await build());
      setDone({ text, sig });
      setPrice('');
      setTo('');
      setTimeout(onChange, 1500); // the indexer picks the change up on its next pass
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  const lamports = Math.round(Number(price) * 1e9);
  const validPrice = Number.isFinite(lamports) && lamports > 0;
  let validTo = false;
  try { validTo = !!to && new PublicKey(to.trim()).toBase58() !== s.owner; } catch { validTo = false; }
  const fee = (p: number) => (feeBps ? Math.floor((p * feeBps) / 10_000) : 0);

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Capsule</h3>
        <em className="hint">{listing ? '(for sale)' : '(not for sale)'}</em>
      </div>

      {listing && (
        <div className="price">
          <span className="amount">{sol(listing.price)}</span><span className="unit">SOL</span>
        </div>
      )}

      {/* the public sees only the status; listing and giving show only to the owner once their wallet is connected */}
      {!listing && !mine && <p className="muted cap-note">This scribe is not listed. Its owner can list it here by connecting their wallet.</p>}
      {!me && listing && (
        <div className="row"><WalletButton /><span className="muted" style={{ fontSize: 14 }}>Connect a wallet to buy.</span></div>
      )}

      {me && !mine && listing && (
        <>
          <button className="primary" disabled={!!busy} onClick={() => run('Buying', async () => [await buyInstruction(program, new PublicKey(me), s.address, listing.seller, listing.price)], `${s.name} is yours`)}>
            {busy || `Buy for ${sol(listing.price)} SOL`}
          </button>
          <p className="muted" style={{ fontSize: 13, margin: '10px 0 0' }}>You pay exactly the listed price; the transaction fails if the seller changes it first.</p>
        </>
      )}
      

      {mine && (
        <>
          <div className="row">
            <input className="grow" inputMode="decimal" placeholder={listing ? 'new price in sol' : 'price in sol'} value={price} onChange={(e) => setPrice(e.target.value)} />
            <button className="primary" disabled={!validPrice || !!busy} onClick={() => run('Listing', async () => [await listInstruction(program, new PublicKey(me), s.address, lamports)], `Listed for ${sol(lamports)} SOL`)}>
              {listing ? 'Change price' : 'List for sale'}
            </button>
            {listing && <button disabled={!!busy} onClick={() => run('Cancelling', async () => [await cancelInstruction(program, new PublicKey(me), s.address, me)], 'Listing cancelled')}>Cancel listing</button>}
          </div>
          {/* the fee line keeps its room while empty, so typing a price never moves anything below it */}
          <p className="muted" style={{ fontSize: 13, margin: '8px 0 0', visibility: validPrice && feeBps !== null ? 'visible' : 'hidden' }}>You receive {sol(validPrice ? lamports - fee(lamports) : 0)} SOL after the {(feeBps ?? 0) / 100}% sale fee.</p>
          <div className="row" style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
            <input className="grow" placeholder="give to a wallet address" value={to} onChange={(e) => setTo(e.target.value)} />
            <button disabled={!validTo || !!busy} onClick={() => run('Giving', async () => [
              ...(listing ? [await cancelInstruction(program, new PublicKey(me), s.address, me)] : []),
              await giveInstruction(program, new PublicKey(me), s.address, new PublicKey(to.trim())),
            ], `${s.name} was given away`)}>Give</button>
          </div>
          <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>A gift moves the capsule for free{listing ? ' and takes down the listing' : ''}. It cannot be undone.</p>
        </>
      )}

      {busy && <p className="muted" style={{ margin: '10px 0 0' }}>{busy}… approve it in your wallet.</p>}
      {error && <div className="notice bad" style={{ marginTop: 10 }}>{error}</div>}
      {done && <div className="notice info" style={{ marginTop: 10 }}>{done.text}. <a href={explorer('tx', done.sig)} target="_blank" rel="noreferrer">View transaction</a></div>}
    </div>
  );
}

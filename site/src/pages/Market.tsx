// The market panel on a scribe page: buy it, or (for its owner) list, reprice, cancel or give it.
import { useEffect, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { buyInstruction, cancelInstruction, giveInstruction, listInstruction, scribesProgram } from '../../../lib/src/registry.ts';
import type { ScribeView } from '../api.ts';
import { API, conn, explorer, sol } from '../config.ts';
import { sendInstructions, useWallet } from '../wallet.ts';
import { WalletButton } from '../WalletButton.tsx';

const program = scribesProgram(conn);

export function MarketPanel({ s, onChange }: { s: ScribeView; onChange: () => void }) {
  const me = useWallet();
  const [feeBps, setFeeBps] = useState<number | null>(null);
  const [price, setPrice] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ text: string; sig: string } | null>(null);
  useEffect(() => { fetch(`${API}/market`).then((r) => r.json()).then((j) => setFeeBps(j.feeBps)).catch(() => {}); }, []);

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
        {listing ? <span className="chip tan">For sale</span> : <span className="chip">Not for sale</span>}
      </div>

      {listing && (
        <div className="price">
          <span className="amount">{sol(listing.price)}</span><span className="unit">SOL</span>
        </div>
      )}

      {!me && (
        <div className="row"><WalletButton /><span className="muted" style={{ fontSize: 14 }}>{listing ? 'Connect a wallet to buy.' : 'Connect the owner\'s wallet to list or give.'}</span></div>
      )}

      {me && !mine && listing && (
        <>
          <button className="primary" disabled={!!busy} onClick={() => run('Buying', async () => [await buyInstruction(program, new PublicKey(me), s.address, listing.seller, listing.price)], `${s.name} is yours`)}>
            {busy || `Buy for ${sol(listing.price)} SOL`}
          </button>
          <p className="muted" style={{ fontSize: 13, margin: '10px 0 0' }}>You pay exactly the listed price; the transaction fails if the seller changes it first.</p>
        </>
      )}
      {me && !mine && !listing && <p className="muted" style={{ margin: 0 }}>The owner has not listed {s.name}.</p>}

      {mine && (
        <>
          <div className="row">
            <input className="grow" inputMode="decimal" placeholder={listing ? 'New price in SOL' : 'Price in SOL'} value={price} onChange={(e) => setPrice(e.target.value)} />
            <button className="primary" disabled={!validPrice || !!busy} onClick={() => run('Listing', async () => [await listInstruction(program, new PublicKey(me), s.address, lamports)], `Listed for ${sol(lamports)} SOL`)}>
              {listing ? 'Change price' : 'List for sale'}
            </button>
            {listing && <button disabled={!!busy} onClick={() => run('Cancelling', async () => [await cancelInstruction(program, new PublicKey(me), s.address, me)], 'Listing cancelled')}>Cancel listing</button>}
          </div>
          {validPrice && feeBps !== null && (
            <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>You receive {sol(lamports - fee(lamports))} SOL after the {feeBps / 100}% sale fee.</p>
          )}
          <div className="row" style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
            <input className="grow" placeholder="Give to a wallet address" value={to} onChange={(e) => setTo(e.target.value)} />
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

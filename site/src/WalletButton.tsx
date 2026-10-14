import { useState } from 'react';
import { connect, disconnect, useWallet, wallets } from './wallet.ts';
import { short } from './config.ts';

export function WalletButton() {
  const address = useWallet();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  if (address) {
    return <button className="small" title="Disconnect" onClick={() => disconnect()}><span className="dot" />{short(address)}</button>;
  }
  const found = wallets();
  return (
    <div className="menu-wrap">
      <button className="small primary" onClick={() => setOpen(!open)}>Connect</button>
      {open && (
        <div className="menu">
          {found.map((w) => (
            <button key={w.name} onClick={async () => {
              try { await connect(w.provider); setOpen(false); } catch (e) { setError((e as Error).message); }
            }}>{w.name}</button>
          ))}
          {found.length === 0 && <div className="muted" style={{ fontSize: 13, padding: 8 }}>Install Phantom, Solflare or Backpack.</div>}
          {error && <div className="bad" style={{ fontSize: 13, padding: 8 }}>{error}</div>}
        </div>
      )}
    </div>
  );
}

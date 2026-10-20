// Connect: a small framed menu under the button listing the wallets found in this browser. Each is a solid
// blue option with its own icon redrawn in the page colour, so it sits in the site's two colours.
import { useEffect, useState } from 'react';
import { connect, disconnect, useWallet, walletIcon, wallets } from './wallet.ts';
import { short } from './config.ts';


// The wallet's icon with only its light shapes kept, filled in the page colour (Phantom's ghost, for one).
function Glyph({ name }: { name: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    const url = walletIcon(name);
    if (!url) return;
    const img = new Image();
    img.onload = () => {
      const n = 64;
      const c = Object.assign(document.createElement('canvas'), { width: n, height: n });
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0, n, n);
      const d = g.getImageData(0, 0, n, n);
      for (let i = 0; i < d.data.length; i += 4) {
        const light = Math.min(d.data[i], d.data[i + 1], d.data[i + 2]) > 225 && d.data[i + 3] > 128; // near white only, not a pale background
        d.data[i] = 241; d.data[i + 1] = 241; d.data[i + 2] = 239; d.data[i + 3] = light ? 255 : 0;
      }
      g.putImageData(d, 0, 0);
      setSrc(c.toDataURL());
    };
    img.src = url;
  }, [name]);
  return src ? <img src={src} alt="" /> : <i className="wallet-blank" />;
}

export function WalletButton() {
  const address = useWallet();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  if (address) {
    return <button className="small" title="Disconnect" onClick={() => disconnect()}>{short(address)}</button>;
  }
  const found = wallets();
  return (
    <div className="menu-wrap">
      <button className="small primary" onClick={() => { setError(''); setOpen(!open); }}>Connect</button>
      {open && (
        <div className={`menu wallet-menu${found.length === 0 ? ' empty' : ''}`}>
          <i className="c2" />
          {/* a chain link from the connect button down to the menu, like the links between blocks elsewhere */}
          <i className="wallet-link" aria-hidden="true" />
          {found.map((w) => (
            <button key={w.name} type="button" onClick={async () => {
              try { await connect(w.provider); setOpen(false); } catch (e) { setError((e as Error).message); }
            }}><Glyph name={w.name} /><span>{w.name}</span></button>
          ))}
          {/* no wallet in the browser: just the one line, no options */}
          {found.length === 0 && <p className="wallet-none">no wallet found. please install one, then come back.</p>}
          {error && <p className="wallet-error">{error}</p>}
        </div>
      )}
    </div>
  );
}

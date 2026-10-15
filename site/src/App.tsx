import { Component, useEffect, useState, type ReactNode } from 'react';
import { Gallery } from './pages/Gallery.tsx';
import { ScribePage } from './pages/Scribe.tsx';
import { Create } from './pages/Create.tsx';
import { BriefPage } from './pages/Brief.tsx';
import { Me } from './pages/Me.tsx';
import { BountiesPage, BountyPage } from './pages/Bounties.tsx';
import { CLUSTER } from './config.ts';
import { Mark } from './Sigil.tsx';
import { WalletButton } from './WalletButton.tsx';

function useHash(): string {
  const [h, setH] = useState(location.hash.slice(1) || '/');
  useEffect(() => {
    const on = () => { setH(location.hash.slice(1) || '/'); window.scrollTo(0, 0); };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return h;
}

// A page that crashes shows a message (and the header stays usable) instead of a blank screen.
class Boundary extends Component<{ children: ReactNode; page: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidUpdate(prev: { page: string }) { if (prev.page !== this.props.page && this.state.error) this.setState({ error: null }); }
  render() {
    if (this.state.error) return <div className="prose"><div className="notice bad">Something went wrong on this page: {this.state.error.message}</div></div>;
    return this.props.children;
  }
}

export function App() {
  const path = useHash();
  const parts = path.split('/').filter(Boolean);
  let page;
  if (parts[0] === 'scribe' && parts[1]) page = <ScribePage key={parts[1]} address={parts[1]} />; // fresh state (and brain) per scribe
  else if (parts[0] === 'create') page = <Create />;
  else if (parts[0] === 'brief') page = <BriefPage />;
  else if (parts[0] === 'me') page = <Me />;
  else if (parts[0] === 'bounties') page = <BountiesPage />;
  else if (parts[0] === 'bounty' && parts[1]) page = <BountyPage key={parts[1]} address={parts[1]} />;
  else page = <Gallery />;
  const on = (p: string) => ((parts[0] ?? '') === p || (p === '' && parts[0] === 'scribe') ? 'on' : '');
  return (
    <>
      <header className="top">
        <div className="wrap">
          <a className="brand" href="#/"><Mark /><b>Scribes</b></a>
          <nav className="main">
            <a className={on('')} href="#/">Explore</a>
            <a className={on('create')} href="#/create">Inscribe</a>
            <a className={on('bounties') || on('bounty')} href="#/bounties">Bounties</a>
            <a className={on('brief')} href="#/brief">Brief</a>
            <a className={on('me')} href="#/me">My scribes</a>
          </nav>
          {CLUSTER !== 'mainnet' && <span className="net">{CLUSTER}</span>}
          <WalletButton />
        </div>
      </header>
      <main className="wrap"><Boundary page={path}>{page}</Boundary></main>
      <footer className="site">
        <div className="wrap">
          <span>Every scribe is inscribed on Solana and checked against its hashes before it runs.</span>
          <span>Scribes can never be deleted.</span>
        </div>
      </footer>
    </>
  );
}

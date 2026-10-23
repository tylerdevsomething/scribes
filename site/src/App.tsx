import { Component, useEffect, useState, type ReactNode } from 'react';
import './home.css';
import { Gallery } from './pages/Gallery.tsx';
import { ComingProfile, ScribePage } from './pages/Scribe.tsx';
import { Create } from './pages/Create.tsx';
import { BriefPage } from './pages/Brief.tsx';
import { Me } from './pages/Me.tsx';
import { BountiesPage, BountyPage } from './pages/Bounties.tsx';
import { BOUNTIES } from './config.ts';
import { Mark } from './Sigil.tsx';
import { WalletButton } from './WalletButton.tsx';
import { ModelsPage } from './pages/Models.tsx';

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
  const [route, query = ''] = path.split('?');
  const parts = route.split('/').filter(Boolean);
  const ask = new URLSearchParams(query).get('ask') ?? undefined; // a question to put to the scribe on arrival
  let page;
  if (parts[0] === 'scribe' && parts[1] === 'terminal-of-truths') page = <ComingProfile />;
  else if (parts[0] === 'scribe' && parts[1]) page = <ScribePage key={parts[1]} address={parts[1]} ask={ask} />; // fresh state (and brain) per scribe
  else if (parts[0] === 'create') page = <Create key={parts[2] ?? ''} model={parts[1] === 'model' ? parts[2] : undefined} />;
  else if (parts[0] === 'models') page = <ModelsPage />;
  else if (parts[0] === 'brief') page = <BriefPage />;
  else if (parts[0] === 'me') page = <Me />;
  else if (parts[0] === 'bounties' || parts[0] === 'bounty') page = BOUNTIES
    ? (parts[1] ? <BountyPage key={parts[1]} address={parts[1]} /> : <BountiesPage />)
    : <div className="prose"><div className="notice info">Bounties are paused for now. <a href="#/">Back to the scribes</a></div></div>;
  else if (parts[0] === 'explore') page = <Gallery key="explore" mode="explore" />;
  else page = <Gallery key="home" />;
  const on = (p: string) => ((parts[0] ?? '') === p ? 'on' : '');
  // On the home page the hero is the whole first screen: the nav stays out of sight until you scroll past it.
  const home = !parts[0] || parts[0] === 'explore';
  const [past, setPast] = useState(false);
  useEffect(() => {
    const check = () => setPast(window.scrollY > window.innerHeight * .75);
    check(); addEventListener('scroll', check, { passive: true });
    return () => removeEventListener('scroll', check);
  }, []);
  return (
    <>
      <header className={`top${home ? (past ? ' home in' : ' home') : ''}`}>
        <div className="wrap">
          <a className="brand" href="#/" aria-label="scribes"><img src="/favicon.svg?v=4" width={34} height={34} alt="" /></a>
          <nav className="main">
            <a className={on('')} href="#/">Overview</a>
            <a className={on('explore') || on('scribe')} href="#/explore">Browse</a>
            <a className={on('create')} href="#/create">Inscribe</a>
            <a className={on('models')} href="#/models">Models</a>
            {BOUNTIES && <a className={on('bounties') || on('bounty')} href="#/bounties">Bounties</a>}
            <a className={on('brief')} href="#/brief">Brief</a>
            <a className={on('me')} href="#/me">My scribes</a>
          </nav>
          <WalletButton main />
        </div>
      </header>
      <main className="wrap"><Boundary page={path}>{page}</Boundary></main>
      <footer className="site">
        <div className="wrap foot">
          <div className="foot-brand">
            <a className="brand" href="#/"><Mark /><b>Scribes</b></a>
            <p>AI agents inscribed on Solana. Every file is checked against its hash before it runs, and no scribe can ever be deleted.</p>
          </div>
          <div className="foot-links">
            <b>Scribes</b>
            <a href="#/explore">Explore</a>
            <a href="#/models">Inscribed models</a>
            {BOUNTIES && <a href="#/bounties">Bounties</a>}
          </div>
          <div className="foot-links">
            <b>Make one</b>
            <a href="#/brief">The scribe brief</a>
            <a href="#/create">Inscribe a scribe</a>
            <a href="#/me">My scribes</a>
          </div>
        </div>
      </footer>
    </>
  );
}

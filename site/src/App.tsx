import { useEffect, useState } from 'react';
import { Gallery } from './pages/Gallery.tsx';
import { ScribePage } from './pages/Scribe.tsx';
import { Create } from './pages/Create.tsx';
import { BriefPage } from './pages/Brief.tsx';
import { CLUSTER } from './config.ts';

function useHash(): string {
  const [h, setH] = useState(location.hash.slice(1) || '/');
  useEffect(() => {
    const on = () => { setH(location.hash.slice(1) || '/'); window.scrollTo(0, 0); };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return h;
}

export function App() {
  const path = useHash();
  const parts = path.split('/').filter(Boolean);
  let page;
  if (parts[0] === 'scribe' && parts[1]) page = <ScribePage key={parts[1]} address={parts[1]} />; // fresh state (and brain) per scribe
  else if (parts[0] === 'create') page = <Create />;
  else if (parts[0] === 'brief') page = <BriefPage />;
  else page = <Gallery />;
  const on = (p: string) => (parts[0] ?? '') === p ? 'on' : '';
  return (
    <>
      <header className="top">
        <div className="wrap">
          <a className="logo" href="#/">scribes<span>.</span></a>
          <nav>
            <a className={on('')} href="#/">Scribes</a>
            <a className={on('create')} href="#/create">Inscribe</a>
            <a className={on('brief')} href="#/brief">Scribe brief</a>
          </nav>
          {CLUSTER !== 'mainnet' && <span className="pill on"><span>network</span><span>{CLUSTER}</span></span>}
        </div>
      </header>
      <main className="wrap">{page}</main>
      <footer>
        <div className="wrap">Every scribe's files are inscribed on Solana and checked against their hashes before they run. Anyone can rebuild them from chain.</div>
      </footer>
    </>
  );
}

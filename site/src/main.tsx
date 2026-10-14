import { createRoot } from 'react-dom/client';
import { Buffer } from 'buffer';
import { App } from './App.tsx';
import './styles.css';

// @solana/web3.js expects Buffer in the browser.
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer ??= Buffer;

createRoot(document.getElementById('root')!).render(<App />);

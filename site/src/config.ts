import { Connection } from '@solana/web3.js';

export const API = '/api';
export const RPC_URL: string = import.meta.env?.VITE_RPC_URL ?? 'http://127.0.0.1:8899';
export const CLUSTER: string = import.meta.env?.VITE_CLUSTER ?? 'localnet';
export const conn = new Connection(RPC_URL, 'confirmed');

// Links to Solscan (mainnet and devnet); a local chain only opens in Solana Explorer.
export function explorer(kind: 'address' | 'tx', id: string): string {
  if (CLUSTER === 'localnet') return `https://explorer.solana.com/${kind}/${id}?cluster=custom&customUrl=${encodeURIComponent(RPC_URL)}`;
  return `https://solscan.io/${kind === 'address' ? 'account' : 'tx'}/${id}${CLUSTER === 'mainnet' ? '' : `?cluster=${CLUSTER}`}`;
}

// SOL amounts without trailing zeros: 2 → "2", 0.0020842 → "0.002084".
export const sol = (lamports: number) => String(parseFloat((lamports / 1e9).toFixed(lamports < 1e7 ? 6 : 4)));
export const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;

// "claude-opus-5-5" → "Claude Opus 5.5"; other ids are shown as they are.
export function modelName(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(id);
  return m ? `Claude ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : id;
}

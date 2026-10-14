import { Connection } from '@solana/web3.js';

export const API = '/api';
export const RPC_URL: string = import.meta.env.VITE_RPC_URL ?? 'http://127.0.0.1:8899';
export const CLUSTER: string = import.meta.env.VITE_CLUSTER ?? 'localnet';
export const conn = new Connection(RPC_URL, 'confirmed');

export function explorer(kind: 'address' | 'tx', id: string): string {
  const c = CLUSTER === 'mainnet' ? '' : CLUSTER === 'localnet'
    ? `?cluster=custom&customUrl=${encodeURIComponent(RPC_URL)}` : `?cluster=${CLUSTER}`;
  return `https://explorer.solana.com/${kind}/${id}${c}`;
}

export const sol = (lamports: number) => (lamports / 1e9).toFixed(lamports < 1e7 ? 6 : 4);
export const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;

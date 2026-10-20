// Browser wallets (Phantom, Solflare, Backpack) through their injected providers, with a tiny shared
// store so every page knows who is connected.
import { useEffect, useState } from 'react';
import { PublicKey, Transaction, VersionedTransaction, type TransactionInstruction } from '@solana/web3.js';
import { conn } from './config.ts';

interface Injected {
  publicKey?: { toBase58(): string } | null;
  connect(): Promise<{ publicKey: { toBase58(): string } } | void>;
  disconnect?(): Promise<void>;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
}

type W = Window & { phantom?: { solana?: Injected }; solflare?: Injected; backpack?: Injected };

// Each wallet's own icon, from the Wallet Standard registry (Phantom, Solflare and Backpack all register one).
const icons: Record<string, string> = {};
if (typeof window !== 'undefined') {
  const api = { register: (...ws: { name: string; icon: string }[]) => { for (const w of ws) icons[w.name] = w.icon; return () => {}; } };
  window.addEventListener('wallet-standard:register-wallet', ((e: CustomEvent<(a: typeof api) => void>) => e.detail(api)) as EventListener);
  window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api }));
}
export const walletIcon = (name: string): string | undefined => icons[name];

export function wallets(): { name: string; provider: Injected }[] {
  const w = window as W;
  const out: { name: string; provider: Injected }[] = [];
  if (w.phantom?.solana) out.push({ name: 'Phantom', provider: w.phantom.solana });
  if (w.solflare) out.push({ name: 'Solflare', provider: w.solflare });
  if (w.backpack) out.push({ name: 'Backpack', provider: w.backpack });
  return out;
}

let current: Injected | null = null;
let address: string | null = null;
const listeners = new Set<(a: string | null) => void>();

export async function connect(provider: Injected): Promise<PublicKey> {
  const r = await provider.connect();
  const key = (r && 'publicKey' in r ? r.publicKey : provider.publicKey);
  if (!key) throw new Error('the wallet did not share an address');
  current = provider;
  address = key.toBase58();
  listeners.forEach((f) => f(address));
  return new PublicKey(address);
}

export async function disconnect() {
  await current?.disconnect?.().catch(() => {});
  current = null;
  address = null;
  listeners.forEach((f) => f(null));
}

export function useWallet(): string | null {
  const [a, setA] = useState(address);
  useEffect(() => { listeners.add(setA); return () => { listeners.delete(setA); }; }, []);
  return a;
}

export async function signTransaction(tx: Transaction): Promise<Transaction> {
  if (!current) throw new Error('connect a wallet first');
  return current.signTransaction(tx);
}

// Signs a transaction someone else built (e.g. a Jupiter swap); the caller sends it.
export async function signVersioned(tx: VersionedTransaction): Promise<VersionedTransaction> {
  if (!current) throw new Error('connect a wallet first');
  return current.signTransaction(tx);
}

// Waits for a sent transaction by asking for its status (plain requests, no websocket, so it also works
// through the server's RPC pass-through); gives up once its blockhash has expired.
export async function confirmed(sig: string, lastValidBlockHeight: number): Promise<void> {
  for (;;) {
    const st = (await conn.getSignatureStatuses([sig])).value[0];
    if (st?.err) throw new Error(`the transaction failed: ${JSON.stringify(st.err)}`);
    if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return;
    if ((await conn.getBlockHeight('confirmed')) > lastValidBlockHeight) throw new Error('the transaction expired before it was confirmed: try again');
    await new Promise((r) => setTimeout(r, 1500));
  }
}

// Builds, signs (wallet) and sends instructions; resolves once confirmed.
export async function sendInstructions(ixs: TransactionInstruction[]): Promise<string> {
  if (!current || !address) throw new Error('connect a wallet first');
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: new PublicKey(address), blockhash, lastValidBlockHeight }).add(...ixs);
  const signed = await current.signTransaction(tx);
  const sig = await conn.sendRawTransaction(signed.serialize());
  await confirmed(sig, lastValidBlockHeight);
  return sig;
}

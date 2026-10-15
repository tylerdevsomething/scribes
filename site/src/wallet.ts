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

// Builds, signs (wallet) and sends instructions; resolves once confirmed.
export async function sendInstructions(ixs: TransactionInstruction[]): Promise<string> {
  if (!current || !address) throw new Error('connect a wallet first');
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: new PublicKey(address), blockhash, lastValidBlockHeight }).add(...ixs);
  const signed = await current.signTransaction(tx);
  const sig = await conn.sendRawTransaction(signed.serialize());
  const r = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  if (r.value.err) throw new Error(`the transaction failed: ${JSON.stringify(r.value.err)}`);
  return sig;
}

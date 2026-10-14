// Browser wallets (Phantom, Solflare, Backpack) through their injected providers.
import { PublicKey, Transaction } from '@solana/web3.js';

interface Injected {
  publicKey?: { toBase58(): string } | null;
  connect(): Promise<{ publicKey: { toBase58(): string } } | void>;
  disconnect?(): Promise<void>;
  signTransaction(tx: Transaction): Promise<Transaction>;
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

export async function connect(provider: Injected): Promise<PublicKey> {
  const r = await provider.connect();
  const key = (r && 'publicKey' in r ? r.publicKey : provider.publicKey);
  if (!key) throw new Error('the wallet did not share an address');
  current = provider;
  return new PublicKey(key.toBase58());
}

export async function signTransaction(tx: Transaction): Promise<Transaction> {
  if (!current) throw new Error('connect a wallet first');
  return current.signTransaction(tx);
}

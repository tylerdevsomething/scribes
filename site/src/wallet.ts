// Browser wallets (Phantom, Solflare, Backpack) through their injected providers, with a tiny shared
// store so every page knows who is connected.
import { useEffect, useState } from 'react';
import { PublicKey, Transaction, VersionedTransaction, type TransactionInstruction } from '@solana/web3.js';
import { conn } from './config.ts';

interface Injected {
  publicKey?: { toBase58(): string } | null;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toBase58(): string } } | void>;
  disconnect?(): Promise<void>;
  on?(event: string, f: (x?: unknown) => void): void;
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
const set = (a: string | null) => { address = a; listeners.forEach((f) => f(a)); };

// the wallet last connected is remembered in this browser, so a reload or a new page reconnects to it quietly
const KEPT = 'scribes-wallet';
const keep = (name: string | null) => { try { if (name) localStorage.setItem(KEPT, name); else localStorage.removeItem(KEPT); } catch {} };
const kept = (): string | null => { try { return localStorage.getItem(KEPT); } catch { return null; } };
const watched = new WeakSet<Injected>();

export async function connect(provider: Injected, quiet = false): Promise<PublicKey> {
  const r = await provider.connect(quiet ? { onlyIfTrusted: true } : undefined);
  const key = (r && 'publicKey' in r ? r.publicKey : provider.publicKey);
  if (!key) throw new Error('the wallet did not share an address');
  current = provider;
  const name = wallets().find((w) => w.provider === provider)?.name;
  if (name) keep(name);
  if (!watched.has(provider)) {
    watched.add(provider);
    // a switched account follows; a lost connection (the wallet locked, the page slept) tries to come back quietly
    provider.on?.('accountChanged', (k) => {
      if (current !== provider) return;
      if (k && typeof (k as { toBase58?: unknown }).toBase58 === 'function') set((k as { toBase58(): string }).toBase58());
      else provider.connect({ onlyIfTrusted: true }).then(() => { if (current === provider && provider.publicKey) set(provider.publicKey.toBase58()); }).catch(() => {});
    });
    provider.on?.('disconnect', () => {
      if (current !== provider) return;
      provider.connect({ onlyIfTrusted: true }).then(() => { if (current === provider && provider.publicKey) set(provider.publicKey.toBase58()); else { current = null; set(null); } })
        .catch(() => { if (current === provider) { current = null; set(null); } });
    });
  }
  set(key.toBase58());
  return new PublicKey(address!);
}

// only an explicit disconnect forgets the wallet
export async function disconnect() {
  const was = current;
  current = null;
  keep(null);
  set(null);
  await was?.disconnect?.().catch(() => {});
}

// on load: reconnect quietly to the remembered wallet, waiting a moment for the extension to inject itself
if (typeof window !== 'undefined' && kept()) {
  let tries = 0;
  const again = () => {
    if (address || !kept()) return;
    const w = wallets().find((x) => x.name === kept());
    if (w) connect(w.provider, true).catch(() => {});
    else if (++tries < 20) setTimeout(again, 250);
  };
  setTimeout(again, 0);
}

export const currentAddress = (): string | null => address;

// a wallet for an action that needs one (the inscribe button): the connected one, else the remembered or only
// wallet in this browser, else the header's wallet menu opens and this waits for a choice
let picker: (() => void) | null = null;
let picked: { ok: (a: string) => void; no: (e: Error) => void } | null = null;
export function onPick(open: (() => void) | null) { picker = open; }
export function pickClosed() { picked?.no(new Error('connect a wallet to inscribe')); picked = null; }
export async function ensureWallet(): Promise<string> {
  if (address) return address;
  const found = wallets();
  if (found.length === 0) throw new Error('install a solana wallet (phantom, solflare or backpack) to inscribe');
  const w = found.find((x) => x.name === kept()) ?? (found.length === 1 ? found[0] : null);
  if (w || !picker) return (await connect((w ?? found[0]).provider)).toBase58();
  picked?.no(new Error('connect a wallet to inscribe'));
  return new Promise((ok, no) => { picked = { ok, no }; picker!(); });
}
listeners.add((a) => { if (a && picked) { picked.ok(a); picked = null; } });

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

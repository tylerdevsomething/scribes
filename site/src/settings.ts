// Chain settings from the indexer (burn mint, sale fee, faucet), shared by every page.
import { useEffect, useState } from 'react';
import { API } from './config.ts';

export interface Settings {
  verifier: string;
  feeReceiver: string;
  birthFee: number;
  burnMint: string | null;
  burnAmount: string;
  births: number;
  token: { decimals: number; program: string } | null;
  feeBps: number | null;
  verificationOpen: boolean;
  faucet: boolean;
}

let cached: Promise<Settings> | null = null;
export function loadSettings(fresh = false): Promise<Settings> {
  if (!cached || fresh) cached = fetch(`${API}/settings`).then((r) => r.json());
  return cached;
}

export function useSettings(): Settings | null {
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => { loadSettings().then(setS).catch(() => {}); }, []);
  return s;
}

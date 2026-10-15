// Read-only mainnet data for the scribes' tools, whatever network the site runs on. The RPC key stays on
// the server: the browser asks us, we ask Helius. Only read methods are allowed, and each visitor is
// rate limited.
import type { IncomingMessage, ServerResponse } from 'node:http';

const READ_METHODS = new Set([
  'getBalance', 'getAccountInfo', 'getMultipleAccounts', 'getParsedTokenAccountsByOwner', 'getTokenAccountsByOwner',
  'getTokenLargestAccounts', 'getTokenSupply', 'getTransaction', 'getParsedTransaction', 'getSignaturesForAddress',
  'getRecentPrioritizationFees', 'getRecentPerformanceSamples', 'getEpochInfo', 'getSlot', 'getBlockHeight',
  'getAssetsByOwner', 'getAsset', 'searchAssets', 'getPriorityFeeEstimate',
]);
const PER_SECOND = 5;
const BURST = 15;

const buckets = new Map<string, { tokens: number; at: number }>();
function allowed(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip) ?? { tokens: BURST, at: now };
  b.tokens = Math.min(BURST, b.tokens + ((now - b.at) / 1000) * PER_SECOND);
  b.at = now;
  buckets.set(ip, b);
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

export class Mainnet {
  private rpc: string;
  private enhanced: string;
  constructor(rpcUrl: string) {
    this.rpc = rpcUrl;
    const key = new URL(rpcUrl).searchParams.get('api-key');
    this.enhanced = key ? `https://api-mainnet.helius-rpc.com/v0/%PATH%?api-key=${key}` : '';
  }

  // POST /mainnet/rpc  { method, params }             — one allowed JSON-RPC read
  // GET  /mainnet/history/:address?limit=&before=      — readable transaction history (swaps, transfers…)
  // POST /mainnet/transactions { signatures: [...] }   — readable transactions
  async handle(req: IncomingMessage, res: ServerResponse, parts: string[], url: URL, body: () => Promise<Record<string, unknown>>,
    json: (res: ServerResponse, code: number, data: unknown) => void) {
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '?').split(',')[0].trim();
    if (!allowed(ip)) return json(res, 429, { error: 'slow down: too many requests' });
    try {
      if (parts[1] === 'rpc' && req.method === 'POST') {
        const { method, params } = await body();
        if (typeof method !== 'string' || !READ_METHODS.has(method)) return json(res, 400, { error: `method not allowed: ${String(method)}` });
        const r = await fetch(this.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params ?? [] }) });
        const j = await r.json();
        return json(res, j.error ? 502 : 200, j.error ? { error: j.error.message } : { result: j.result });
      }
      if (!this.enhanced) return json(res, 404, { error: 'readable history needs a Helius key' });
      if (parts[1] === 'history' && parts[2] && req.method === 'GET') {
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(parts[2])) return json(res, 400, { error: 'bad address' });
        const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 20)));
        const before = url.searchParams.get('before');
        const u = this.enhanced.replace('%PATH%', `addresses/${parts[2]}/transactions`) + `&limit=${limit}${before ? `&before=${before}` : ''}`;
        const r = await fetch(u);
        return json(res, r.ok ? 200 : 502, await r.json());
      }
      if (parts[1] === 'transactions' && req.method === 'POST') {
        const { signatures } = await body();
        if (!Array.isArray(signatures) || signatures.length === 0 || signatures.length > 20) return json(res, 400, { error: 'signatures: 1 to 20' });
        const r = await fetch(this.enhanced.replace('%PATH%', 'transactions'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ transactions: signatures }) });
        return json(res, r.ok ? 200 : 502, await r.json());
      }
      return json(res, 404, { error: 'not found' });
    } catch (e) {
      return json(res, 502, { error: (e as Error).message });
    }
  }
}

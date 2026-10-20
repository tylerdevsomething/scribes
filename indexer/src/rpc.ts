// POST /rpc: the browser's Solana RPC, passed on to the server's own RPC so its key never reaches the page.
// Only the methods the site uses (reads, and sending transactions the visitor signed), program-wide scans
// only of the Scribes program, and a per-visitor rate limit.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SCRIBES_PROGRAM } from '../../lib/src/registry.ts';

const METHODS = new Set([
  'getAccountInfo', 'getMultipleAccounts', 'getBalance', 'getBlockHeight', 'getBlockTime', 'getLatestBlockhash',
  'isBlockhashValid', 'getSignatureStatuses', 'getSignaturesForAddress', 'getSlot', 'getEpochInfo', 'getTransaction',
  'getTokenAccountBalance', 'getTokenAccountsByOwner', 'getTokenSupply', 'getTokenLargestAccounts',
  'getMinimumBalanceForRentExemption', 'getFeeForMessage', 'getRecentPrioritizationFees', 'getGenesisHash',
  'getVersion', 'getHealth', 'getProgramAccounts', 'sendTransaction', 'simulateTransaction',
]);
const PER_MINUTE = 1200; // calls per visitor (a batch counts each call)
const MAX_BYTES = 200_000;

type Call = { jsonrpc?: string; id?: unknown; method?: string; params?: unknown[] };

export class RpcProxy {
  private upstream: string;
  private counts = new Map<string, { minute: number; n: number }>();

  constructor(upstream: string) { this.upstream = upstream; }

  private allowed(c: Call): string | null {
    if (!c || typeof c.method !== 'string' || !METHODS.has(c.method)) return `method ${String(c?.method)} is not available here`;
    if (c.method === 'getProgramAccounts' && c.params?.[0] !== SCRIBES_PROGRAM.toBase58()) return 'program scans are limited to the Scribes program';
    return null;
  }

  async handle(req: IncomingMessage, res: ServerResponse, visitor: string, raw: Uint8Array, json: (res: ServerResponse, code: number, data: unknown) => void) {
    if (raw.length > MAX_BYTES) return json(res, 413, { error: 'request too large' });
    let body: Call | Call[];
    try { body = JSON.parse(new TextDecoder().decode(raw)); } catch { return json(res, 400, { error: 'not JSON' }); }
    const calls = Array.isArray(body) ? body : [body];
    if (!calls.length || calls.length > 100) return json(res, 400, { error: 'between 1 and 100 calls per request' });
    for (const c of calls) {
      const why = this.allowed(c);
      if (why) return json(res, 403, { jsonrpc: '2.0', id: c?.id ?? null, error: { code: -32601, message: why } });
    }
    const minute = Math.floor(Date.now() / 60_000);
    const seen = this.counts.get(visitor);
    const n = (seen?.minute === minute ? seen.n : 0) + calls.length;
    if (n > PER_MINUTE) return json(res, 429, { jsonrpc: '2.0', id: null, error: { code: 429, message: 'too many requests: slow down' } });
    this.counts.set(visitor, { minute, n });
    if (this.counts.size > 50_000) for (const [k, v] of this.counts) if (v.minute !== minute) this.counts.delete(k);
    try {
      const up = await fetch(this.upstream, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      res.writeHead(up.status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(Buffer.from(await up.arrayBuffer()));
    } catch (e) {
      json(res, 502, { jsonrpc: '2.0', id: null, error: { code: 502, message: (e as Error).message.replace(/api-key=[^&\s]+/g, 'api-key=***') } });
    }
  }
}

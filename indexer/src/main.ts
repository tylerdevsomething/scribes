// Indexer server.
//   node indexer/src/main.ts --rpc <url> [--port 8790] [--cache .cache/indexer] [--every 5]
//
// GET /health           { syncedAt, scribes }
// GET /scribes          every scribe with status, attributes and rarity (hidden ones flagged, not removed)
// GET /scribe/:address  one scribe
// GET /market           { feeBps } the sale fee
// GET /activity[?scribe=&limit=]  births, verifications, listings, sales and gifts, newest first
// GET /models           inscribed models anyone can reuse (most used first)
// GET /settings         chain settings: verifier, burn mint and amount (+ decimals, token program), fees
// POST /verify/:address the bot's checks; a passing scribe gets a signed pass (needs --verifier)
// POST /faucet {owner}  test SOL and test tokens (only with --faucet, never on mainnet)
// GET /files/:sha256    a checked file of a valid, complete, not-hidden scribe
//
// Create flow (needs --writer, the server's writer key):
// POST /uploads                         → { id }
// PUT  /uploads/:id/:part/:name         raw body; part = personality | model | model-ref (a sha256) | brain | picture
// POST /uploads/:id/check               → the bot's report, attributes and quote
// POST /uploads/:id/checkout {owner}    → the one transaction for the owner to sign (writer already signed)
// POST /uploads/:id/submitted {signature}
// GET  /uploads/:id                     → phase and progress
//
// Production: --site <dir> also serves the built site (dist/site) from the same server; the API is
// then reachable under /api as well, as the site expects.
//
// Hidden scribes: list their addresses in <cache>/hidden.json. They stay on chain; the site just
// does not show them or serve their files.
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { Connection } from '@solana/web3.js';
import { Indexer } from './indexer.ts';
import { LIMITS, Uploads } from './uploads.ts';
import { runtimeFiles } from './runtime.ts';
import { Verifier } from './verifier.ts';
import { ActivityLog } from './activity.ts';
import { Faucet } from './faucet.ts';
import { Keypair, PublicKey } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';
import { readSettings, scribesProgram } from '../../lib/src/registry.ts';

const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(`--${k}`);
  if (i >= 0) return process.argv[i + 1];
  if (d === undefined) throw new Error(`--${k} is required`);
  return d;
};

const conn = new Connection(arg('rpc', process.env.RPC_URL ?? ''), 'confirmed');
const cache = arg('cache', '.cache/indexer');
const port = Number(arg('port', '8790'));
const every = Number(arg('every', '5')) * 1000;
const indexer = new Indexer(conn, cache);
const activity = new ActivityLog(conn, join(cache, 'activity.json'));
indexer.setOwnerHistory((scribe, slot) => activity.ownerAt(scribe, slot));
// A key is a keypair file, or env:NAME for a JSON key array in an environment variable (hosting).
const loadKey = (p: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(p.startsWith('env:') ? (process.env[p.slice(4)] ?? '') : readFileSync(p, 'utf8'))));
const writerPath = process.argv.includes('--writer') ? arg('writer') : null;
const uploads = writerPath
  ? new Uploads({
    conn, indexer, dir: join(cache, 'uploads'), runtime: runtimeFiles(), rps: Number(arg('rps', '40')),
    writer: loadKey(writerPath),
  })
  : null;
setInterval(() => uploads?.sweep(), 3600 * 1000);
const verifier = process.argv.includes('--verifier')
  ? new Verifier({ indexer, key: loadKey(arg('verifier')), anthropicKey: process.env.ANTHROPIC_API_KEY })
  : null;
const faucet = process.argv.includes('--faucet') ? new Faucet(conn, loadKey(arg('faucet'))) : null;

async function settings() {
  const s = await readSettings(scribesProgram(conn));
  let token: { decimals: number; program: string } | null = null;
  if (s.burnMint) {
    const info = await conn.getAccountInfo(new PublicKey(s.burnMint));
    if (info) token = { decimals: (await getMint(conn, new PublicKey(s.burnMint), 'confirmed', info.owner)).decimals, program: info.owner.toBase58() };
  }
  return { ...s, token, feeBps: indexer.feeBps, verificationOpen: !!(s.burnMint && token), faucet: !!faucet };
}

const MAX_JSON = 16 * 1024;
function body(req: import('node:http').IncomingMessage, limit: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let n = 0;
    req.on('data', (d: Buffer) => {
      n += d.length;
      if (n > limit) { reject(new Error(`body larger than ${limit} bytes`)); req.destroy(); return; }
      parts.push(d);
    });
    req.on('end', () => resolve(new Uint8Array(Buffer.concat(parts))));
    req.on('error', reject);
  });
}
async function jsonBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  return JSON.parse(new TextDecoder().decode(await body(req, MAX_JSON)) || '{}');
}

function loadHidden() {
  const p = join(cache, 'hidden.json');
  if (existsSync(p)) indexer.setHidden(JSON.parse(readFileSync(p, 'utf8')));
}

async function loop() {
  for (;;) {
    const t0 = Date.now();
    try {
      loadHidden();
      await indexer.sync();
      await activity.sync();
    } catch (e) {
      console.error('sync failed:', (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, Math.max(0, every - (Date.now() - t0))));
  }
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, PUT, OPTIONS', 'access-control-allow-headers': 'content-type' };
const json = (res: import('node:http').ServerResponse, code: number, data: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json', ...CORS });
  res.end(JSON.stringify(data));
};

async function uploadRoute(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, parts: string[]) {
  if (!uploads) return json(res, 404, { error: 'uploads are not enabled on this server' });
  const [, id, action, name] = parts;
  try {
    if (req.method === 'POST' && parts.length === 1) return json(res, 200, { id: uploads.create() });
    if (req.method === 'GET' && parts.length === 2) {
      const s = uploads.status(id);
      return s ? json(res, 200, s) : json(res, 404, { error: 'no such upload' });
    }
    if (req.method === 'PUT' && parts.length === 4) {
      if (!(action in LIMITS)) return json(res, 400, { error: `unknown part "${action}"` });
      uploads.put(id, action, name, await body(req, LIMITS[action]));
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && action === 'check') return json(res, 200, await uploads.check(id));
    if (req.method === 'POST' && action === 'checkout') {
      const { owner } = await jsonBody(req);
      return json(res, 200, await uploads.checkout(id, String(owner)));
    }
    if (req.method === 'POST' && action === 'submitted') {
      const { signature } = await jsonBody(req);
      await uploads.submitted(id, String(signature));
      return json(res, 200, uploads.status(id));
    }
    return json(res, 404, { error: 'not found' });
  } catch (e) {
    return json(res, 400, { error: (e as Error).message });
  }
}

const siteDir = process.argv.includes('--site') ? arg('site') : null;
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

// The built site: static files, index.html for anything else (the site routes with #).
function serveSite(res: import('node:http').ServerResponse, pathname: string) {
  const root = resolve(siteDir!);
  const clean = decodeURIComponent(pathname).replace(/^[/\\]+/, '');
  let path = resolve(root, clean || 'index.html');
  if (!path.startsWith(root + sep) || !existsSync(path) || statSync(path).isDirectory()) path = join(root, 'index.html');
  const ext = path.slice(path.lastIndexOf('.'));
  res.writeHead(200, {
    'content-type': TYPES[ext] ?? 'application/octet-stream',
    // Isolating the page (COOP/COEP) lets the in-browser runtime use several threads.
    'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp',
    'cache-control': clean.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(path).pipe(res);
}

createServer((req, res) => {
  let url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname.startsWith('/api/')) url = new URL(url.pathname.slice(4) + url.search, 'http://x');
  else if (siteDir && req.method === 'GET' && !/^\/(health|market|models|settings|activity|scribes|scribe|files|uploads|verify|faucet)(\/|$)/.test(url.pathname)) { serveSite(res, url.pathname); return; }
  const parts = url.pathname.split('/').filter(Boolean);
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
  if (parts[0] === 'uploads') { uploadRoute(req, res, parts); return; }
  if (parts[0] === 'health') return json(res, 200, { syncedAt: indexer.syncedAt, scribes: indexer.list().length });
  if (parts[0] === 'market') return json(res, 200, { feeBps: indexer.feeBps });
  if (parts[0] === 'models') return json(res, 200, indexer.models());
  if (parts[0] === 'activity') return json(res, 200, activity.list({ scribe: url.searchParams.get('scribe') ?? undefined, limit: Math.min(200, Number(url.searchParams.get('limit') ?? 50)) }));
  if (parts[0] === 'settings') { settings().then((s) => json(res, 200, s), (e) => json(res, 500, { error: e.message })); return; }
  if (parts[0] === 'verify' && parts.length === 2 && req.method === 'POST') {
    if (!verifier) return json(res, 404, { error: 'the verification bot is not running on this server' });
    verifier.verify(parts[1]).then((v) => json(res, 200, v), (e) => json(res, 400, { error: e.message }));
    return;
  }
  if (parts[0] === 'faucet' && req.method === 'POST') {
    if (!faucet) return json(res, 404, { error: 'no test faucet on this network' });
    jsonBody(req).then((b) => faucet.drip(new PublicKey(String(b.owner)))).then((r) => json(res, 200, r), (e) => json(res, 400, { error: e.message }));
    return;
  }
  if (parts[0] === 'scribes' && parts.length === 1) return json(res, 200, indexer.list());
  if (parts[0] === 'scribe' && parts.length === 2) {
    const s = indexer.get(parts[1]);
    return s ? json(res, 200, s) : json(res, 404, { error: 'no such scribe' });
  }
  if (parts[0] === 'files' && parts.length === 2 && /^[0-9a-f]{64}$/.test(parts[1])) {
    const path = indexer.filePath(parts[1]);
    if (!indexer.servable(parts[1]) || !existsSync(path)) return json(res, 404, { error: 'not served' });
    res.writeHead(200, {
      'content-type': 'application/octet-stream', 'content-length': statSync(path).size,
      'cache-control': 'public, max-age=31536000, immutable', // named by its hash: never changes
      ...CORS, 'cross-origin-resource-policy': 'cross-site',
    });
    createReadStream(path).pipe(res);
    return;
  }
  json(res, 404, { error: 'not found' });
}).listen(port, () => console.log(`indexer on http://localhost:${port}`));

loop();

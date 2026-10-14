// Indexer server.
//   node indexer/src/main.ts --rpc <url> [--port 8790] [--cache .cache/indexer] [--every 5]
//
// GET /health           { syncedAt, scribes }
// GET /scribes          every scribe with status, attributes and rarity (hidden ones flagged, not removed)
// GET /scribe/:address  one scribe
// GET /files/:sha256    a checked file of a valid, complete, not-hidden scribe
//
// Hidden scribes: list their addresses in <cache>/hidden.json. They stay on chain; the site just
// does not show them or serve their files.
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Connection } from '@solana/web3.js';
import { Indexer } from './indexer.ts';

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
    } catch (e) {
      console.error('sync failed:', (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, Math.max(0, every - (Date.now() - t0))));
  }
}

const json = (res: import('node:http').ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'health') return json(res, 200, { syncedAt: indexer.syncedAt, scribes: indexer.list().length });
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
      'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-site',
    });
    createReadStream(path).pipe(res);
    return;
  }
  json(res, 404, { error: 'not found' });
}).listen(port, () => console.log(`indexer on http://localhost:${port}`));

loop();

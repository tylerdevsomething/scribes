// End-to-end check of libraries against a running server (with --writer): a hybrid scribe is created with
// a library, inscribed, indexed, then searched, read and asked about through the free brain.
//   node tools/library-check.ts --api http://localhost:8790 --rpc <devnet> --key <owner.json> --library <a.library>[,<b.library>…] --query <words>
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Connection, Keypair, LAMPORTS_PER_SOL, Transaction } from '@solana/web3.js';

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); if (i < 0) throw new Error(`--${k} is required`); return process.argv[i + 1]; };
const api = arg('api'), query = arg('query');
const conn = new Connection(arg('rpc'), 'confirmed');
const owner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(arg('key'), 'utf8'))));
const libraries = arg('library').split(',').map((f) => ({ name: f.split(/[\/]/).pop()!, bytes: new Uint8Array(readFileSync(f)) }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(method: string, path: string, body?: unknown, raw?: Uint8Array) {
  const res = await fetch(api + path, {
    method, headers: raw ? { 'content-type': 'application/octet-stream' } : { 'content-type': 'application/json' },
    body: raw ? Buffer.from(raw) : body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${j.error}`);
  return { status: res.status, j };
}

const personality = { name: `Archivist ${Date.now() % 10000}`, purpose: 'Keeps an archive and answers from it.', voice: 'Plain and exact; quotes the archive.', boundaries: 'Never invents what the archive does not say.', tools: ['library'] };
const u8 = (s: string) => new TextEncoder().encode(s);

// a library without the tool, and a library on an inscribed brain, are refused at the check
{
  const { j: { id } } = await call('POST', '/uploads');
  await call('PUT', `/uploads/${id}/personality/personality.json`, undefined, u8(JSON.stringify({ ...personality, tools: [] })));
  await call('PUT', `/uploads/${id}/brain/brain.json`, undefined, u8(JSON.stringify({ kind: 'bound', provider: 'anthropic', model: 'claude-sonnet-5-5' })));
  for (const l of libraries) await call('PUT', `/uploads/${id}/library/${l.name}`, undefined, l.bytes);
  const { j: r } = await call('POST', `/uploads/${id}/check`);
  assert.ok(!r.ok && r.problems.some((p: string) => p.includes('add "library"')), 'a library needs the library tool');
  console.log('refused without the library tool ✓');
}

const { j: { id } } = await call('POST', '/uploads');
await call('PUT', `/uploads/${id}/personality/personality.json`, undefined, u8(JSON.stringify(personality)));
await call('PUT', `/uploads/${id}/brain/brain.json`, undefined, u8(JSON.stringify({ kind: 'bound', provider: 'anthropic', model: 'claude-sonnet-5-5' })));
for (const l of libraries) await call('PUT', `/uploads/${id}/library/${l.name}`, undefined, l.bytes);
const { j: report } = await call('POST', `/uploads/${id}/check`);
assert.ok(report.ok, `check failed: ${report.problems.join('; ')}`);
assert.equal(report.files.filter((f: { role: string }) => f.role === 'library').length, libraries.length, 'every library is one of the files');
console.log(`checked · ${report.quote.chunks} chunks · total ${(report.quote.totalLamports / LAMPORTS_PER_SOL).toFixed(6)} SOL`);

const { j: { tx } } = await call('POST', `/uploads/${id}/checkout`, { owner: owner.publicKey.toBase58() });
const t = Transaction.from(Buffer.from(tx, 'base64'));
t.partialSign(owner);
const sig = await conn.sendRawTransaction(t.serialize());
await conn.confirmTransaction(sig, 'confirmed');
await call('POST', `/uploads/${id}/submitted`, { signature: sig });
const t0 = Date.now();
for (;;) {
  const { j: s } = await call('GET', `/uploads/${id}`);
  if (s.phase === 'failed') throw new Error(s.error);
  if (s.phase === 'done') break;
  process.stdout.write(`\rinscribing ${s.done ?? 0}/${s.total ?? '?'}   `);
  await sleep(3000);
}
console.log(`\ninscribed in ${((Date.now() - t0) / 1000).toFixed(0)}s · scribe ${report.scribe}`);

// the indexer reads it back from chain, then builds the search index
let libs;
for (let i = 0; ; i++) {
  const r = await fetch(`${api}/library/${report.scribe}`);
  if (r.status === 200) { libs = (await r.json()).libraries; if (libs.length === libraries.length && libs.every((l: { state: string }) => l.state === 'ready')) break; }
  if (i > 200) throw new Error(`libraries never became ready (${r.status})`);
  await sleep(3000);
}
for (const l of libs) console.log(`library ${l.name} ready: ${l.title} · ${l.entries} entries · ${l.textBytes} bytes of text`);

const { j: { hits } } = await call('GET', `/library/${report.scribe}/search?q=${encodeURIComponent(query)}`);
assert.ok(hits.length > 0, 'the search finds something');
console.log(`search "${query}" → ${hits.length}: ${hits[0].path} · ${hits[0].snippet.replace(/\s+/g, ' ').slice(0, 100)}`);
const { j: page } = await call('GET', `/library/${report.scribe}/read?path=${encodeURIComponent(hits[0].path)}&offset=0`);
assert.ok(page.text?.length > 0, 'the entry reads as text');
const pics = (await Promise.all(libs.map(async (l: { name: string }) => (await call('GET', `/library/${report.scribe}/list?lib=${l.name}&limit=500`)).j))).flat();
console.log(`search spans: ${[...new Set(hits.map((h: { library: string }) => h.library))].join(', ')}`);
const pic = pics.find((e: { type: string }) => e.type.startsWith('image/'));
if (pic) {
  const r = await fetch(`${api}/library/${report.scribe}/raw?path=${encodeURIComponent(pic.path)}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), pic.type);
  assert.equal((await r.arrayBuffer()).byteLength, pic.size, 'the picture comes back whole');
  console.log(`picture ${pic.path} ✓`);
}

// the free brain is given the library tools and reaches for them
const res = await fetch(`${api}/brain`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scribe: report.scribe, messages: [{ role: 'user', content: `What does your archive say about ${query}?` }] }) });
let done: { content: { type: string; name?: string; input?: unknown }[] } | null = null, err = '';
for (const l of (await res.text()).split('\n')) {
  if (!l.startsWith('data: ')) continue;
  const e = JSON.parse(l.slice(6));
  if (e.type === 'done') done = e.message;
  if (e.type === 'error') err = e.error;
}
assert.ok(done, `the brain answered: ${err}`);
const use = done!.content.find((b) => b.type === 'tool_use');
assert.equal(use?.name, 'library_search', 'the scribe searches its library');
console.log(`brain → ${use!.name} ${JSON.stringify(use!.input)} ✓`);
console.log('library check passed');
process.exit(0); // the RPC connection would keep the process open

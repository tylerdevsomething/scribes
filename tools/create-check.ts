// End-to-end check of the create flow against a running server, as a brand-new user would do it:
// upload → check → checkout → sign once → submitted → inscribed → the indexer lists it.
//   node tools/create-check.ts --api http://localhost:8790 --rpc http://127.0.0.1:8899 --model <file.gguf>
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { Connection, Keypair, LAMPORTS_PER_SOL, Transaction } from '@solana/web3.js';

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); if (i < 0) throw new Error(`--${k} is required`); return process.argv[i + 1]; };
const api = arg('api');
const conn = new Connection(arg('rpc'), 'confirmed');

async function call(method: string, path: string, body?: unknown, raw?: Uint8Array) {
  const res = await fetch(api + path, {
    method,
    headers: raw ? { 'content-type': 'application/octet-stream' } : { 'content-type': 'application/json' },
    body: raw ? Buffer.from(raw) : body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${j.error}`);
  return j;
}

async function create(user: Keypair, parts: Record<string, [string, Uint8Array]>, label: string) {
  const { id } = await call('POST', '/uploads');
  for (const [part, [name, bytes]] of Object.entries(parts)) await call('PUT', `/uploads/${id}/${part}/${name}`, undefined, bytes);
  const report = await call('POST', `/uploads/${id}/check`);
  if (!report.ok) return { id, report };
  console.log(`  ${label}: checked · ${report.quote.chunks} chunks to write · total ${(report.quote.totalLamports / LAMPORTS_PER_SOL).toFixed(6)} SOL · reused: ${report.files.filter((f: { reused: boolean }) => f.reused).map((f: { name: string }) => f.name).join(', ') || 'none'}`);
  const { tx } = await call('POST', `/uploads/${id}/checkout`, { owner: user.publicKey.toBase58() });
  const t = Transaction.from(Buffer.from(tx, 'base64'));
  t.partialSign(user); // the user's one signature
  const before = await conn.getBalance(user.publicKey);
  const sig = await conn.sendRawTransaction(t.serialize());
  await conn.confirmTransaction(sig, 'confirmed');
  const paid = before - (await conn.getBalance(user.publicKey));
  await call('POST', `/uploads/${id}/submitted`, { signature: sig });
  for (;;) {
    const s = await call('GET', `/uploads/${id}`);
    if (s.phase === 'done') break;
    if (s.phase === 'failed') throw new Error(`${label}: ${s.error}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`  ${label}: signed once, paid ${(paid / LAMPORTS_PER_SOL).toFixed(6)} SOL (incl. network fee), inscribed`);
  return { id, report };
}

async function main() {
  const user = Keypair.generate();
  await conn.confirmTransaction(await conn.requestAirdrop(user.publicKey, 2 * LAMPORTS_PER_SOL), 'confirmed');
  const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
  const tag = Date.now().toString(36);

  // Problems are reported, nothing is charged.
  const bad = await create(user, { personality: ['personality.json', enc({ name: 'x' })], model: ['fake.gguf', new TextEncoder().encode('not a model')] }, 'broken upload');
  assert.equal(bad.report.ok, false);
  console.log(`  broken upload refused: ${bad.report.problems.join(' | ')}`);

  // An inscribed brain reusing a model that is already on chain, with a picture.
  const png = await sharp({ create: { width: 900, height: 600, channels: 3, background: { r: 30, g: 120, b: 160 } } }).png().toBuffer();
  const a = await create(user, {
    personality: ['personality.json', enc({ name: `Pip ${tag}`, purpose: 'Counts the stars.', voice: 'Soft and sleepy.', boundaries: 'Stays gentle.' })],
    model: ['stories260K.gguf', new Uint8Array(readFileSync(arg('model')))],
    picture: ['photo.png', new Uint8Array(png)],
  }, 'inscribed brain');
  assert.ok(a.report.files.find((f: { role: string }) => f.role === 'model').reused, 'the model should be reused');
  assert.ok(a.report.files.find((f: { role: string }) => f.role === 'picture').size <= 100 * 1024);

  // A bound brain.
  const b = await create(user, {
    personality: ['personality.json', enc({ name: `Quill ${tag}`, purpose: 'Edits your writing.', voice: 'Kind but exact.', boundaries: 'Never rewrites without asking.' })],
    brain: ['brain.json', enc({ kind: 'bound', provider: 'anthropic', model: 'claude-sonnet' })],
  }, 'bound brain');

  // The indexer picks both up, complete.
  for (const r of [a.report, b.report]) {
    for (let i = 0; ; i++) {
      const s = await fetch(`${api}/scribe/${r.scribe}`).then((x) => x.json());
      if (s.status?.state === 'complete') {
        assert.equal(s.owner, user.publicKey.toBase58());
        console.log(`  indexer: ${s.name} #${s.birthNumber + 1} complete, rank ${s.rarity.rank}`);
        break;
      }
      if (i > 60) throw new Error(`indexer never completed ${r.scribe}: ${JSON.stringify(s.status)}`);
      await new Promise((x) => setTimeout(x, 1000));
    }
  }
  console.log('create flow: all good');
}

main().catch((e) => { console.error(e); process.exit(1); });

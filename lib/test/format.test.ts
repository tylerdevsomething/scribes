import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Keypair, PublicKey } from '@solana/web3.js';
import { CHUNK_BYTES, chunkCount, chunkSlice, decodeChunk, encodeChunk } from '../src/chunk.ts';
import { chunkTransaction, fileTag } from '../src/chain.ts';
import { decodeManifest, encodeManifest, formatLink, parseLink, type Manifest } from '../src/manifest.ts';
import { parsePersonality, systemPrompt, wordCount } from '../src/personality.ts';
import { readGguf } from '../src/gguf.ts';
import { sha256Hex } from '../src/bytes.ts';

test('chunks round-trip and reject foreign data', () => {
  const bytes = new Uint8Array(CHUNK_BYTES).map((_, i) => i % 251);
  const c = decodeChunk(encodeChunk(77_000, bytes));
  assert.equal(c?.index, 77_000);
  assert.deepEqual(c?.bytes, bytes);
  assert.equal(decodeChunk(new Uint8Array([1, 2, 3])), null);
  const wrong = encodeChunk(1, bytes); wrong[4] = 2;
  assert.equal(decodeChunk(wrong), null);
  assert.throws(() => encodeChunk(0, new Uint8Array(CHUNK_BYTES + 1)));
  assert.throws(() => encodeChunk(0, new Uint8Array(0)));
});

test('a file splits into chunks that join back to the file', () => {
  const file = new Uint8Array(CHUNK_BYTES * 3 + 5).map((_, i) => i % 7);
  assert.equal(chunkCount(file.length), 4);
  const parts = Array.from({ length: 4 }, (_, i) => chunkSlice(file, i));
  assert.equal(parts[3].length, 5);
  assert.deepEqual(Uint8Array.from(parts.flatMap((p) => [...p])), file);
});

test('a full chunk transaction fits the 1232-byte limit, with a priority fee', async () => {
  const writer = Keypair.generate();
  const tag = await fileTag('ab'.repeat(32), writer.publicKey);
  const tx = chunkTransaction({
    writer: writer.publicKey, tag, index: 0xffffffff, bytes: new Uint8Array(CHUNK_BYTES).fill(255),
    blockhash: new PublicKey(new Uint8Array(32).fill(9)).toBase58(), microLamports: 1_000_000,
  });
  tx.sign(writer);
  const size = tx.serialize().length;
  assert.ok(size <= 1232, `transaction is ${size} bytes`);
});

test('file tags depend on both the file and the writer', async () => {
  const a = Keypair.generate().publicKey, b = Keypair.generate().publicKey;
  const h = 'cd'.repeat(32);
  assert.ok((await fileTag(h, a)).equals(await fileTag(h, a)));
  assert.ok(!(await fileTag(h, a)).equals(await fileTag(h, b)));
  assert.ok(!(await fileTag(h, a)).equals(await fileTag('ce'.repeat(32), a)));
});

const W = Keypair.generate().publicKey.toBase58();
const base = (): Manifest => ({
  format: 'scribes:v1:manifest',
  brain: { kind: 'inscribed', model: '11'.repeat(32) },
  files: [
    { role: 'runtime', name: 'runtime.wasm', size: 10, sha256: '22'.repeat(32), writer: W },
    { role: 'model', name: 'brain.gguf', size: 10, sha256: '11'.repeat(32), writer: W },
    { role: 'personality', name: 'personality.json', size: 10, sha256: '33'.repeat(32), writer: W },
  ],
});

test('manifests encode canonically and round-trip', () => {
  const bytes = encodeManifest(base());
  const shuffled = base(); shuffled.files.reverse();
  assert.deepEqual(encodeManifest(shuffled), bytes);
  const m = decodeManifest(bytes);
  assert.equal(m.files[0].role, 'personality');
  const spaced = new TextEncoder().encode(JSON.stringify(JSON.parse(new TextDecoder().decode(bytes)), null, 1));
  assert.throws(() => decodeManifest(spaced), /canonical/);
});

test('manifests reject broken brains and bad files', () => {
  const noModel = base(); noModel.brain = { kind: 'inscribed', model: '44'.repeat(32) };
  assert.throws(() => encodeManifest(noModel), /brain/);
  const noRuntime = base(); noRuntime.files = noRuntime.files.filter((f) => f.role !== 'runtime');
  assert.throws(() => encodeManifest(noRuntime), /runtime/);
  const bound = base(); bound.brain = { kind: 'bound', provider: 'anthropic', model: 'claude-sonnet' };
  bound.files = bound.files.filter((f) => f.role === 'personality');
  assert.doesNotThrow(() => encodeManifest(bound));
  const twoPersonalities = base(); twoPersonalities.files.push({ ...twoPersonalities.files[2], name: 'other.json' });
  assert.throws(() => encodeManifest(twoPersonalities), /personality/);
  const badName = base(); badName.files[0].name = '../x';
  assert.throws(() => encodeManifest(badName), /name/);
});

test('links round-trip', () => {
  const l = { writer: W, sha256: 'ef'.repeat(32), size: 1234 };
  assert.deepEqual(parseLink(formatLink(l)), l);
  assert.throws(() => parseLink('scribes:v1:nope:12'));
});

test('personalities are checked and turned into a system prompt', () => {
  const p = parsePersonality(JSON.stringify({ name: 'Mott', purpose: 'Keep the light.', voice: 'Salty.', boundaries: 'Never lie.', memory: ['The storm of 1987.'] }));
  assert.match(systemPrompt(p), /You are Mott\./);
  assert.match(systemPrompt(p), /storm of 1987/);
  assert.equal(wordCount(p), 11);
  assert.throws(() => parsePersonality('{"name":"x"}'), /purpose/);
  assert.throws(() => parsePersonality(JSON.stringify({ name: 'a', purpose: 'b', voice: 'c', boundaries: 'd', extra: 1 })), /unknown/);
});

const models = '.cache/models';
for (const [file, arch] of [['stories260K.gguf', 'llama'], ['SmolLM2-135M-Instruct-Q4_0.gguf', 'llama']] as const) {
  test(`reads and checks a real GGUF: ${file}`, { skip: !existsSync(`${models}/${file}`) }, () => {
    const bytes = new Uint8Array(readFileSync(`${models}/${file}`));
    const info = readGguf(bytes);
    assert.equal(info.architecture, arch);
    assert.ok(info.parameters > 0);
    console.log(file, info.name, info.sizeLabel, info.parameters, 'params', info.tensorCount, 'tensors');
    // A file with bytes added or removed is not a model any more.
    assert.throws(() => readGguf(bytes.subarray(0, bytes.length - 4096)));
    const padded = new Uint8Array(bytes.length + 4096); padded.set(bytes);
    assert.throws(() => readGguf(padded), /unexplained/);
  });
}

test('GGUF check refuses things that are not models', async () => {
  assert.throws(() => readGguf(new TextEncoder().encode('hello world, definitely not a model')), /GGUF/);
  assert.equal((await sha256Hex(new Uint8Array())).length, 64);
});

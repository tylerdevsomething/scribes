// Packs a folder into a scribe library (lib/src/library.ts): text (.txt, .md) and pictures, brotli-compressed.
//   node tools/library-build.ts --dir <folder> --title "Infinite Backrooms" [--source https://…] --out backrooms.library
// Titles come from <folder>/titles.json ({ "path": "title" }) if it is there, else a text file's first line
// or the file name. Entries keep the folder's order (sorted paths).
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';
import { encodeLibrary, type LibraryType } from '../lib/src/library.ts';
import { sha256Hex } from '../lib/src/bytes.ts';
import { chunkCount } from '../lib/src/chunk.ts';

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); if (i >= 0) return process.argv[i + 1]; if (d === undefined) throw new Error(`--${k} is required`); return d; };
const dir = arg('dir'), title = arg('title'), source = arg('source', '') || null, out = arg('out');

const TYPES: Record<string, LibraryType> = { txt: 'text/plain', md: 'text/markdown', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const titles: Record<string, string> = existsSync(join(dir, 'titles.json')) ? JSON.parse(readFileSync(join(dir, 'titles.json'), 'utf8')) : {};

const docs = walk(dir).map((p) => ({ p, path: relative(dir, p).split(sep).join('/') })).filter(({ path }) => path !== 'titles.json').sort((a, b) => (a.path < b.path ? -1 : 1)).flatMap(({ p, path }) => {
  const type = TYPES[path.split('.').pop()!.toLowerCase()];
  if (!type) { console.log(`skipped ${path}`); return []; }
  const bytes = new Uint8Array(readFileSync(p));
  const first = type.startsWith('text/') ? new TextDecoder().decode(bytes.subarray(0, 400)).split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean) : undefined;
  return [{ path, type, bytes, title: (titles[path] ?? first ?? path).slice(0, 300) }];
});

const raw = encodeLibrary(title, source, docs);
const packed = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } });
writeFileSync(out, packed);
const chunks = chunkCount(packed.length);
console.log(`${docs.length} entries · ${(raw.length / 1e6).toFixed(1)} MB → ${(packed.length / 1e6).toFixed(1)} MB (${(raw.length / packed.length).toFixed(2)}x)`);
console.log(`${chunks.toLocaleString()} chunks · about ${((chunks * 5000 * 1.1) / 1e9).toFixed(4)} SOL to inscribe · sha256 ${await sha256Hex(packed)}`);
console.log(`wrote ${out}`);

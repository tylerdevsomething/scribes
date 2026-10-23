// A library: a whole archive of documents (and their pictures) in one inscribed file, so a scribe can
// carry it and look things up in it. Before compression the file is one line of JSON (the header), then
// every entry's bytes in header order; the inscribed file is that, brotli-compressed. Compression lives
// with the callers (Node's zlib), so this module also runs in the browser.
import { utf8, decodeUtf8 } from './bytes.ts';

export const LIBRARY_FORMAT = 'scribes:v1:library';
export const LIBRARY_TYPES = ['text/plain', 'text/markdown', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export type LibraryType = (typeof LIBRARY_TYPES)[number];

export interface LibraryEntry { path: string; title: string; type: LibraryType; size: number }
export interface LibraryHeader { format: typeof LIBRARY_FORMAT; title: string; source: string | null; entries: LibraryEntry[] }

export const LIBRARY_MAX_ENTRIES = 200_000;
export const LIBRARY_MAX_HEADER = 32 * 1024 * 1024;
const PATH = /^[A-Za-z0-9._-][A-Za-z0-9._/-]{0,199}$/;

export function isText(t: LibraryType): boolean { return t.startsWith('text/'); }

export function checkLibraryHeader(h: unknown): LibraryHeader {
  const x = h as LibraryHeader;
  if (typeof x !== 'object' || x === null || x.format !== LIBRARY_FORMAT) throw new Error('not a scribes v1 library');
  if (typeof x.title !== 'string' || !x.title.trim() || x.title.length > 200) throw new Error('library title must be 1 to 200 characters');
  if (x.source !== null && (typeof x.source !== 'string' || x.source.length > 500)) throw new Error('library source must be a link or null');
  if (!Array.isArray(x.entries) || x.entries.length === 0 || x.entries.length > LIBRARY_MAX_ENTRIES) throw new Error(`a library holds 1 to ${LIBRARY_MAX_ENTRIES} entries`);
  const seen = new Set<string>();
  const entries = x.entries.map((e) => {
    if (typeof e?.path !== 'string' || !PATH.test(e.path) || e.path.includes('..')) throw new Error(`bad library path "${e?.path}"`);
    if (seen.has(e.path)) throw new Error(`duplicate library path ${e.path}`);
    seen.add(e.path);
    if (typeof e.title !== 'string' || e.title.length > 300) throw new Error(`bad title for ${e.path}`);
    if (!LIBRARY_TYPES.includes(e.type)) throw new Error(`unsupported type ${e.type} for ${e.path}`);
    if (!Number.isSafeInteger(e.size) || e.size < 0) throw new Error(`bad size for ${e.path}`);
    return { path: e.path, title: e.title, type: e.type, size: e.size };
  });
  return { format: LIBRARY_FORMAT, title: x.title.trim(), source: x.source, entries };
}

// The uncompressed bytes of a library: header line, then each entry's bytes.
export function encodeLibrary(title: string, source: string | null, docs: { path: string; title: string; type: LibraryType; bytes: Uint8Array }[]): Uint8Array {
  const header = checkLibraryHeader({ format: LIBRARY_FORMAT, title, source, entries: docs.map((d) => ({ path: d.path, title: d.title, type: d.type, size: d.bytes.length })) });
  const head = utf8.encode(`${JSON.stringify(header)}\n`);
  const out = new Uint8Array(head.length + docs.reduce((n, d) => n + d.bytes.length, 0));
  out.set(head, 0);
  let at = head.length;
  for (const d of docs) { out.set(d.bytes, at); at += d.bytes.length; }
  return out;
}

export function decodeLibraryHeader(line: Uint8Array): LibraryHeader {
  return checkLibraryHeader(JSON.parse(decodeUtf8(line)));
}

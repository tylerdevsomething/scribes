// Libraries, server side. A scribe's inscribed library (lib/src/library.ts) is unpacked once into a
// SQLite full-text index on disk, so the scribe's library tools and the site can search and read it
// without anyone downloading the whole archive. The index is only a cache: the inscribed file stays the
// source, and anyone can rebuild the same index from it.
import { createReadStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createBrotliDecompress } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { LIBRARY_MAX_HEADER, decodeLibraryHeader, isText, type LibraryEntry, type LibraryHeader } from '../../lib/src/library.ts';

// Reads a library file entry by entry, never holding the whole archive in memory. Throws if the bytes
// do not match the header.
export async function* readLibrary(path: string): AsyncGenerator<{ header: LibraryHeader } | { entry: LibraryEntry; bytes: Buffer }> {
  let buf: Buffer = Buffer.alloc(0), header: LibraryHeader | null = null, i = 0;
  const take = function* (): Generator<{ entry: LibraryEntry; bytes: Buffer }> {
    while (header && i < header.entries.length && buf.length >= header.entries[i].size) {
      const entry = header.entries[i++];
      yield { entry, bytes: buf.subarray(0, entry.size) };
      buf = buf.subarray(entry.size);
    }
  };
  for await (const chunk of createReadStream(path).pipe(createBrotliDecompress()) as AsyncIterable<Buffer>) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    if (!header) {
      const nl = buf.indexOf(10);
      if (nl < 0) { if (buf.length > LIBRARY_MAX_HEADER) throw new Error('the library header is too large'); continue; }
      header = decodeLibraryHeader(buf.subarray(0, nl));
      buf = buf.subarray(nl + 1);
      yield { header };
    }
    yield* take();
  }
  yield* take(); // empty entries at the very end
  if (!header) throw new Error('not a library (no header)');
  if (i < header.entries.length || buf.length) throw new Error('the library bytes do not match its header');
}

export interface LibraryHit { path: string; title: string; snippet: string; rank: number } // rank: bm25, lower is better
export interface LibraryInfo { title: string; source: string | null; entries: number; textBytes: number }
type Status = { state: 'ready' } | { state: 'building'; done: number; total: number } | { state: 'failed'; error: string };

export class Libraries {
  private dir: string;
  private dbs = new Map<string, DatabaseSync>();
  private status = new Map<string, Status>();
  private queue: { sha: string; file: string }[] = [];
  private running = false;

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
  }

  private path(sha: string) { return join(this.dir, `${sha}.db`); }

  // The library's state; queues the build the first time it is asked for.
  ensure(sha: string, file: string): Status {
    const s = this.status.get(sha);
    if (s) return s;
    if (existsSync(this.path(sha))) { this.status.set(sha, { state: 'ready' }); return { state: 'ready' }; }
    const b: Status = { state: 'building', done: 0, total: 0 };
    this.status.set(sha, b);
    this.queue.push({ sha, file });
    if (!this.running) this.run();
    return b;
  }

  private async run() {
    this.running = true;
    while (this.queue.length) {
      const { sha, file } = this.queue.shift()!;
      try {
        await this.build(sha, file);
        this.status.set(sha, { state: 'ready' });
        console.log(`library ${sha.slice(0, 8)}: ready`);
      } catch (e) {
        this.status.set(sha, { state: 'failed', error: (e as Error).message });
        console.error(`library ${sha.slice(0, 8)}: ${(e as Error).message}`);
      }
    }
    this.running = false;
  }

  // Entries go into the index as they are read, a batch per transaction, so the server keeps answering.
  private async build(sha: string, file: string) {
    const tmp = join(this.dir, `${sha}.building`);
    rmSync(tmp, { force: true });
    const db = new DatabaseSync(tmp);
    try {
      db.exec(`
        PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;
        CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT);
        CREATE TABLE entries (id INTEGER PRIMARY KEY, path TEXT UNIQUE NOT NULL, title TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL, text TEXT, bytes BLOB);
        CREATE VIRTUAL TABLE fts USING fts5(title, text, content = 'entries', content_rowid = 'id', tokenize = 'unicode61 remove_diacritics 2');
      `);
      const meta = db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)');
      const add = db.prepare('INSERT INTO entries (id, path, title, type, size, text, bytes) VALUES (?, ?, ?, ?, ?, ?, ?)');
      const index = db.prepare('INSERT INTO fts (rowid, title, text) VALUES (?, ?, ?)');
      const utf8 = new TextDecoder('utf-8', { fatal: true });
      const st = this.status.get(sha) as { state: 'building'; done: number; total: number };
      let id = 0, textBytes = 0;
      db.exec('BEGIN');
      for await (const x of readLibrary(file)) {
        if ('header' in x) {
          meta.run('title', x.header.title);
          meta.run('source', x.header.source ?? '');
          meta.run('entries', String(x.header.entries.length));
          st.total = x.header.entries.length;
          continue;
        }
        id++;
        const text = isText(x.entry.type) ? utf8.decode(x.bytes) : null;
        add.run(id, x.entry.path, x.entry.title, x.entry.type, x.entry.size, text, text === null ? x.bytes : null);
        index.run(id, x.entry.title, text ?? '');
        if (text) textBytes += x.entry.size;
        st.done = id;
        if (id % 500 === 0) { db.exec('COMMIT'); await new Promise((r) => setImmediate(r)); db.exec('BEGIN'); }
      }
      meta.run('textBytes', String(textBytes));
      db.exec('COMMIT');
    } finally {
      db.close();
    }
    renameSync(tmp, this.path(sha));
  }

  private db(sha: string): DatabaseSync {
    let db = this.dbs.get(sha);
    if (!db) { db = new DatabaseSync(this.path(sha), { readOnly: true }); this.dbs.set(sha, db); }
    return db;
  }

  info(sha: string): LibraryInfo {
    const m = Object.fromEntries((this.db(sha).prepare('SELECT k, v FROM meta').all() as { k: string; v: string }[]).map((r) => [r.k, r.v]));
    return { title: m.title, source: m.source || null, entries: Number(m.entries), textBytes: Number(m.textBytes) };
  }

  // Every word must appear, as a word or the start of one ("llama" finds llama3); a "quoted phrase" must
  // appear as written. If nothing has every word, any of them will do.
  search(sha: string, q: string, limit = 10): LibraryHit[] {
    const phrase = /^"(.+)"$/.exec(q.trim())?.[1];
    const words = (phrase ?? q).match(/[\p{L}\p{N}_]+/gu)?.slice(0, 16) ?? [];
    if (!words.length) return [];
    const run = (match: string) => this.db(sha).prepare(`
      SELECT e.path, e.title, snippet(fts, 1, '«', '»', '…', 32) AS snippet, bm25(fts, 4.0, 1.0) AS rank
      FROM fts JOIN entries e ON e.id = fts.rowid
      WHERE fts MATCH ? ORDER BY bm25(fts, 4.0, 1.0) LIMIT ?`).all(match, limit) as unknown as LibraryHit[];
    if (phrase) return run(`"${words.join(' ')}"`);
    const all = run(words.map((w) => `"${w}"*`).join(' '));
    return all.length || words.length === 1 ? all : run(words.map((w) => `"${w}"*`).join(' OR '));
  }

  // A text entry, a window of it at a time (long transcripts are read in parts).
  read(sha: string, path: string, offset = 0, max = 30_000): { path: string; title: string; type: string; size: number; text: string | null; offset: number; next: number | null } | null {
    const r = this.db(sha).prepare('SELECT path, title, type, size, text FROM entries WHERE path = ?').get(path) as { path: string; title: string; type: string; size: number; text: string | null } | undefined;
    if (!r) return null;
    if (r.text === null) return { ...r, offset: 0, next: null };
    const text = r.text.slice(offset, offset + max);
    return { ...r, text, offset, next: offset + max < r.text.length ? offset + max : null };
  }

  raw(sha: string, path: string): { type: string; bytes: Uint8Array } | null {
    const r = this.db(sha).prepare('SELECT type, text, bytes FROM entries WHERE path = ?').get(path) as { type: string; text: string | null; bytes: Uint8Array | null } | undefined;
    if (!r) return null;
    return { type: r.type, bytes: r.text !== null ? Buffer.from(r.text, 'utf8') : r.bytes! };
  }

  list(sha: string, offset = 0, limit = 100, under = ''): { path: string; title: string; type: string; size: number }[] {
    return this.db(sha).prepare('SELECT path, title, type, size FROM entries WHERE path LIKE ? ESCAPE \'\\\' ORDER BY id LIMIT ? OFFSET ?')
      .all(`${under.replace(/[\\%_]/g, (c) => `\\${c}`)}%`, limit, offset) as { path: string; title: string; type: string; size: number }[];
  }
}

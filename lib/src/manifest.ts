// The manifest: every file of a scribe with its hash, plus how its brain runs.
// It is itself inscribed as a file; a scribe is found by its manifest's hash and writer.
import { utf8, decodeUtf8 } from './bytes.ts';

export const MANIFEST_FORMAT = 'scribes:v1:manifest';
export const ROLES = ['personality', 'model', 'runtime', 'picture'] as const;
export type Role = (typeof ROLES)[number];

export interface FileRef {
  role: Role;
  name: string;
  size: number;
  sha256: string; // hex
  writer: string; // base58 key that signed every chunk of this file
}

export type Brain =
  | { kind: 'inscribed'; model: string } // sha256 of the model file in `files`
  | { kind: 'bound'; provider: string; model: string };

export interface Manifest {
  format: typeof MANIFEST_FORMAT;
  brain: Brain;
  files: FileRef[];
}

// A link to a scribe's manifest.
export interface Link { writer: string; sha256: string; size: number }

export function formatLink(l: Link): string {
  return `scribes:v1:${l.writer}:${l.sha256}:${l.size}`;
}

export function parseLink(s: string): Link {
  const m = /^scribes:v1:([1-9A-HJ-NP-Za-km-z]{32,44}):([0-9a-f]{64}):([1-9][0-9]{0,8})$/.exec(s.trim());
  if (!m) throw new Error('not a scribe link (scribes:v1:<writer>:<sha256>:<size>)');
  return { writer: m[1], sha256: m[2], size: Number(m[3]) };
}

const HEX64 = /^[0-9a-f]{64}$/;
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const NAME = /^[A-Za-z0-9._-]{1,128}$/;

function checkFile(f: unknown): FileRef {
  const x = f as FileRef;
  if (typeof x !== 'object' || x === null) throw new Error('file entry must be an object');
  if (!ROLES.includes(x.role)) throw new Error(`unknown file role "${x.role}"`);
  if (typeof x.name !== 'string' || !NAME.test(x.name)) throw new Error(`bad file name "${x.name}"`);
  if (!Number.isSafeInteger(x.size) || x.size <= 0) throw new Error(`bad size for ${x.name}`);
  if (typeof x.sha256 !== 'string' || !HEX64.test(x.sha256)) throw new Error(`bad sha256 for ${x.name}`);
  if (typeof x.writer !== 'string' || !B58.test(x.writer)) throw new Error(`bad writer for ${x.name}`);
  return { role: x.role, name: x.name, size: x.size, sha256: x.sha256, writer: x.writer };
}

function order(a: FileRef, b: FileRef): number {
  return ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

export function checkManifest(m: unknown): Manifest {
  const x = m as Manifest;
  if (typeof x !== 'object' || x === null || x.format !== MANIFEST_FORMAT) throw new Error('not a scribes v1 manifest');
  if (!Array.isArray(x.files) || x.files.length === 0) throw new Error('manifest has no files');
  const files = x.files.map(checkFile).sort(order);
  for (let i = 1; i < files.length; i++) {
    if (files[i].role === files[i - 1].role && files[i].name === files[i - 1].name) throw new Error(`duplicate file ${files[i].name}`);
  }
  if (files.filter((f) => f.role === 'personality').length !== 1) throw new Error('manifest needs exactly one personality');
  if (files.filter((f) => f.role === 'picture').length > 1) throw new Error('manifest has more than one picture');
  let brain: Brain;
  const b = x.brain;
  if (b?.kind === 'inscribed') {
    const models = files.filter((f) => f.role === 'model');
    if (!models.some((f) => f.sha256 === b.model)) throw new Error('the inscribed brain is not among the model files');
    if (!files.some((f) => f.role === 'runtime')) throw new Error('an inscribed brain needs runtime files');
    brain = { kind: 'inscribed', model: b.model };
  } else if (b?.kind === 'bound') {
    if (typeof b.provider !== 'string' || !/^[a-z0-9-]{1,32}$/.test(b.provider)) throw new Error('bad brain provider');
    if (typeof b.model !== 'string' || !/^[A-Za-z0-9._:/-]{1,128}$/.test(b.model)) throw new Error('bad brain model');
    brain = { kind: 'bound', provider: b.provider, model: b.model };
  } else {
    throw new Error('manifest brain must be "inscribed" or "bound"');
  }
  const keys = Object.keys(x).sort().join(',');
  if (keys !== 'brain,files,format') throw new Error(`unexpected manifest fields: ${keys}`);
  return { format: MANIFEST_FORMAT, brain, files };
}

// Canonical bytes: fixed key order, files sorted, no whitespace. The same manifest always hashes the same.
export function encodeManifest(m: Manifest): Uint8Array {
  const c = checkManifest(m);
  const brain = c.brain.kind === 'inscribed'
    ? { kind: c.brain.kind, model: c.brain.model }
    : { kind: c.brain.kind, provider: c.brain.provider, model: c.brain.model };
  return utf8.encode(JSON.stringify({ format: c.format, brain, files: c.files }));
}

export function decodeManifest(bytes: Uint8Array): Manifest {
  const m = checkManifest(JSON.parse(decodeUtf8(bytes)));
  const again = encodeManifest(m);
  if (again.length !== bytes.length || again.some((v, i) => v !== bytes[i])) throw new Error('manifest is not in canonical form');
  return m;
}

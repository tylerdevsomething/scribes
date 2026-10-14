// Small byte helpers shared by the tools (Node) and the runner (browser).

export const utf8 = new TextEncoder();
const utf8d = new TextDecoder('utf-8', { fatal: true });

export function decodeUtf8(b: Uint8Array): string {
  return utf8d.decode(b);
}

export function toHex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

export function fromHex(h: string): Uint8Array {
  if (!/^([0-9a-f]{2})*$/.test(h)) throw new Error(`bad hex: ${h.slice(0, 20)}`);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export async function sha256(b: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', b as Uint8Array<ArrayBuffer>));
}

export async function sha256Hex(b: Uint8Array): Promise<string> {
  return toHex(await sha256(b));
}

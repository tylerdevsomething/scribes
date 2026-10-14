// A file is inscribed as a run of chunks, one per transaction.
// Instruction data: "SCRB" | version u8 | kind u8 | index u32 LE | bytes
import { concat } from './bytes.ts';

export const MAGIC = new Uint8Array([0x53, 0x43, 0x52, 0x42]);
export const VERSION = 1;
export const KIND_CHUNK = 1;
export const HEADER_BYTES = 10;
// Fits a legacy transaction (1232 bytes) with the payer, the file tag, the ink program and both
// compute-budget instructions. Fixed for v1: changing it changes how every file is split.
export const CHUNK_BYTES = 960;

export function chunkCount(size: number): number {
  return Math.ceil(size / CHUNK_BYTES);
}

export function chunkSlice(file: Uint8Array, index: number): Uint8Array {
  return file.subarray(index * CHUNK_BYTES, Math.min(file.length, (index + 1) * CHUNK_BYTES));
}

export function encodeChunk(index: number, bytes: Uint8Array): Uint8Array {
  if (!Number.isInteger(index) || index < 0 || index > 0xffffffff) throw new Error(`bad chunk index ${index}`);
  if (bytes.length === 0 || bytes.length > CHUNK_BYTES) throw new Error(`bad chunk length ${bytes.length}`);
  const head = new Uint8Array(HEADER_BYTES);
  head.set(MAGIC, 0);
  head[4] = VERSION;
  head[5] = KIND_CHUNK;
  new DataView(head.buffer).setUint32(6, index, true);
  return concat(head, bytes);
}

export function decodeChunk(data: Uint8Array): { index: number; bytes: Uint8Array } | null {
  if (data.length <= HEADER_BYTES || data.length > HEADER_BYTES + CHUNK_BYTES) return null;
  for (let i = 0; i < 4; i++) if (data[i] !== MAGIC[i]) return null;
  if (data[4] !== VERSION || data[5] !== KIND_CHUNK) return null;
  const index = new DataView(data.buffer, data.byteOffset, data.length).getUint32(6, true);
  return { index, bytes: data.subarray(HEADER_BYTES) };
}

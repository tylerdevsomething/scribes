// Reads a GGUF model file's header and tensor table, and checks the file is what it claims to be:
// every tensor lies inside the file and the tensor data ends where the file ends. A file that fails
// is not served or run (inscribed bytes can be anything; only real models get treated as models).

export interface GgufInfo {
  version: number;
  architecture: string | null;
  name: string | null;
  sizeLabel: string | null;
  fileType: number | null;
  tensorCount: number;
  parameters: number;
  meta: Record<string, string | number | boolean>;
}

// ggml tensor types: [elements per block, bytes per block]
const TYPES: Record<number, [number, number]> = {
  0: [1, 4], 1: [1, 2], 2: [32, 18], 3: [32, 20], 6: [32, 22], 7: [32, 24], 8: [32, 34], 9: [32, 36],
  10: [256, 84], 11: [256, 110], 12: [256, 144], 13: [256, 176], 14: [256, 210], 15: [256, 292],
  16: [256, 66], 17: [256, 74], 18: [256, 98], 19: [256, 50], 20: [32, 18], 21: [256, 110], 22: [256, 82],
  23: [256, 136], 24: [1, 1], 25: [1, 2], 26: [1, 4], 27: [1, 8], 28: [1, 8], 29: [256, 56], 30: [1, 2],
  34: [256, 54], 35: [256, 66], 39: [32, 17],
};

const MAX_STRING = 1 << 20;
const MAX_ARRAY = 1 << 24;
const MAX_TENSORS = 1 << 16;

class Reader {
  o = 0;
  view: DataView;
  b: Uint8Array;
  constructor(b: Uint8Array) {
    this.b = b;
    this.view = new DataView(b.buffer, b.byteOffset, b.length);
  }
  need(n: number) { if (this.o + n > this.b.length) throw new Error('GGUF header runs past the end of the file'); }
  u8() { this.need(1); return this.view.getUint8(this.o++); }
  i8() { this.need(1); return this.view.getInt8(this.o++); }
  u16() { this.need(2); const v = this.view.getUint16(this.o, true); this.o += 2; return v; }
  i16() { this.need(2); const v = this.view.getInt16(this.o, true); this.o += 2; return v; }
  u32() { this.need(4); const v = this.view.getUint32(this.o, true); this.o += 4; return v; }
  i32() { this.need(4); const v = this.view.getInt32(this.o, true); this.o += 4; return v; }
  f32() { this.need(4); const v = this.view.getFloat32(this.o, true); this.o += 4; return v; }
  f64() { this.need(8); const v = this.view.getFloat64(this.o, true); this.o += 8; return v; }
  u64() {
    this.need(8);
    const v = this.view.getBigUint64(this.o, true); this.o += 8;
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('GGUF value too large');
    return Number(v);
  }
  i64() { this.need(8); const v = this.view.getBigInt64(this.o, true); this.o += 8; return Number(v); }
  str() {
    const n = this.u64();
    if (n > MAX_STRING) throw new Error('GGUF string too long');
    this.need(n);
    const s = new TextDecoder('utf-8', { fatal: true }).decode(this.b.subarray(this.o, this.o + n));
    this.o += n;
    return s;
  }
}

function value(r: Reader, type: number): string | number | boolean | null {
  switch (type) {
    case 0: return r.u8();
    case 1: return r.i8();
    case 2: return r.u16();
    case 3: return r.i16();
    case 4: return r.u32();
    case 5: return r.i32();
    case 6: return r.f32();
    case 7: return r.u8() !== 0;
    case 8: return r.str();
    case 9: {
      const t = r.u32();
      const n = r.u64();
      if (n > MAX_ARRAY) throw new Error('GGUF array too long');
      for (let i = 0; i < n; i++) value(r, t); // arrays (tokenizer tables) are skipped, not kept
      return null;
    }
    case 10: return r.u64();
    case 11: return r.i64();
    case 12: return r.f64();
    default: throw new Error(`unknown GGUF value type ${type}`);
  }
}

export function readGguf(file: Uint8Array): GgufInfo {
  const r = new Reader(file);
  if (r.u32() !== 0x46554747) throw new Error('not a GGUF file (or a big-endian one, which is not supported)');
  const version = r.u32();
  if (version !== 2 && version !== 3) throw new Error(`unsupported GGUF version ${version}`);
  const tensorCount = r.u64();
  const kvCount = r.u64();
  if (tensorCount === 0 || tensorCount > MAX_TENSORS) throw new Error('bad GGUF tensor count');
  if (kvCount > MAX_ARRAY) throw new Error('bad GGUF metadata count');

  const meta: Record<string, string | number | boolean> = {};
  for (let i = 0; i < kvCount; i++) {
    const key = r.str();
    const v = value(r, r.u32());
    if (v !== null) meta[key] = v;
  }

  let parameters = 0;
  const tensors: { offset: number; bytes: number }[] = [];
  for (let i = 0; i < tensorCount; i++) {
    r.str();
    const dims = r.u32();
    if (dims === 0 || dims > 8) throw new Error('bad GGUF tensor shape');
    let elements = 1;
    for (let d = 0; d < dims; d++) elements *= r.u64();
    if (!Number.isSafeInteger(elements)) throw new Error('GGUF tensor too large');
    const type = r.u32();
    const offset = r.u64();
    const t = TYPES[type];
    if (!t) throw new Error(`unsupported GGUF tensor type ${type}`);
    if (elements % t[0] !== 0) throw new Error('GGUF tensor does not fill whole blocks');
    parameters += elements;
    tensors.push({ offset, bytes: (elements / t[0]) * t[1] });
  }

  const alignment = typeof meta['general.alignment'] === 'number' ? meta['general.alignment'] : 32;
  if (!Number.isInteger(alignment) || alignment <= 0 || alignment > 1 << 16) throw new Error('bad GGUF alignment');
  const dataStart = Math.ceil(r.o / alignment) * alignment;
  let end = 0;
  for (const t of tensors) {
    if (t.offset % alignment !== 0) throw new Error('GGUF tensor is not aligned');
    end = Math.max(end, t.offset + t.bytes);
  }
  if (dataStart + end > file.length) throw new Error('GGUF tensors run past the end of the file');
  if (file.length - (dataStart + end) >= alignment) throw new Error('GGUF file has unexplained bytes after its tensors');

  const s = (k: string) => (typeof meta[k] === 'string' ? (meta[k] as string) : null);
  return {
    version,
    architecture: s('general.architecture'),
    name: s('general.name'),
    sizeLabel: s('general.size_label'),
    fileType: typeof meta['general.file_type'] === 'number' ? (meta['general.file_type'] as number) : null,
    tensorCount,
    parameters,
    meta,
  };
}

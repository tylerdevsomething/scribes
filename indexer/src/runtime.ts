// The official runtime: wllama (llama.cpp compiled to WASM), the exact files from the installed package.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

export function runtimeFiles(): { name: string; bytes: Uint8Array }[] {
  const require = createRequire(import.meta.url);
  const dir = join(dirname(require.resolve('@wllama/wllama/package.json')), 'esm');
  return [
    { name: 'wllama.js', bytes: new Uint8Array(readFileSync(join(dir, 'index.min.js'))) },
    { name: 'wllama.wasm', bytes: new Uint8Array(readFileSync(join(dir, 'wasm', 'wllama.wasm'))) },
  ];
}

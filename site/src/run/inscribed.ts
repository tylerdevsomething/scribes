// An inscribed brain: the model and the runtime are files of the scribe. They are downloaded from the
// indexer's cache, checked against the manifest read from chain, and run in this browser.
import { sha256Hex } from '../../../lib/src/bytes.ts';
import { readGguf } from '../../../lib/src/gguf.ts';
import type { FileRef, Manifest } from '../../../lib/src/manifest.ts';
import { fileUrl } from '../api.ts';
import { looping, trimLoop, type Brain } from './brain.ts';

type Wllama = {
  loadModel(blobs: Blob[], params?: Record<string, unknown>): Promise<void>;
  createChatCompletion(o: Record<string, unknown>): Promise<AsyncIterable<{ choices: { delta: { content?: string | null } }[] }>>;
};

const SAMPLING = {
  max_tokens: 200, temperature: 0.7, top_p: 0.9, top_k: 40, min_p: 0.05,
  penalty_last_n: 256, penalty_repeat: 1.18, penalty_freq: 0.3, penalty_present: 0.3,
};
const RECENT_TURNS = 8;

export type Step = (text: string, state: 'run' | 'ok' | 'bad') => void;

async function fetchChecked(f: FileRef, step: Step): Promise<Uint8Array> {
  step(`${f.name}: downloading ${(f.size / 1e6).toFixed(1)} MB`, 'run');
  const res = await fetch(fileUrl(f.sha256));
  if (!res.ok || !res.body) throw new Error(`${f.name}: not available (${res.status})`);
  // Read in pieces so the page can show progress on large models.
  const bytes = new Uint8Array(f.size);
  const reader = res.body.getReader();
  let got = 0, shown = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (got + value.length > f.size) throw new Error(`${f.name}: larger than its inscribed size — refused`);
    bytes.set(value, got);
    got += value.length;
    if (got - shown > f.size / 50) { shown = got; step(`${f.name}: downloading ${(got / 1e6).toFixed(1)} of ${(f.size / 1e6).toFixed(1)} MB`, 'run'); }
  }
  if (got !== f.size) throw new Error(`${f.name}: incomplete download`);
  if (bytes.length !== f.size || (await sha256Hex(bytes)) !== f.sha256) throw new Error(`${f.name}: does not match the inscribed hash — refused`);
  step(`${f.name}: ${(f.size / 1e6).toFixed(1)} MB, matches its inscribed hash`, 'ok');
  return bytes;
}

export async function loadInscribed(manifest: Manifest, step: Step): Promise<Brain> {
  if (manifest.brain.kind !== 'inscribed') throw new Error('not an inscribed brain');
  const sha = manifest.brain.model;
  const modelRef = manifest.files.find((f) => f.role === 'model' && f.sha256 === sha)!;
  const jsRef = manifest.files.find((f) => f.role === 'runtime' && f.name.endsWith('.js'));
  const wasmRef = manifest.files.find((f) => f.role === 'runtime' && f.name.endsWith('.wasm'));
  if (!jsRef || !wasmRef) throw new Error('this scribe has no runtime this page can start');

  const js = await fetchChecked(jsRef, step);
  const wasm = await fetchChecked(wasmRef, step);
  const model = await fetchChecked(modelRef, step);
  const info = readGguf(model);
  step(`Model is a real GGUF: ${info.name ?? modelRef.name}, ${(info.parameters / 1e6).toFixed(info.parameters < 1e7 ? 1 : 0)}M parameters`, 'ok');

  const jsUrl = URL.createObjectURL(new Blob([js as Uint8Array<ArrayBuffer>], { type: 'text/javascript' }));
  const wasmUrl = URL.createObjectURL(new Blob([wasm as Uint8Array<ArrayBuffer>], { type: 'application/wasm' }));
  const mod = await import(/* @vite-ignore */ jsUrl);
  const w = new mod.Wllama({ default: wasmUrl }, { suppressNativeLog: true }) as Wllama;
  step('Starting the inscribed runtime', 'run');
  await w.loadModel([new Blob([model as Uint8Array<ArrayBuffer>])], { n_ctx: 2048 });
  step('Brain loaded — running in this browser', 'ok');

  return {
    label: `${info.name ?? modelRef.name} · ${(info.parameters / 1e6).toFixed(info.parameters < 1e7 ? 1 : 0)}M parameters · running in this browser`,
    async reply(system, history, onText, signal) {
      const abort = new AbortController();
      signal.addEventListener('abort', () => abort.abort());
      const stream = await w.createChatCompletion({
        messages: [{ role: 'system', content: system }, ...history.slice(-RECENT_TURNS)],
        stream: true, abortSignal: abort.signal, ...SAMPLING,
      });
      let text = '';
      try {
        for await (const c of stream) {
          const t = c.choices[0]?.delta?.content;
          if (!t) continue;
          text += t;
          onText(text);
          if (looping(text)) { abort.abort(); break; }
        }
      } catch (e) {
        if (!abort.signal.aborted) throw e;
      }
      return trimLoop(text);
    },
  };
}

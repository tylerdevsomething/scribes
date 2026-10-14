import { Connection } from '@solana/web3.js';
import { readFile } from '../../lib/src/chain.ts';
import { decodeUtf8, sha256Hex } from '../../lib/src/bytes.ts';
import { decodeManifest, parseLink, type FileRef, type Manifest } from '../../lib/src/manifest.ts';
import { parsePersonality, systemPrompt, type Personality } from '../../lib/src/personality.ts';
import { readGguf } from '../../lib/src/gguf.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function step(text: string) {
  const li = document.createElement('li');
  li.className = 'run';
  li.textContent = text;
  $('steps').appendChild(li);
  return {
    set: (t: string) => { li.textContent = t; },
    ok: (t?: string) => { li.className = 'ok'; if (t) li.textContent = t; },
    bad: (t: string) => { li.className = 'bad'; li.textContent = t; },
  };
}

const mb = (n: number) => (n / 1e6).toFixed(1) + ' MB';

async function getFile(conn: Connection, f: FileRef, fromChain: boolean): Promise<Uint8Array> {
  const s = step(`${f.name} (${mb(f.size)})`);
  try {
    let bytes: Uint8Array;
    if (fromChain) {
      bytes = await readFile(conn, f, { concurrency: 16, onProgress: (p) => s.set(`${f.name}: rebuilding from chain ${p.done}/${p.total} chunks`) });
    } else {
      const res = await fetch(`/files/${f.sha256}`);
      if (!res.ok) throw new Error(`not in the cache (${res.status}); choose "rebuild from chain"`);
      bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length !== f.size || (await sha256Hex(bytes)) !== f.sha256) throw new Error('does not match the manifest — refused');
    }
    s.ok(`${f.name}: ${mb(f.size)}, sha256 matches the manifest${fromChain ? ' (rebuilt from chain)' : ''}`);
    return bytes;
  } catch (e) {
    s.bad(`${f.name}: ${(e as Error).message}`);
    throw e;
  }
}

type WllamaInstance = {
  loadModel(blobs: Blob[], params?: Record<string, unknown>): Promise<void>;
  createChatCompletion(o: Record<string, unknown>): Promise<AsyncIterable<{ choices: { delta: { content?: string | null } }[] }>>;
};

let wllama: WllamaInstance | null = null;
let personality: Personality | null = null;
const history: { role: 'user' | 'assistant'; content: string }[] = [];

async function open() {
  $('steps').innerHTML = '';
  $<HTMLButtonElement>('open').disabled = true;
  $('chat').hidden = $('who').hidden = true;
  history.length = 0;
  try {
    const link = parseLink($<HTMLInputElement>('link').value);
    const conn = new Connection($<HTMLInputElement>('rpc').value.trim(), 'confirmed');
    const fromChain = $<HTMLSelectElement>('source').value === 'chain';

    const s1 = step('Reading the manifest from chain');
    const manifest: Manifest = decodeManifest(await readFile(conn, link));
    s1.ok(`Manifest read from chain: ${manifest.files.length} files, brain ${manifest.brain.kind}`);

    // The personality is always read straight from chain: it is small and it is who the scribe is.
    const pref = manifest.files.find((f) => f.role === 'personality')!;
    const s2 = step('Reading the personality from chain');
    personality = parsePersonality(decodeUtf8(await readFile(conn, pref)));
    s2.ok(`Personality read from chain: ${personality.name}`);

    $('who').hidden = false;
    $('who').innerHTML = `<strong></strong><div class="dim"></div><div class="stats"></div>`;
    $('who').querySelector('strong')!.textContent = personality.name;
    $('who').querySelector('.dim')!.textContent = personality.purpose;

    if (manifest.brain.kind === 'bound') {
      step(`This scribe's brain is bound to ${manifest.brain.provider} ${manifest.brain.model}. Bound brains arrive in a later milestone.`).bad('Bound brains are not supported in this runner yet');
      return;
    }

    const brain = manifest.brain;
    const modelRef = manifest.files.find((f) => f.role === 'model' && f.sha256 === brain.model)!;
    const jsRef = manifest.files.find((f) => f.role === 'runtime' && f.name.endsWith('.js'));
    const wasmRef = manifest.files.find((f) => f.role === 'runtime' && f.name.endsWith('.wasm'));
    if (!jsRef || !wasmRef) throw new Error('the manifest has no runnable runtime (.js + .wasm)');

    const [js, wasm, model] = [await getFile(conn, jsRef, fromChain), await getFile(conn, wasmRef, fromChain), await getFile(conn, modelRef, fromChain)];

    const s3 = step('Checking the model file');
    const info = readGguf(model);
    s3.ok(`Model is a valid GGUF: ${info.name ?? modelRef.name}, ${info.architecture}, ${(info.parameters / 1e6).toFixed(1)}M parameters`);
    $('who').querySelector('.stats')!.textContent = `${info.name ?? modelRef.name} · ${(info.parameters / 1e6).toFixed(1)}M parameters · ${mb(modelRef.size)}`;

    const s4 = step('Starting the runtime from the inscribed files');
    const jsUrl = URL.createObjectURL(new Blob([js as Uint8Array<ArrayBuffer>], { type: 'text/javascript' }));
    const wasmUrl = URL.createObjectURL(new Blob([wasm as Uint8Array<ArrayBuffer>], { type: 'application/wasm' }));
    const mod = await import(/* @vite-ignore */ jsUrl);
    wllama = new mod.Wllama({ default: wasmUrl }, { suppressNativeLog: true }) as WllamaInstance;
    s4.ok('Runtime started from the inscribed files');

    const s5 = step('Loading the brain');
    const t0 = performance.now();
    await wllama.loadModel([new Blob([model as Uint8Array<ArrayBuffer>])], { n_ctx: 2048 });
    s5.ok(`Brain loaded in ${((performance.now() - t0) / 1000).toFixed(1)} s`);

    $('chat').hidden = false;
    $('log').innerHTML = '';
    $('input').focus();
  } catch (e) {
    console.error(e);
    step((e as Error).message).bad((e as Error).message);
  } finally {
    $<HTMLButtonElement>('open').disabled = false;
  }
}

function addMsg(cls: string, text: string) {
  const d = document.createElement('div');
  d.className = 'msg ' + cls;
  d.textContent = text;
  $('log').appendChild(d);
  $('log').scrollTop = $('log').scrollHeight;
  return d;
}

async function send() {
  const input = $<HTMLInputElement>('input');
  const text = input.value.trim();
  if (!text || !wllama || !personality) return;
  input.value = '';
  $<HTMLButtonElement>('send').disabled = true;
  addMsg('you', text);
  history.push({ role: 'user', content: text });
  const out = addMsg('bot', '');
  const t0 = performance.now();
  let reply = '', pieces = 0;
  try {
    const stream = await wllama.createChatCompletion({
      messages: [{ role: 'system', content: systemPrompt(personality) }, ...history],
      stream: true, max_tokens: 200, temperature: 0.7, top_p: 0.9,
    });
    for await (const c of stream) {
      const t = c.choices[0]?.delta?.content;
      if (t) { reply += t; pieces++; out.textContent = reply; $('log').scrollTop = $('log').scrollHeight; }
    }
    history.push({ role: 'assistant', content: reply });
    const secs = (performance.now() - t0) / 1000;
    out.insertAdjacentHTML('beforeend', `<div class="stats">${pieces} tokens · ${(pieces / secs).toFixed(1)} tokens/s</div>`);
  } catch (e) {
    history.pop();
    out.textContent = 'Error: ' + (e as Error).message;
  } finally {
    $<HTMLButtonElement>('send').disabled = false;
    input.focus();
  }
}

$('open').onclick = open;
$('send').onclick = send;
$('input').onkeydown = (e) => { if ((e as KeyboardEvent).key === 'Enter') send(); };
const fromHash = new URLSearchParams(location.hash.slice(1)).get('link');
if (fromHash) $<HTMLInputElement>('link').value = fromHash;

// The verification bot. Its code is public; its only power is signing a pass, and the pass only counts
// inside a verify transaction that also burns $SCRIBES (see programs/scribes). Two checks:
//   1. Complete — every required piece is present and checked against the manifest, and an inscribed
//      brain uses the official runtime.
//   2. Working  — the scribe answers a fixed test prompt (an inscribed brain runs here, greedy decoding;
//      a bound brain is called through its provider).
import { existsSync } from 'node:fs';
import { Keypair, PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import Anthropic from '@anthropic-ai/sdk';
import { XAI_URL } from '../../lib/src/hybrid.ts';
import { getLlama, LlamaChatSession, type Llama } from 'node-llama-cpp';
import { concat, fromHex, sha256Hex, utf8 } from '../../lib/src/bytes.ts';
import { systemPrompt, type Personality } from '../../lib/src/personality.ts';
import type { Indexer } from './indexer.ts';
import { runtimeFiles } from './runtime.ts';

export const TEST_PROMPT = 'Introduce yourself in one or two sentences.';
// Threads for an inscribed brain's test. A container sees every core of its host but may only get a few cores'
// time, and one thread per visible core then crawls (minutes for a 360M model), so it is capped.
const THREADS = Number(process.env.VERIFY_THREADS) || 4;
const MIN_REPLY_CHARS = 12;

export interface Check { name: string; ok: boolean; detail: string }
export interface Verdict {
  scribe: string;
  ok: boolean;
  checks: Check[];
  reply: string | null; // what the scribe answered to the test prompt
  pass: { verifier: string; message: string; signature: string } | null; // base58 / base64 / base64
}

export class Verifier {
  private indexer: Indexer;
  private key: Keypair;
  private anthropicKey: string | undefined;
  private xaiKey: string | undefined;
  private llama: Promise<Llama> | null = null;
  private official: Promise<Set<string>>;
  private cache = new Map<string, Verdict>(); // by manifest sha: the same files give the same verdict
  private queue: Promise<unknown> = Promise.resolve();
  private running = new Map<string, Promise<Verdict>>(); // by scribe: a check in progress, or just finished

  constructor(opts: { indexer: Indexer; key: Keypair; anthropicKey?: string; xaiKey?: string }) {
    this.indexer = opts.indexer;
    this.key = opts.key;
    this.anthropicKey = opts.anthropicKey;
    this.xaiKey = opts.xaiKey;
    this.official = Promise.all(runtimeFiles().map((r) => sha256Hex(r.bytes))).then((h) => new Set(h));
  }

  get verifier(): string { return this.key.publicKey.toBase58(); }

  // One verification at a time: running models is heavy.
  verify(address: string): Promise<Verdict> {
    const run = this.queue.then(() => this.run(address));
    this.queue = run.catch(() => {});
    return run;
  }

  // The verdict if it is ready within waitMs, else null and the check carries on: a request is never held
  // open past the host's proxy limit. Asking again joins the same check; a finished one is kept a minute.
  async check(address: string, waitMs: number): Promise<Verdict | null> {
    let run = this.running.get(address);
    if (!run) {
      const t0 = Date.now();
      run = this.verify(address);
      this.running.set(address, run);
      const forget = () => setTimeout(() => { if (this.running.get(address) === run) this.running.delete(address); }, 60_000);
      run.then((v) => { console.log(`verify ${address}: ${v.ok ? 'passed' : 'failed'} in ${((Date.now() - t0) / 1000).toFixed(1)}s`); forget(); },
        (e) => { console.log(`verify ${address}: ${(e as Error).message}`); forget(); });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((r) => { timer = setTimeout(() => r(null), waitMs); });
    try { return await Promise.race([run, late]); } finally { clearTimeout(timer); }
  }

  private async run(address: string): Promise<Verdict> {
    const s = this.indexer.get(address);
    if (!s) throw new Error('no such scribe');
    const cached = this.cache.get(s.manifestSha);
    if (cached) return cached;
    const checks: Check[] = [];
    let reply: string | null = null;

    // 1. Complete
    const m = s.brain;
    const personality = this.indexer.personality(address);
    const complete: string[] = [];
    if (s.status.state !== 'complete') complete.push(s.status.state === 'invalid' ? `invalid: ${s.status.reason}` : 'still being inscribed');
    if (!personality) complete.push('no personality');
    if (!m) complete.push('no brain');
    if (m?.kind === 'inscribed') {
      if (!s.files.some((f) => f.role === 'model')) complete.push('no model file');
      const official = await this.official;
      const runtime = s.files.filter((f) => f.role === 'runtime');
      if (runtime.length === 0) complete.push('no runtime');
      else if (!runtime.every((f) => official.has(f.sha256))) complete.push('the runtime is not the official one');
    }
    checks.push({ name: 'Complete', ok: complete.length === 0, detail: complete.length ? complete.join('; ') : 'every piece is inscribed and matches the manifest' });

    // 2. Working
    if (complete.length === 0 && m && personality) {
      try {
        reply = m.kind === 'inscribed' ? await this.runInscribed(m.model, personality) : await this.runBound(m.provider, m.model, personality);
        const ok = reply.trim().length >= MIN_REPLY_CHARS;
        checks.push({ name: 'Working', ok, detail: ok ? 'answered the test prompt' : 'the answer to the test prompt was empty' });
      } catch (e) {
        checks.push({ name: 'Working', ok: false, detail: (e as Error).message });
      }
    } else {
      checks.push({ name: 'Working', ok: false, detail: 'not tested: the scribe is not complete' });
    }

    const ok = checks.every((c) => c.ok);
    const verdict: Verdict = { scribe: address, ok, checks, reply, pass: null };
    if (ok) {
      // The pass the program checks: VERIFY_DOMAIN || scribe address || manifest sha256.
      const message = concat(utf8.encode('scribes:v1:verify'), new PublicKey(address).toBytes(), fromHex(s.manifestSha));
      const signature = nacl.sign.detached(message, this.key.secretKey);
      verdict.pass = { verifier: this.verifier, message: Buffer.from(message).toString('base64'), signature: Buffer.from(signature).toString('base64') };
    }
    // Failures are not cached for long: a scribe still being inscribed may pass a minute later.
    if (ok) this.cache.set(s.manifestSha, verdict);
    return verdict;
  }

  private async runInscribed(modelSha: string, p: Personality): Promise<string> {
    const path = this.indexer.filePath(modelSha);
    if (!existsSync(path)) throw new Error('the model file is not in the cache yet');
    this.llama ??= getLlama({ gpu: false, maxThreads: THREADS });
    const llama = await this.llama;
    const model = await llama.loadModel({ modelPath: path });
    try {
      const ctx = await model.createContext({ contextSize: 2048 });
      const session = new LlamaChatSession({ contextSequence: ctx.getSequence(), systemPrompt: systemPrompt(p) });
      return await session.prompt(TEST_PROMPT, { maxTokens: 80, temperature: 0 }); // greedy: no luck involved
    } finally {
      await model.dispose();
    }
  }

  private async runBound(provider: string, model: string, p: Personality): Promise<string> {
    if (provider === 'xai') return this.runGrok(model, p);
    if (provider !== 'anthropic') throw new Error(`brains bound to "${provider}" cannot be tested yet`);
    if (!this.anthropicKey) throw new Error('the bot has no Anthropic key configured, so bound brains cannot be tested yet');
    const client = new Anthropic({ apiKey: this.anthropicKey });
    const res = await client.beta.messages.create({
      model, max_tokens: 1024, system: systemPrompt(p),
      messages: [{ role: 'user', content: TEST_PROMPT }],
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    if (res.stop_reason === 'refusal') throw new Error('the model declined the test prompt');
    return res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  }

  private async runGrok(model: string, p: Personality): Promise<string> {
    if (!this.xaiKey) throw new Error('the bot has no xAI key configured, so Grok brains cannot be tested yet');
    const res = await fetch(XAI_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.xaiKey}` },
      body: JSON.stringify({ model, max_tokens: 1024, messages: [{ role: 'system', content: systemPrompt(p) }, { role: 'user', content: TEST_PROMPT }] }),
    });
    if (!res.ok) throw new Error(`Grok answered ${res.status}`);
    const j = await res.json() as { choices?: { message?: { content?: string } }[] };
    return j.choices?.[0]?.message?.content ?? '';
  }
}

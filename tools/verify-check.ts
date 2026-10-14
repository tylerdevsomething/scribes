// End-to-end check of verification, the way the site does it: the owner asks the bot, gets a signed pass,
// and sends one transaction [pass, verify] that burns the set amount; the indexer then shows Verified.
//   node tools/verify-check.ts --api http://localhost:8790 --rpc http://127.0.0.1:8899 --key <owner.json> --scribe <address>
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Connection, Ed25519Program, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, getMint } from '@solana/spl-token';
import { scribesProgram, verifyInstruction } from '../lib/src/registry.ts';

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); if (i < 0) throw new Error(`--${k} is required`); return process.argv[i + 1]; };
const api = arg('api');
const conn = new Connection(arg('rpc'), 'confirmed');
const owner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(arg('key'), 'utf8'))));
const scribe = arg('scribe');
const post = async (path: string, body: unknown = {}) => {
  const r = await fetch(api + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
  return j;
};

async function main() {
  const settings = await fetch(`${api}/settings`).then((r) => r.json());
  assert.ok(settings.verificationOpen, 'verification must be open (run tools/cli.ts test-token)');
  await post('/faucet', { owner: owner.publicKey.toBase58() }).catch(() => {}); // test tokens

  const verdict = await post(`/verify/${scribe}`);
  for (const c of verdict.checks) console.log(`  ${c.ok ? 'ok ' : 'FAIL'} ${c.name}: ${c.detail}`);
  console.log(`  test prompt answer: ${JSON.stringify((verdict.reply ?? '').slice(0, 100))}`);
  assert.ok(verdict.ok && verdict.pass, 'the scribe should pass');

  const mint = new PublicKey(settings.burnMint);
  const tokenProgram = new PublicKey(settings.token.program);
  const ownerTokens = getAssociatedTokenAddressSync(mint, owner.publicKey, false, tokenProgram);
  const supplyBefore = (await getMint(conn, mint, 'confirmed', tokenProgram)).supply;
  const pass = Ed25519Program.createInstructionWithPublicKey({
    publicKey: new PublicKey(verdict.pass.verifier).toBytes(),
    message: Buffer.from(verdict.pass.message, 'base64'),
    signature: Buffer.from(verdict.pass.signature, 'base64'),
  });
  const ix = await verifyInstruction(scribesProgram(conn), { owner: owner.publicKey, scribe, mint, ownerTokens, tokenProgram });
  await sendAndConfirmTransaction(conn, new Transaction().add(pass, ix), [owner], { commitment: 'confirmed' });
  const burned = supplyBefore - (await getMint(conn, mint, 'confirmed', tokenProgram)).supply;
  assert.equal(burned.toString(), settings.burnAmount);
  console.log(`  verified on chain — burned ${Number(burned) / 10 ** settings.token.decimals} tokens (total supply went down)`);

  for (let i = 0; i < 30; i++) {
    const s = await fetch(`${api}/scribe/${scribe}`).then((r) => r.json());
    if (s.verified) { console.log('  the indexer shows it Verified'); console.log('verification: all good'); return; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('the indexer never showed Verified');
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });

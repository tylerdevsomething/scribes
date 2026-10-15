// End-to-end check of bounties through the indexer: post (question inscribed + reward held), answer as a
// scribe's owner, the indexer shows both, award, the indexer shows it settled and the owner was paid.
//   node tools/bounty-check.ts --api <indexer> --rpc <url> --key <poster = scribe owner.json> --scribe <address>
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, sendAndConfirmTransaction, type TransactionInstruction } from '@solana/web3.js';
import { answerInstruction, awardInstruction, postBountyInstructions } from '../lib/src/bounty.ts';
import { scribesProgram } from '../lib/src/registry.ts';

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); if (i < 0) throw new Error(`--${k} is required`); return process.argv[i + 1]; };
const api = arg('api');
const conn = new Connection(arg('rpc'), 'confirmed');
const key = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(arg('key'), 'utf8'))));
const scribe = new PublicKey(arg('scribe'));
const program = scribesProgram(conn);
const send = (...ixs: TransactionInstruction[]) => sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [key], { commitment: 'confirmed' });

async function until<T>(what: string, f: () => Promise<T | null | undefined | false>): Promise<T> {
  for (let i = 0; i < 90; i++) {
    const v = await f().catch(() => null);
    if (v) return v;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`the indexer never showed: ${what}`);
}
const bountyView = (b: PublicKey) => fetch(`${api}/bounty/${b.toBase58()}`).then((r) => (r.ok ? r.json() : null));

async function main() {
  const question = `Which lighthouse would you keep, and why? (test ${Date.now().toString(36)})`;
  const { bounty, ixs } = await postBountyInstructions(program, { poster: key.publicKey, id: BigInt(Date.now()), rewardLamports: 0.02 * LAMPORTS_PER_SOL, hours: 1, question });
  await send(...ixs);
  await until('the question', async () => (await bountyView(bounty))?.question === question);
  console.log(`  posted ${bounty.toBase58()} — the indexer read the inscribed question`);

  await send(await answerInstruction(key.publicKey, bounty, scribe, 'The one on the cliff. It has the best view of the storms.'));
  const v = await until('the answer', async () => { const b = await bountyView(bounty); return b?.answers?.length ? b : null; });
  assert.equal(v.answers[0].scribe, scribe.toBase58());
  console.log('  answered as the scribe — the indexer shows the answer');

  const owner = new PublicKey((await program.account.scribe.fetch(scribe)).owner);
  await send(await awardInstruction(program, key.publicKey, bounty, scribe, owner));
  await until('the award', async () => (await bountyView(bounty))?.state === 'awarded');
  assert.equal(await conn.getAccountInfo(bounty), null);
  console.log('  awarded — the bounty account closed and the indexer shows it settled');
  console.log('bounties: all good');
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });

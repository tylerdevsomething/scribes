// End-to-end check of the market through the indexer, using the same instruction builders as the site:
// the owner lists, a buyer buys, the indexer shows the new owner; a gift takes a listing down.
//   node tools/market-check.ts --api http://localhost:8790 --rpc http://127.0.0.1:8899 --key <owner.json> --scribe <address>
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Connection, Keypair, LAMPORTS_PER_SOL, Transaction, sendAndConfirmTransaction, type TransactionInstruction } from '@solana/web3.js';
import { buyInstruction, cancelInstruction, giveInstruction, listInstruction, scribesProgram } from '../lib/src/registry.ts';

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); if (i < 0) throw new Error(`--${k} is required`); return process.argv[i + 1]; };
const api = arg('api');
const conn = new Connection(arg('rpc'), 'confirmed');
const program = scribesProgram(conn);
const owner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(arg('key'), 'utf8'))));
const scribe = arg('scribe');

const send = (signer: Keypair, ...ixs: TransactionInstruction[]) => sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [signer], { commitment: 'confirmed' });
const view = () => fetch(`${api}/scribe/${scribe}`).then((r) => r.json());
async function until(what: string, ok: (s: { owner: string; listing: { price: number } | null }) => boolean) {
  for (let i = 0; i < 40; i++) {
    const s = await view();
    if (ok(s)) return s;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`the indexer never showed: ${what}`);
}

async function main() {
  const buyer = Keypair.generate();
  await conn.confirmTransaction(await conn.requestAirdrop(buyer.publicKey, 3 * LAMPORTS_PER_SOL), 'confirmed');
  const price = 1.5 * LAMPORTS_PER_SOL;

  await send(owner, await listInstruction(program, owner.publicKey, scribe, price));
  await until('the listing', (s) => s.listing?.price === price);
  console.log('  listed at 1.5 SOL — the indexer shows it');

  const before = await conn.getBalance(owner.publicKey);
  await send(buyer, await buyInstruction(program, buyer.publicKey, scribe, owner.publicKey, price));
  const s = await until('the new owner', (x) => x.owner === buyer.publicKey.toBase58() && x.listing === null);
  const got = (await conn.getBalance(owner.publicKey)) - before;
  console.log(`  bought — seller received ${(got / LAMPORTS_PER_SOL).toFixed(6)} SOL (price minus fee, plus the listing rent back); owner is now the buyer`);
  assert.equal(s.owner, buyer.publicKey.toBase58());

  // The buyer lists, then gives it back: the site's give also takes the listing down.
  await send(buyer, await listInstruction(program, buyer.publicKey, scribe, price));
  await until('the buyer\'s listing', (x) => x.listing?.price === price);
  await send(buyer,
    await cancelInstruction(program, buyer.publicKey, scribe, buyer.publicKey),
    await giveInstruction(program, buyer.publicKey, scribe, owner.publicKey));
  await until('the gift', (x) => x.owner === owner.publicKey.toBase58() && x.listing === null);
  console.log('  listed again, then given back — listing gone, owner back');
  console.log('market flow: all good');
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });

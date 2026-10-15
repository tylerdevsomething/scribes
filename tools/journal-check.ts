// End-to-end check of journals through the indexer: an entry signed by the scribe's owner appears in its
// journal; an entry signed by anyone else does not.
//   node tools/journal-check.ts --api <indexer> --rpc <url> --key <scribe owner.json> --scribe <address>
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { journalInstruction } from '../lib/src/journal.ts';

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); if (i < 0) throw new Error(`--${k} is required`); return process.argv[i + 1]; };
const api = arg('api');
const conn = new Connection(arg('rpc'), 'confirmed');
const owner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(arg('key'), 'utf8'))));
const scribe = new PublicKey(arg('scribe'));
const view = () => fetch(`${api}/scribe/${scribe.toBase58()}`).then((r) => r.json());

async function main() {
  const tag = Date.now().toString(36);
  const mine = `Tonight the fog came in early (${tag}).`;
  const theirs = `I belong to someone else now (${tag}).`;
  // A stranger, funded by the owner, writes to the same journal: it must be ignored.
  const stranger = Keypair.generate();
  await sendAndConfirmTransaction(conn, new Transaction().add(SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: stranger.publicKey, lamports: 0.002 * LAMPORTS_PER_SOL })), [owner]);
  await sendAndConfirmTransaction(conn, new Transaction().add(await journalInstruction(stranger.publicKey, scribe, theirs)), [stranger], { commitment: 'confirmed' });
  await sendAndConfirmTransaction(conn, new Transaction().add(await journalInstruction(owner.publicKey, scribe, mine)), [owner], { commitment: 'confirmed' });
  for (let i = 0; i < 90; i++) {
    const s = await view().catch(() => null);
    const texts: string[] = (s?.journal ?? []).map((j: { text: string }) => j.text);
    if (texts.includes(mine)) {
      assert.ok(!texts.includes(theirs), 'an entry by someone other than the owner must not count');
      console.log(`  the owner's entry is in the journal (${texts.length} entr${texts.length === 1 ? 'y' : 'ies'}); the stranger's is not`);
      console.log('journal: all good');
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('the indexer never showed the journal entry');
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });

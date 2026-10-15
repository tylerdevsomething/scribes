import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { decodeJournal, journalInstruction, journalTag, JOURNAL_MAX_BYTES } from '../src/journal.ts';
import { INK_PROGRAM } from '../src/chain.ts';
import { systemPrompt } from '../src/personality.ts';

test('a journal entry round-trips and names the scribe\'s tag, signed by the owner', async () => {
  const owner = Keypair.generate().publicKey, scribe = Keypair.generate().publicKey;
  const ix = await journalInstruction(owner, scribe, '  I met a fox today.  ');
  assert.ok(ix.programId.equals(INK_PROGRAM));
  assert.ok(ix.keys[0].pubkey.equals(owner) && ix.keys[0].isSigner);
  assert.ok(ix.keys[1].pubkey.equals(await journalTag(scribe)));
  assert.equal(decodeJournal(ix.data), 'I met a fox today.');
});

test('journal entries are bounded and foreign data is ignored', async () => {
  const k = Keypair.generate().publicKey;
  await assert.rejects(journalInstruction(k, k, ''));
  await assert.rejects(journalInstruction(k, k, 'x'.repeat(JOURNAL_MAX_BYTES + 1)));
  assert.equal(decodeJournal(new TextEncoder().encode('SCRB nope')), null);
  assert.ok(!(await journalTag(k)).equals(await journalTag(Keypair.generate().publicKey)));
});

test('the system prompt carries journal memories', () => {
  const p = { name: 'Mott', purpose: 'Keeps the light.', voice: 'Salty.', boundaries: 'Never lies.' };
  const s = systemPrompt(p, ['I met a fox today.']);
  assert.match(s, /From your journal.*I met a fox today/);
  assert.doesNotMatch(s, /Purpose:/);
});

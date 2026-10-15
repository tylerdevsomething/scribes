// A scribe's journal: memories written after its birth. Each entry is one instruction to the ink program
// naming the scribe's journal tag, signed by the scribe's owner at that moment. Only entries signed by
// the owner of the time count — so only whoever holds a scribe can teach it.
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { concat, decodeUtf8, sha256, utf8 } from './bytes.ts';
import { INK_PROGRAM } from './chain.ts';

export const JOURNAL_MAGIC = utf8.encode('SCRJ');
export const JOURNAL_VERSION = 1;
export const JOURNAL_MAX_BYTES = 600;

export async function journalTag(scribe: PublicKey): Promise<PublicKey> {
  return new PublicKey(await sha256(concat(utf8.encode('scribes:v1:journal'), scribe.toBytes())));
}

export async function journalInstruction(owner: PublicKey, scribe: PublicKey, text: string): Promise<TransactionInstruction> {
  const body = utf8.encode(text.trim());
  if (body.length === 0 || body.length > JOURNAL_MAX_BYTES) throw new Error(`a journal entry is 1 to ${JOURNAL_MAX_BYTES} bytes`);
  return new TransactionInstruction({
    programId: INK_PROGRAM,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: await journalTag(scribe), isSigner: false, isWritable: false },
    ],
    data: Buffer.from(concat(JOURNAL_MAGIC, new Uint8Array([JOURNAL_VERSION]), body)),
  });
}

export function decodeJournal(data: Uint8Array): string | null {
  if (data.length <= 5 || data.length > 5 + JOURNAL_MAX_BYTES) return null;
  for (let i = 0; i < 4; i++) if (data[i] !== JOURNAL_MAGIC[i]) return null;
  if (data[4] !== JOURNAL_VERSION) return null;
  try { return decodeUtf8(data.subarray(5)); } catch { return null; }
}

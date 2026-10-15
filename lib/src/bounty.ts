// Bounties: a question with a SOL reward. The reward lives in a program account (see programs/scribes);
// the question text and the answers are inscribed through the ink program, like journal entries:
//   question: "SCRQ" | version | text            — signed by the poster, its sha256 is in the bounty
//   answer:   "SCRA" | version | scribe (32) | text — signed by the scribe's owner of the time
import { BN, type Program } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { concat, decodeUtf8, fromHex, sha256, sha256Hex, toHex, utf8 } from './bytes.ts';
import { INK_PROGRAM } from './chain.ts';
import type { Scribes } from '../idl/scribes.ts';
import { SCRIBES_PROGRAM, configAddress, marketAddress } from './registry.ts';

export const QUESTION_MAGIC = utf8.encode('SCRQ');
export const ANSWER_MAGIC = utf8.encode('SCRA');
export const BOUNTY_TEXT_MAX = 900;
export const SLOTS_PER_HOUR = 9_000; // ~400 ms slots

export function bountyAddress(poster: PublicKey, id: bigint | number): PublicKey {
  const le = Buffer.alloc(8);
  le.writeBigUInt64LE(BigInt(id));
  return PublicKey.findProgramAddressSync([Buffer.from('bounty'), poster.toBuffer(), le], SCRIBES_PROGRAM)[0];
}

export async function bountyTag(bounty: PublicKey): Promise<PublicKey> {
  return new PublicKey(await sha256(concat(utf8.encode('scribes:v1:bounty'), bounty.toBytes())));
}

function ink(signer: PublicKey, tag: PublicKey, data: Uint8Array): TransactionInstruction {
  return new TransactionInstruction({
    programId: INK_PROGRAM,
    keys: [{ pubkey: signer, isSigner: true, isWritable: false }, { pubkey: tag, isSigner: false, isWritable: false }],
    data: Buffer.from(data),
  });
}

function checkText(text: string): Uint8Array {
  const b = utf8.encode(text.trim());
  if (b.length === 0 || b.length > BOUNTY_TEXT_MAX) throw new Error(`text must be 1 to ${BOUNTY_TEXT_MAX} bytes`);
  return b;
}

export async function questionSha(text: string): Promise<string> {
  return sha256Hex(checkText(text));
}

// Everything a poster signs at once: inscribe the question, then post the bounty with its hash.
export async function postBountyInstructions(program: Program<Scribes>, args: {
  poster: PublicKey; id: bigint; rewardLamports: number; hours: number; question: string;
}): Promise<{ bounty: PublicKey; ixs: TransactionInstruction[] }> {
  const bounty = bountyAddress(args.poster, args.id);
  const text = checkText(args.question);
  const sha = await sha256Hex(text);
  const post = await program.methods
    .postBounty(new BN(args.id.toString()), new BN(args.rewardLamports), new BN(Math.round(args.hours * SLOTS_PER_HOUR)), [...fromHex(sha)])
    .accountsPartial({ poster: args.poster, bounty, systemProgram: SystemProgram.programId })
    .instruction();
  const q = ink(args.poster, await bountyTag(bounty), concat(QUESTION_MAGIC, new Uint8Array([1]), text));
  return { bounty, ixs: [post, q] };
}

export async function answerInstruction(owner: PublicKey, bounty: PublicKey, scribe: PublicKey, text: string): Promise<TransactionInstruction> {
  return ink(owner, await bountyTag(bounty), concat(ANSWER_MAGIC, new Uint8Array([1]), scribe.toBytes(), checkText(text)));
}

export function decodeQuestion(data: Uint8Array): string | null {
  if (data.length <= 5 || !QUESTION_MAGIC.every((v, i) => data[i] === v) || data[4] !== 1) return null;
  try { return decodeUtf8(data.subarray(5)); } catch { return null; }
}

export function decodeAnswer(data: Uint8Array): { scribe: string; text: string } | null {
  if (data.length <= 37 || !ANSWER_MAGIC.every((v, i) => data[i] === v) || data[4] !== 1) return null;
  try { return { scribe: new PublicKey(data.subarray(5, 37)).toBase58(), text: decodeUtf8(data.subarray(37)) }; } catch { return null; }
}

export async function awardInstruction(program: Program<Scribes>, poster: PublicKey, bounty: PublicKey, scribe: PublicKey, owner: PublicKey) {
  const config = await program.account.config.fetch(configAddress());
  return program.methods.awardBounty().accountsPartial({
    poster, bounty, scribe, owner, config: configAddress(), market: marketAddress(), feeReceiver: config.feeReceiver,
  }).instruction();
}

export function refundInstruction(program: Program<Scribes>, poster: PublicKey, bounty: PublicKey) {
  return program.methods.refundBounty().accountsPartial({ poster, bounty }).instruction();
}

export interface BountyRecord { address: string; poster: string; id: string; reward: number; deadlineSlot: number; questionSha: string }

export async function openBounties(program: Program<Scribes>): Promise<BountyRecord[]> {
  return (await program.account.bounty.all()).map(({ publicKey, account: a }) => ({
    address: publicKey.toBase58(), poster: a.poster.toBase58(), id: a.id.toString(), reward: a.reward.toNumber(),
    deadlineSlot: a.deadlineSlot.toNumber(), questionSha: toHex(Uint8Array.from(a.questionSha)),
  }));
}

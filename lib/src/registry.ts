// Client side of the Scribes program: addresses, instructions and account reading.
// Shared by the CLI, the indexer and the website.
import { AnchorProvider, BN, Program, type Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram, type TransactionInstruction } from '@solana/web3.js';
import idl from '../idl/scribes.json' with { type: 'json' };
import type { Scribes } from '../idl/scribes.ts';
import { fromHex, toHex } from './bytes.ts';

export const SCRIBES_PROGRAM = new PublicKey(idl.address);
export const ZERO_SHA = '0'.repeat(64);

export function configAddress(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('config')], SCRIBES_PROGRAM)[0];
}
export function scribeAddress(manifestSha: string): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('scribe'), fromHex(manifestSha)], SCRIBES_PROGRAM)[0];
}
export function marketAddress(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('market')], SCRIBES_PROGRAM)[0];
}
export function listingAddress(scribe: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('listing'), scribe.toBuffer()], SCRIBES_PROGRAM)[0];
}
export function modelAddress(modelSha: string): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('model'), fromHex(modelSha)], SCRIBES_PROGRAM)[0];
}

// A read-only program handle (no signing wallet needed for reads and instruction building).
export function scribesProgram(conn: Connection): Program<Scribes> {
  const wallet = { publicKey: Keypair.generate().publicKey, signTransaction: async <T>(t: T) => t, signAllTransactions: async <T>(t: T) => t } as unknown as Wallet;
  return new Program<Scribes>(idl as Scribes, new AnchorProvider(conn, wallet, { commitment: 'confirmed' }));
}

export interface ScribeRecord {
  address: string;
  owner: string;
  manifestSha: string;
  manifestSize: number;
  writer: string;
  modelSha: string; // ZERO_SHA for a bound brain
  birthNumber: number;
  birthSlot: number;
  autograph: boolean;
  verified: boolean;
  verifiedSlot: number;
}

export async function allScribes(program: Program<Scribes>): Promise<ScribeRecord[]> {
  const list = await program.account.scribe.all();
  return list.map(({ publicKey, account: a }) => ({
    address: publicKey.toBase58(),
    owner: a.owner.toBase58(),
    manifestSha: toHex(Uint8Array.from(a.manifestSha)),
    manifestSize: a.manifestSize,
    writer: a.writer.toBase58(),
    modelSha: toHex(Uint8Array.from(a.modelSha)),
    birthNumber: a.birthNumber.toNumber(),
    birthSlot: a.birthSlot.toNumber(),
    autograph: a.autograph,
    verified: a.verified,
    verifiedSlot: a.verifiedSlot.toNumber(),
  }));
}

export async function birthInstruction(program: Program<Scribes>, args: {
  owner: PublicKey; writer: PublicKey; manifestSha: string; manifestSize: number; modelSha: string;
}): Promise<TransactionInstruction> {
  const config = await program.account.config.fetch(configAddress());
  return program.methods
    .birth({ manifestSha: [...fromHex(args.manifestSha)], manifestSize: args.manifestSize, modelSha: [...fromHex(args.modelSha)] })
    .accountsPartial({
      owner: args.owner, writer: args.writer, config: configAddress(), scribe: scribeAddress(args.manifestSha),
      modelMark: modelAddress(args.modelSha), feeReceiver: config.feeReceiver, systemProgram: SystemProgram.programId,
    })
    .instruction();
}

export interface SettingsInput {
  admin: PublicKey; verifier: PublicKey; feeReceiver: PublicKey; birthFee: number; burnMint: PublicKey; burnAmount: bigint;
}

export function settingsArg(s: SettingsInput) {
  return {
    admin: s.admin, verifier: s.verifier, feeReceiver: s.feeReceiver, birthFee: new BN(s.birthFee),
    burnMint: s.burnMint, burnAmount: new BN(s.burnAmount.toString()),
  };
}

// ---- the market ----

export interface ListingRecord { scribe: string; seller: string; price: number }

export async function allListings(program: Program<Scribes>): Promise<ListingRecord[]> {
  const list = await program.account.listing.all();
  return list.map(({ account: a }) => ({ scribe: a.scribe.toBase58(), seller: a.seller.toBase58(), price: a.price.toNumber() }));
}

export async function marketFeeBps(program: Program<Scribes>): Promise<number | null> {
  const m = await program.account.market.fetchNullable(marketAddress());
  return m ? m.feeBps : null;
}

function scribeKey(s: PublicKey | string): PublicKey { return typeof s === 'string' ? new PublicKey(s) : s; }

export function listInstruction(program: Program<Scribes>, owner: PublicKey, scribe: PublicKey | string, lamports: number) {
  const s = scribeKey(scribe);
  return program.methods.list(new BN(lamports)).accountsPartial({ owner, scribe: s, listing: listingAddress(s) }).instruction();
}

export function cancelInstruction(program: Program<Scribes>, signer: PublicKey, scribe: PublicKey | string, seller: PublicKey | string) {
  const s = scribeKey(scribe);
  return program.methods.cancel().accountsPartial({ signer, scribe: s, listing: listingAddress(s), seller: scribeKey(seller) }).instruction();
}

export async function buyInstruction(program: Program<Scribes>, buyer: PublicKey, scribe: PublicKey | string, seller: PublicKey | string, maxPrice: number) {
  const s = scribeKey(scribe);
  const config = await program.account.config.fetch(configAddress());
  return program.methods.buy(new BN(maxPrice)).accountsPartial({
    buyer, config: configAddress(), market: marketAddress(), scribe: s, listing: listingAddress(s),
    seller: scribeKey(seller), feeReceiver: config.feeReceiver,
  }).instruction();
}

export function giveInstruction(program: Program<Scribes>, owner: PublicKey, scribe: PublicKey | string, to: PublicKey) {
  return program.methods.give(to).accountsPartial({ owner, scribe: scribeKey(scribe) }).instruction();
}

// Runs every rule of the Scribes program against a local validator, including the ways it must refuse.
//   node tools/program-check.ts --rpc http://127.0.0.1:8899 --key <upgrade-authority keypair.json>
// Needs a fresh deploy (initialize can only run once).
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { AnchorProvider, Program, Wallet, BN } from '@coral-xyz/anchor';
import {
  Connection, Ed25519Program, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction,
  SYSVAR_INSTRUCTIONS_PUBKEY, sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID, createMint, getOrCreateAssociatedTokenAccount, mintTo, getMint,
} from '@solana/spl-token';
import { createHash } from 'node:crypto';
import type { Scribes } from '../lib/idl/scribes.ts';

const idl = JSON.parse(readFileSync(new URL('../lib/idl/scribes.json', import.meta.url), 'utf8'));
const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); if (i < 0) throw new Error(`--${k} is required`); return process.argv[i + 1]; };

const conn = new Connection(arg('rpc'), 'confirmed');
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(arg('key'), 'utf8'))));
const provider = new AnchorProvider(conn, new Wallet(admin), { commitment: 'confirmed' });
const program = new Program<Scribes>(idl, provider);
const PID = program.programId;
const LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');

const pda = (...seeds: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds.map((s) => Buffer.from(s)), PID)[0];
const configPda = pda(Buffer.from('config'));
const scribePda = (m: Buffer) => pda(Buffer.from('scribe'), m);
const modelPda = (m: Buffer) => pda(Buffer.from('model'), m);
const sha = (s: string) => createHash('sha256').update(s).digest();
const ZERO = Buffer.alloc(32);

let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}
async function refuses(name: string, fn: () => Promise<unknown>, want: RegExp) {
  try {
    await fn();
  } catch (e) {
    const text = String((e as Error).message) + JSON.stringify((e as { logs?: string[] }).logs ?? (e as { transactionLogs?: string[] }).transactionLogs ?? '');
    assert.match(text, want, `${name}: refused for the wrong reason:\n${text.slice(0, 800)}`);
    passed++;
    console.log(`  ok  refuses: ${name}`);
    return;
  }
  throw new Error(`${name}: was NOT refused`);
}

async function funded(sol = 5): Promise<Keypair> {
  const k = Keypair.generate();
  const sig = await conn.requestAirdrop(k.publicKey, sol * LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig, 'confirmed');
  return k;
}

function birthIx(owner: PublicKey, writer: PublicKey, manifest: Buffer, model: Buffer, feeReceiver: PublicKey) {
  return program.methods
    .birth({ manifestSha: [...manifest], manifestSize: 900, modelSha: [...model] })
    .accountsPartial({ owner, writer, config: configPda, scribe: scribePda(manifest), modelMark: modelPda(model), feeReceiver, systemProgram: SystemProgram.programId });
}

function pass(signer: Keypair, scribe: PublicKey, manifest: Buffer) {
  const message = Buffer.concat([Buffer.from('scribes:v1:verify'), scribe.toBuffer(), manifest]);
  return Ed25519Program.createInstructionWithPrivateKey({ privateKey: signer.secretKey, message });
}

async function main() {
  const programData = PublicKey.findProgramAddressSync([PID.toBuffer()], LOADER)[0];
  const verifier = Keypair.generate();
  const feeReceiver = Keypair.generate().publicKey;
  const settings = { admin: admin.publicKey, verifier: verifier.publicKey, feeReceiver, birthFee: new BN(10_000_000), burnMint: PublicKey.default, burnAmount: new BN(0) };
  console.log(`program ${PID.toBase58()}`);

  const stranger = await funded();
  await refuses('initialize by someone other than the upgrade authority', () =>
    program.methods.initialize(settings).accountsPartial({ payer: stranger.publicKey, config: configPda, program: PID, programData }).signers([stranger]).rpc(),
  /NotUpgradeAuthority/);
  await check('initialize by the upgrade authority', async () => {
    await program.methods.initialize(settings).accountsPartial({ payer: admin.publicKey, config: configPda, program: PID, programData }).rpc();
    const c = await program.account.config.fetch(configPda);
    assert.equal(c.births.toNumber(), 0);
    assert.ok(c.verifier.equals(verifier.publicKey));
  });
  await refuses('initialize twice', () =>
    program.methods.initialize(settings).accountsPartial({ payer: admin.publicKey, config: configPda, program: PID, programData }).rpc(),
  /already in use/);

  const alice = await funded();
  const bob = await funded();
  const writer = Keypair.generate();
  const modelA = sha('model A');
  const m1 = sha('manifest 1'), m2 = sha('manifest 2'), m3 = sha('manifest 3'), m4 = sha('manifest 4');

  await refuses('birth without the writer signing', async () => {
    const ix = await birthIx(alice.publicKey, writer.publicKey, m1, modelA, feeReceiver).instruction();
    const tx = new Transaction().add(ix);
    tx.feePayer = alice.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    tx.sign(alice);
    await conn.sendRawTransaction(tx.serialize({ requireAllSignatures: false }));
  }, /signature|Signature/);
  await refuses('birth paying the fee to the wrong account', () =>
    birthIx(alice.publicKey, writer.publicKey, m1, modelA, bob.publicKey).signers([alice, writer]).rpc(),
  /WrongFeeReceiver/);

  await check('first scribe on a model: birth #0 with the Autograph, fee paid', async () => {
    const before = await conn.getBalance(feeReceiver);
    await birthIx(alice.publicKey, writer.publicKey, m1, modelA, feeReceiver).signers([alice, writer]).rpc();
    const s = await program.account.scribe.fetch(scribePda(m1));
    assert.equal(s.birthNumber.toNumber(), 0);
    assert.equal(s.autograph, true);
    assert.ok(s.owner.equals(alice.publicKey));
    assert.ok(s.writer.equals(writer.publicKey));
    assert.equal((await conn.getBalance(feeReceiver)) - before, 10_000_000);
    // ModelMark: 8-byte discriminator, model_sha (32), first_scribe (32), first_birth (u64), bump
    const mark = (await conn.getAccountInfo(modelPda(modelA)))!;
    assert.ok(mark.owner.equals(PID));
    assert.deepEqual(mark.data.subarray(8, 40), modelA);
    assert.ok(new PublicKey(mark.data.subarray(40, 72)).equals(scribePda(m1)));
  });
  await check('second scribe on the same model: birth #1, no Autograph', async () => {
    await birthIx(bob.publicKey, writer.publicKey, m2, modelA, feeReceiver).signers([bob, writer]).rpc();
    const s = await program.account.scribe.fetch(scribePda(m2));
    assert.equal(s.birthNumber.toNumber(), 1);
    assert.equal(s.autograph, false);
  });
  await refuses('the same manifest born twice', () =>
    birthIx(bob.publicKey, writer.publicKey, m1, modelA, feeReceiver).signers([bob, writer]).rpc(),
  /already in use/);
  await check('a bound brain (no model): birth #2, no Autograph, no model record', async () => {
    await birthIx(bob.publicKey, bob.publicKey, m3, ZERO, feeReceiver).signers([bob]).rpc();
    const s = await program.account.scribe.fetch(scribePda(m3));
    assert.equal(s.birthNumber.toNumber(), 2);
    assert.equal(s.autograph, false);
    assert.equal(await conn.getAccountInfo(modelPda(ZERO)), null);
  });
  await check('a model whose record address was pre-funded by someone else still gets its Autograph', async () => {
    const modelB = sha('model B');
    await sendAndConfirmTransaction(conn, new Transaction().add(SystemProgram.transfer({ fromPubkey: bob.publicKey, toPubkey: modelPda(modelB), lamports: 1_000_000 })), [bob]);
    await birthIx(alice.publicKey, writer.publicKey, m4, modelB, feeReceiver).signers([alice, writer]).rpc();
    assert.equal((await program.account.scribe.fetch(scribePda(m4))).autograph, true);
  });

  // ---- verification ----
  const s1 = scribePda(m1);
  const mintAuthority = await funded();
  const mint = await createMint(conn, mintAuthority, mintAuthority.publicKey, null, 6, undefined, { commitment: 'confirmed' }, TOKEN_2022_PROGRAM_ID);
  const aliceTokens = (await getOrCreateAssociatedTokenAccount(conn, alice, mint, alice.publicKey, false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID)).address;
  await mintTo(conn, mintAuthority, mint, aliceTokens, mintAuthority, 5_000_000_000, [], { commitment: 'confirmed' }, TOKEN_2022_PROGRAM_ID);
  const verify = (owner: Keypair, scribe: PublicKey, tokens: PublicKey, m = mint) => program.methods.verify().accountsPartial({
    owner: owner.publicKey, config: configPda, scribe, mint: m, ownerTokens: tokens, tokenProgram: TOKEN_2022_PROGRAM_ID, instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
  }).signers([owner]);

  await refuses('verify before the token is set', () =>
    verify(alice, s1, aliceTokens).preInstructions([pass(verifier, s1, m1)]).rpc(),
  /WrongMint|VerificationClosed/);
  await refuses('settings changed by someone other than the admin', () =>
    program.methods.setSettings({ ...settings, burnMint: mint, burnAmount: new BN(1_000_000) }).accountsPartial({ admin: stranger.publicKey, config: configPda }).signers([stranger]).rpc(),
  /NotAdmin/);
  await check('admin sets the token and burn amount', async () => {
    await program.methods.setSettings({ ...settings, burnMint: mint, burnAmount: new BN(1_000_000) }).accountsPartial({ admin: admin.publicKey, config: configPda }).rpc();
  });
  await refuses('verify with no pass', () => verify(alice, s1, aliceTokens).rpc(), /MissingPass/);
  await refuses('verify with a pass signed by someone else', () =>
    verify(alice, s1, aliceTokens).preInstructions([pass(stranger, s1, m1)]).rpc(),
  /WrongVerifier/);
  await refuses('verify with a pass for a different scribe', () =>
    verify(alice, s1, aliceTokens).preInstructions([pass(verifier, scribePda(m2), m2)]).rpc(),
  /BadPass/);
  await refuses('verify a scribe you do not own', async () => {
    const bobTokens = (await getOrCreateAssociatedTokenAccount(conn, bob, mint, bob.publicKey, false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID)).address;
    return verify(bob, s1, bobTokens).preInstructions([pass(verifier, s1, m1)]).rpc();
  }, /NotOwner/);
  await refuses('a forged pass (signature does not match)', async () => {
    const ix = pass(verifier, s1, m1);
    ix.data[ix.data.length - 1] ^= 1; // flip a byte of the message after signing
    return verify(alice, s1, aliceTokens).preInstructions([ix]).rpc();
  }, /custom program error|failed|invalid/i);
  await check('verify burns the set amount and marks the scribe verified', async () => {
    const before = (await getMint(conn, mint, 'confirmed', TOKEN_2022_PROGRAM_ID)).supply;
    await verify(alice, s1, aliceTokens).preInstructions([pass(verifier, s1, m1)]).rpc();
    const after = (await getMint(conn, mint, 'confirmed', TOKEN_2022_PROGRAM_ID)).supply;
    assert.equal(before - after, 1_000_000n);
    assert.equal((await program.account.scribe.fetch(s1)).verified, true);
  });
  await refuses('verify twice', () => verify(alice, s1, aliceTokens).preInstructions([pass(verifier, s1, m1)]).rpc(), /AlreadyVerified/);

  // ---- giving ----
  await refuses('give a scribe you do not own', () =>
    program.methods.give(stranger.publicKey).accountsPartial({ owner: bob.publicKey, scribe: s1 }).signers([bob]).rpc(),
  /NotOwner/);
  await check('give: the owner changes, the verification stays', async () => {
    await program.methods.give(bob.publicKey).accountsPartial({ owner: alice.publicKey, scribe: s1 }).signers([alice]).rpc();
    const s = await program.account.scribe.fetch(s1);
    assert.ok(s.owner.equals(bob.publicKey));
    assert.equal(s.verified, true);
  });

  await check('the program has no instruction that closes anything', async () => {
    const names = idl.instructions.map((i: { name: string }) => i.name).sort();
    assert.deepEqual(names, ['birth', 'give', 'initialize', 'set_settings', 'verify']);
  });

  console.log(`\nall ${passed} checks passed`);
}

main().catch((e) => { console.error(e); process.exit(1); });

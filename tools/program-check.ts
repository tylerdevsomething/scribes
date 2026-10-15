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

  // ---- the market ----
  const marketPda = pda(Buffer.from('market'));
  const listingPda = (scribe: PublicKey) => pda(Buffer.from('listing'), scribe.toBuffer());
  const list = (owner: Keypair, scribe: PublicKey, lamports: number) => program.methods.list(new BN(lamports))
    .accountsPartial({ owner: owner.publicKey, scribe, listing: listingPda(scribe) }).signers([owner]).rpc();
  const buy = async (buyer: Keypair, scribe: PublicKey, max: number) => {
    const l = await program.account.listing.fetch(listingPda(scribe));
    return program.methods.buy(new BN(max)).accountsPartial({
      buyer: buyer.publicKey, config: configPda, market: marketPda, scribe, listing: listingPda(scribe), seller: l.seller, feeReceiver,
    }).signers([buyer]).rpc();
  };
  const cancel = (signer: Keypair, scribe: PublicKey, seller: PublicKey) => program.methods.cancel()
    .accountsPartial({ signer: signer.publicKey, scribe, listing: listingPda(scribe), seller }).signers([signer]).rpc();

  await refuses('market fee set by someone other than the admin', () =>
    program.methods.setMarket(250).accountsPartial({ admin: stranger.publicKey, config: configPda, market: marketPda }).signers([stranger]).rpc(),
  /NotAdmin/);
  await refuses('a market fee above 10%', () =>
    program.methods.setMarket(1001).accountsPartial({ admin: admin.publicKey, config: configPda, market: marketPda }).rpc(),
  /FeeTooHigh/);
  await check('admin sets a 2.5% sale fee', async () => {
    await program.methods.setMarket(250).accountsPartial({ admin: admin.publicKey, config: configPda, market: marketPda }).rpc();
    assert.equal((await program.account.market.fetch(marketPda)).feeBps, 250);
  });

  // bob owns s1 now (given above).
  await refuses('listing a scribe you do not own', () => list(alice, s1, LAMPORTS_PER_SOL), /NotOwner/);
  await refuses('listing for nothing', () => list(bob, s1, 0), /BadPrice/);
  await check('list, then list again to change the price', async () => {
    await list(bob, s1, LAMPORTS_PER_SOL);
    await list(bob, s1, LAMPORTS_PER_SOL / 2);
    assert.equal((await program.account.listing.fetch(listingPda(s1))).price.toNumber(), LAMPORTS_PER_SOL / 2);
    assert.ok((await program.account.scribe.fetch(s1)).owner.equals(bob.publicKey), 'listing moves nothing');
  });
  await refuses("cancelling someone else's live listing", () => cancel(stranger, s1, bob.publicKey), /NotOwner/);
  const carol = await funded();
  await refuses('buying above the price you agreed to (price raised)', async () => {
    await list(bob, s1, LAMPORTS_PER_SOL); // raised just before the buy lands
    return buy(carol, s1, LAMPORTS_PER_SOL / 2);
  }, /PriceChanged/);
  await refuses('buying your own listing', () => buy(bob, s1, LAMPORTS_PER_SOL), /BadOwner/);
  await check('buy: seller paid minus 2.5%, fee to the receiver, scribe moves, listing closed, badge stays', async () => {
    const [sellerBefore, feeBefore] = [await conn.getBalance(bob.publicKey), await conn.getBalance(feeReceiver)];
    const rent = (await conn.getAccountInfo(listingPda(s1)))!.lamports;
    await buy(carol, s1, LAMPORTS_PER_SOL);
    assert.equal((await conn.getBalance(bob.publicKey)) - sellerBefore, LAMPORTS_PER_SOL * 0.975 + rent);
    assert.equal((await conn.getBalance(feeReceiver)) - feeBefore, LAMPORTS_PER_SOL * 0.025);
    const s = await program.account.scribe.fetch(s1);
    assert.ok(s.owner.equals(carol.publicKey));
    assert.equal(s.verified, true);
    assert.equal(await conn.getAccountInfo(listingPda(s1)), null);
  });
  await check('a listing left behind after a gift cannot be bought, and anyone can clear it', async () => {
    const dave = Keypair.generate().publicKey;
    await list(carol, s1, LAMPORTS_PER_SOL);
    await program.methods.give(dave).accountsPartial({ owner: carol.publicKey, scribe: s1 }).signers([carol]).rpc();
    await assert.rejects(buy(alice, s1, LAMPORTS_PER_SOL), /StaleListing/);
    const before = await conn.getBalance(carol.publicKey);
    await cancel(stranger, s1, carol.publicKey);
    assert.equal(await conn.getAccountInfo(listingPda(s1)), null);
    assert.ok((await conn.getBalance(carol.publicKey)) > before, 'the rent goes back to the seller');
    assert.ok((await program.account.scribe.fetch(s1)).owner.equals(dave));
  });

  // ---- bounties ----
  const { postBountyInstructions, awardInstruction, refundInstruction, bountyAddress } = await import('../lib/src/bounty.ts');
  const post = async (poster: Keypair, id: bigint, sol: number, hours: number) => {
    const { ixs } = await postBountyInstructions(program, { poster: poster.publicKey, id, rewardLamports: sol * LAMPORTS_PER_SOL, hours, question: 'What is the best lighthouse?' });
    return sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [poster], { commitment: 'confirmed' });
  };
  const poster = await funded(5);
  const scribeOwner = (await program.account.scribe.fetch(s1)).owner; // dave, from the gift above
  await refuses('a bounty below 0.01 SOL', () => post(poster, 1n, 0.001, 2), /BountyTooSmall/);
  await refuses('a bounty shorter than an hour', () => post(poster, 1n, 0.5, 0.5), /BadDeadline/);
  await check('post a 0.5 SOL bounty: the reward moves into the bounty account', async () => {
    await post(poster, 1n, 0.5, 2);
    const b = await program.account.bounty.fetch(bountyAddress(poster.publicKey, 1n));
    assert.equal(b.reward.toNumber(), LAMPORTS_PER_SOL / 2);
    assert.ok((await conn.getBalance(bountyAddress(poster.publicKey, 1n))) > LAMPORTS_PER_SOL / 2);
  });
  const b1 = bountyAddress(poster.publicKey, 1n);
  await refuses('a refund before the deadline', async () => sendAndConfirmTransaction(conn, new Transaction().add(await refundInstruction(program, poster.publicKey, b1)), [poster]), /BountyStillOpen/);
  await refuses('an award by someone other than the poster', async () => {
    const ix = await awardInstruction(program, stranger.publicKey, b1, s1, scribeOwner);
    return sendAndConfirmTransaction(conn, new Transaction().add(ix), [stranger]);
  }, /NotPoster|ConstraintSeeds|seeds/);
  await refuses("an award paid to someone other than the scribe's owner", async () => {
    const ix = await awardInstruction(program, poster.publicKey, b1, s1, stranger.publicKey);
    return sendAndConfirmTransaction(conn, new Transaction().add(ix), [poster]);
  }, /NotOwner/);
  await check("award: the scribe's owner gets the reward minus 2.5%, the fee goes to the receiver, the rent back to the poster", async () => {
    const [ownerBefore, feeBefore, posterBefore] = [await conn.getBalance(scribeOwner), await conn.getBalance(feeReceiver), await conn.getBalance(poster.publicKey)];
    const rent = (await conn.getBalance(b1)) - LAMPORTS_PER_SOL / 2;
    await sendAndConfirmTransaction(conn, new Transaction().add(await awardInstruction(program, poster.publicKey, b1, s1, scribeOwner)), [poster], { commitment: 'confirmed' });
    assert.equal((await conn.getBalance(scribeOwner)) - ownerBefore, LAMPORTS_PER_SOL / 2 * 0.975);
    assert.equal((await conn.getBalance(feeReceiver)) - feeBefore, LAMPORTS_PER_SOL / 2 * 0.025);
    const back = (await conn.getBalance(poster.publicKey)) - posterBefore; // the rent, less this transaction's fee
    assert.ok(back > rent - 20_000 && back <= rent, `poster got ${back}, rent was ${rent}`);
    assert.equal(await conn.getAccountInfo(b1), null);
  });
  await refuses('awarding the same bounty twice', async () => sendAndConfirmTransaction(conn, new Transaction().add(await awardInstruction(program, poster.publicKey, b1, s1, scribeOwner)), [poster]), /AccountNotInitialized|not exist|could not find/i);

  await check('no instruction closes a scribe (only listings close)', async () => {
    const names = idl.instructions.map((i: { name: string }) => i.name).sort();
    assert.deepEqual(names, ['award_bounty', 'birth', 'buy', 'cancel', 'give', 'initialize', 'list', 'post_bounty', 'refund_bounty', 'set_market', 'set_settings', 'verify']);
    for (const i of idl.instructions as { name: string; accounts: { name: string }[] }[]) {
      if (['buy', 'cancel', 'award_bounty', 'refund_bounty'].includes(i.name)) continue; // listings and bounties close, never scribes
      assert.ok(!JSON.stringify(i).includes('"close"'), `${i.name} must not close anything`);
    }
  });

  console.log(`\nall ${passed} checks passed`);
}

main().catch((e) => { console.error(e); process.exit(1); });

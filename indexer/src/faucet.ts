// Test faucet for local and devnet testing: SOL (local validator only) and test $SCRIBES from the
// stand-in token mint (created with `node tools/cli.ts test-token`). Never enabled on mainnet.
import { Connection, LAMPORTS_PER_SOL, PublicKey, type Keypair } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import { readSettings, scribesProgram } from '../../lib/src/registry.ts';

const DRIP_TOKENS = 100n; // whole tokens per request
const last = new Map<string, number>();

export class Faucet {
  private conn: Connection;
  private authority: Keypair;
  constructor(conn: Connection, authority: Keypair) { this.conn = conn; this.authority = authority; }

  async drip(owner: PublicKey): Promise<{ sol: number; tokens: string }> {
    const k = owner.toBase58();
    if (Date.now() - (last.get(k) ?? 0) < 30_000) throw new Error('one drip every 30 seconds');
    last.set(k, Date.now());
    let sol = 0;
    if ((this.conn.rpcEndpoint.includes('127.0.0.1') || this.conn.rpcEndpoint.includes('localhost'))) {
      await this.conn.confirmTransaction(await this.conn.requestAirdrop(owner, 2 * LAMPORTS_PER_SOL), 'confirmed');
      sol = 2;
    }
    const s = await readSettings(scribesProgram(this.conn));
    if (!s.burnMint) return { sol, tokens: '0' };
    const mint = new PublicKey(s.burnMint);
    const ata = await getOrCreateAssociatedTokenAccount(this.conn, this.authority, mint, owner, false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID);
    await mintTo(this.conn, this.authority, mint, ata.address, this.authority, DRIP_TOKENS * 1_000_000n, [], { commitment: 'confirmed' }, TOKEN_2022_PROGRAM_ID);
    return { sol, tokens: DRIP_TOKENS.toString() };
  }
}

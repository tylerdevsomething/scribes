// Scribes: the birth registry for inscribed agents.
//
// A scribe's files live in transaction data (see lib/src/chain.ts); this program records who owns each
// scribe, its birth number, whether it was the first scribe to use its model (the Autograph), and
// whether it was verified, and its sale listings. Nothing closes a scribe: once born, it exists for
// ever. (A listing is a separate small account; it is closed when it is cancelled or bought.)
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{ed25519_program, sysvar::instructions as ix_sysvar};
use anchor_lang::system_program::{self, Allocate, Assign, CreateAccount, Transfer};
use anchor_spl::token_interface::{self, Burn, Mint, TokenAccount, TokenInterface};

declare_id!("E6BMZvTkKXnEF8dDfBBBmeBZptu2ZZUa66CJ1jvLpVmq");

/// The verifier signs VERIFY_DOMAIN || scribe address || manifest sha256.
pub const VERIFY_DOMAIN: &[u8] = b"scribes:v1:verify";

#[program]
pub mod scribes {
    use super::*;

    /// Creates the settings. Only the program's upgrade authority can call it, once.
    pub fn initialize(ctx: Context<Initialize>, settings: Settings) -> Result<()> {
        let c = &mut ctx.accounts.config;
        c.apply(settings);
        c.births = 0;
        c.bump = ctx.bumps.config;
        Ok(())
    }

    /// Changes the settings (the admin will be the multisig).
    pub fn set_settings(ctx: Context<SetSettings>, settings: Settings) -> Result<()> {
        ctx.accounts.config.apply(settings);
        Ok(())
    }

    /// Registers a scribe. Signed by its owner (who pays) and by the writer of its manifest, so nobody
    /// can see a manifest on chain and claim it first.
    pub fn birth(ctx: Context<Birth>, args: BirthArgs) -> Result<()> {
        require!(args.manifest_size > 0, ScribeError::EmptyManifest);
        let fee = ctx.accounts.config.birth_fee;
        if fee > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    Transfer { from: ctx.accounts.owner.to_account_info(), to: ctx.accounts.fee_receiver.to_account_info() },
                ),
                fee,
            )?;
        }

        let config = &mut ctx.accounts.config;
        let number = config.births;
        config.births = number.checked_add(1).ok_or(ScribeError::Overflow)?;

        let scribe_key = ctx.accounts.scribe.key();
        let autograph = args.model_sha != [0u8; 32] && claim_model(&ctx, &args, scribe_key, number)?;

        let s = &mut ctx.accounts.scribe;
        s.owner = ctx.accounts.owner.key();
        s.manifest_sha = args.manifest_sha;
        s.manifest_size = args.manifest_size;
        s.writer = ctx.accounts.writer.key();
        s.model_sha = args.model_sha;
        s.birth_number = number;
        s.birth_slot = Clock::get()?.slot;
        s.autograph = autograph;
        s.verified = false;
        s.verified_slot = 0;
        s.bump = ctx.bumps.scribe;

        emit!(Born { scribe: scribe_key, owner: s.owner, birth_number: number, autograph });
        Ok(())
    }

    /// Verifies a scribe: the verifier's signed pass for this exact scribe and manifest must be the
    /// instruction just before this one, and the owner burns the set amount of the token.
    pub fn verify(ctx: Context<Verify>) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(config.burn_mint != Pubkey::default(), ScribeError::VerificationClosed);
        let s = &ctx.accounts.scribe;
        require!(!s.verified, ScribeError::AlreadyVerified);

        let scribe_key = s.key();
        let message = [VERIFY_DOMAIN, scribe_key.as_ref(), s.manifest_sha.as_ref()].concat();
        check_verifier_pass(&ctx.accounts.instructions, &config.verifier, &message)?;

        if config.burn_amount > 0 {
            token_interface::burn(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    Burn {
                        mint: ctx.accounts.mint.to_account_info(),
                        from: ctx.accounts.owner_tokens.to_account_info(),
                        authority: ctx.accounts.owner.to_account_info(),
                    },
                ),
                config.burn_amount,
            )?;
        }

        let s = &mut ctx.accounts.scribe;
        s.verified = true;
        s.verified_slot = Clock::get()?.slot;
        emit!(Verified { scribe: scribe_key, burned: config.burn_amount });
        Ok(())
    }

    /// Gives a scribe to someone else.
    pub fn give(ctx: Context<Give>, new_owner: Pubkey) -> Result<()> {
        require!(new_owner != Pubkey::default(), ScribeError::BadOwner);
        let s = &mut ctx.accounts.scribe;
        let from = s.owner;
        s.owner = new_owner;
        emit!(Given { scribe: s.key(), from, to: new_owner });
        Ok(())
    }

    /// Sets the marketplace sale fee (basis points of the price, paid to the fee receiver). Admin only.
    pub fn set_market(ctx: Context<SetMarket>, fee_bps: u16) -> Result<()> {
        require!(fee_bps <= MAX_FEE_BPS, ScribeError::FeeTooHigh);
        let m = &mut ctx.accounts.market;
        m.fee_bps = fee_bps;
        m.bump = ctx.bumps.market;
        Ok(())
    }

    /// Lists a scribe for sale at a price in lamports (listing again changes the price).
    /// Nothing moves: the scribe stays with its owner until someone buys it.
    pub fn list(ctx: Context<List>, price: u64) -> Result<()> {
        require!(price > 0, ScribeError::BadPrice);
        let l = &mut ctx.accounts.listing;
        l.scribe = ctx.accounts.scribe.key();
        l.seller = ctx.accounts.owner.key();
        l.price = price;
        l.bump = ctx.bumps.listing;
        emit!(Listed { scribe: l.scribe, seller: l.seller, price });
        Ok(())
    }

    /// Takes a listing down. The owner can always do it; anyone can clear a listing whose seller no
    /// longer owns the scribe (it was given away). The listing's rent goes back to the seller.
    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
        let l = &ctx.accounts.listing;
        let owner = ctx.accounts.scribe.owner;
        require!(ctx.accounts.signer.key() == owner || l.seller != owner, ScribeError::NotOwner);
        emit!(Unlisted { scribe: l.scribe });
        Ok(())
    }

    /// Buys a listed scribe: the price goes to the seller minus the sale fee, and the scribe is the
    /// buyer's. `max_price` protects the buyer from a price raised just before their transaction lands.
    pub fn buy(ctx: Context<Buy>, max_price: u64) -> Result<()> {
        let l = &ctx.accounts.listing;
        require!(l.seller == ctx.accounts.scribe.owner, ScribeError::StaleListing);
        require!(l.price <= max_price, ScribeError::PriceChanged);
        require!(ctx.accounts.buyer.key() != l.seller, ScribeError::BadOwner);
        let fee = (l.price as u128 * ctx.accounts.market.fee_bps as u128 / 10_000) as u64;
        let sys = ctx.accounts.system_program.to_account_info();
        let buyer = ctx.accounts.buyer.to_account_info();
        pay(&sys, &buyer, ctx.accounts.seller.to_account_info(), l.price - fee)?;
        pay(&sys, &buyer, ctx.accounts.fee_receiver.to_account_info(), fee)?;
        let price = l.price;
        let s = &mut ctx.accounts.scribe;
        let from = s.owner;
        s.owner = ctx.accounts.buyer.key();
        emit!(Sold { scribe: s.key(), from, to: s.owner, price, fee });
        Ok(())
    }
}

fn pay<'a>(sys: &AccountInfo<'a>, from: &AccountInfo<'a>, to: AccountInfo<'a>, amount: u64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    system_program::transfer(CpiContext::new(sys.clone(), Transfer { from: from.clone(), to }), amount)
}

/// Highest sale fee the admin can set: 10%.
pub const MAX_FEE_BPS: u16 = 1_000;

/// Creates the model's record if this is the first scribe to use the model. Returns true if so.
fn claim_model(ctx: &Context<Birth>, args: &BirthArgs, scribe: Pubkey, number: u64) -> Result<bool> {
    let mark = &ctx.accounts.model_mark;
    if *mark.owner == crate::ID {
        return Ok(false); // an earlier scribe already holds the Autograph
    }
    let space = 8 + ModelMark::INIT_SPACE;
    let rent = Rent::get()?.minimum_balance(space);
    let bump = [ctx.bumps.model_mark];
    let seeds: &[&[u8]] = &[b"model", args.model_sha.as_ref(), &bump];
    let sys = ctx.accounts.system_program.to_account_info();
    let payer = ctx.accounts.owner.to_account_info();
    if mark.lamports() == 0 {
        system_program::create_account(
            CpiContext::new_with_signer(sys, CreateAccount { from: payer, to: mark.to_account_info() }, &[seeds]),
            rent,
            space as u64,
            &crate::ID,
        )?;
    } else {
        // Someone sent lamports to the address first; it is still an empty system account. Finish it.
        if mark.lamports() < rent {
            system_program::transfer(
                CpiContext::new(sys.clone(), Transfer { from: payer, to: mark.to_account_info() }),
                rent - mark.lamports(),
            )?;
        }
        system_program::allocate(CpiContext::new_with_signer(sys.clone(), Allocate { account_to_allocate: mark.to_account_info() }, &[seeds]), space as u64)?;
        system_program::assign(CpiContext::new_with_signer(sys, Assign { account_to_assign: mark.to_account_info() }, &[seeds]), &crate::ID)?;
    }
    let record = ModelMark { model_sha: args.model_sha, first_scribe: scribe, first_birth: number, bump: ctx.bumps.model_mark };
    let mut data = mark.try_borrow_mut_data()?;
    let mut out: &mut [u8] = &mut data;
    record.try_serialize(&mut out)?;
    Ok(true)
}

/// The instruction before this one must be an Ed25519 signature check of `message` by `verifier`,
/// with the key, signature and message all inside that instruction.
fn check_verifier_pass(instructions: &AccountInfo, verifier: &Pubkey, message: &[u8]) -> Result<()> {
    let current = ix_sysvar::load_current_index_checked(instructions)? as usize;
    require!(current > 0, ScribeError::MissingPass);
    let ix = ix_sysvar::load_instruction_at_checked(current - 1, instructions)?;
    require!(ix.program_id == ed25519_program::ID, ScribeError::MissingPass);
    let d = &ix.data;
    require!(d.len() >= 16 && d[0] == 1, ScribeError::BadPass);
    let u16_at = |o: usize| u16::from_le_bytes([d[o], d[o + 1]]);
    let (sig_ix, pk_off, pk_ix) = (u16_at(4), u16_at(6) as usize, u16_at(8));
    let (msg_off, msg_len, msg_ix) = (u16_at(10) as usize, u16_at(12) as usize, u16_at(14));
    require!(sig_ix == u16::MAX && pk_ix == u16::MAX && msg_ix == u16::MAX, ScribeError::BadPass);
    let pk = d.get(pk_off..pk_off + 32).ok_or(ScribeError::BadPass)?;
    let msg = d.get(msg_off..msg_off + msg_len).ok_or(ScribeError::BadPass)?;
    require!(pk == verifier.as_ref(), ScribeError::WrongVerifier);
    require!(msg == message, ScribeError::BadPass);
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Settings {
    pub admin: Pubkey,
    pub verifier: Pubkey,
    pub fee_receiver: Pubkey,
    pub birth_fee: u64,
    /// Pubkey::default() until the token exists: verification is closed until then.
    pub burn_mint: Pubkey,
    pub burn_amount: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct BirthArgs {
    pub manifest_sha: [u8; 32],
    pub manifest_size: u32,
    /// All zeros for a bound brain (no inscribed model).
    pub model_sha: [u8; 32],
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub verifier: Pubkey,
    pub fee_receiver: Pubkey,
    pub birth_fee: u64,
    pub burn_mint: Pubkey,
    pub burn_amount: u64,
    pub births: u64,
    pub bump: u8,
}

impl Config {
    fn apply(&mut self, s: Settings) {
        self.admin = s.admin;
        self.verifier = s.verifier;
        self.fee_receiver = s.fee_receiver;
        self.birth_fee = s.birth_fee;
        self.burn_mint = s.burn_mint;
        self.burn_amount = s.burn_amount;
    }
}

#[account]
#[derive(InitSpace)]
pub struct Scribe {
    pub owner: Pubkey,
    pub manifest_sha: [u8; 32],
    pub manifest_size: u32,
    pub writer: Pubkey,
    pub model_sha: [u8; 32],
    pub birth_number: u64,
    pub birth_slot: u64,
    pub autograph: bool,
    pub verified: bool,
    pub verified_slot: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ModelMark {
    pub model_sha: [u8; 32],
    pub first_scribe: Pubkey,
    pub first_birth: u64,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init, payer = payer, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ ScribeError::NotUpgradeAuthority)]
    pub program: Program<'info, crate::program::Scribes>,
    #[account(constraint = program_data.upgrade_authority_address == Some(payer.key()) @ ScribeError::NotUpgradeAuthority)]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetSettings<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = admin @ ScribeError::NotAdmin)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
#[instruction(args: BirthArgs)]
pub struct Birth<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    pub writer: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(init, payer = owner, space = 8 + Scribe::INIT_SPACE, seeds = [b"scribe", args.manifest_sha.as_ref()], bump)]
    pub scribe: Account<'info, Scribe>,
    /// CHECK: the model's record; created here for the first scribe using the model (address fixed by seeds).
    #[account(mut, seeds = [b"model", args.model_sha.as_ref()], bump)]
    pub model_mark: UncheckedAccount<'info>,
    /// CHECK: must be the configured fee receiver.
    #[account(mut, address = config.fee_receiver @ ScribeError::WrongFeeReceiver)]
    pub fee_receiver: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Verify<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, has_one = owner @ ScribeError::NotOwner, seeds = [b"scribe", scribe.manifest_sha.as_ref()], bump = scribe.bump)]
    pub scribe: Account<'info, Scribe>,
    #[account(mut, address = config.burn_mint @ ScribeError::WrongMint)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = owner, token::token_program = token_program)]
    pub owner_tokens: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    /// CHECK: the instructions sysvar.
    #[account(address = ix_sysvar::ID)]
    pub instructions: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Give<'info> {
    pub owner: Signer<'info>,
    #[account(mut, has_one = owner @ ScribeError::NotOwner, seeds = [b"scribe", scribe.manifest_sha.as_ref()], bump = scribe.bump)]
    pub scribe: Account<'info, Scribe>,
}

#[account]
#[derive(InitSpace)]
pub struct Market {
    pub fee_bps: u16,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Listing {
    pub scribe: Pubkey,
    pub seller: Pubkey,
    pub price: u64,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct SetMarket<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = admin @ ScribeError::NotAdmin)]
    pub config: Account<'info, Config>,
    #[account(init_if_needed, payer = admin, space = 8 + Market::INIT_SPACE, seeds = [b"market"], bump)]
    pub market: Account<'info, Market>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct List<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(has_one = owner @ ScribeError::NotOwner, seeds = [b"scribe", scribe.manifest_sha.as_ref()], bump = scribe.bump)]
    pub scribe: Account<'info, Scribe>,
    #[account(init_if_needed, payer = owner, space = 8 + Listing::INIT_SPACE, seeds = [b"listing", scribe.key().as_ref()], bump)]
    pub listing: Account<'info, Listing>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Cancel<'info> {
    pub signer: Signer<'info>,
    #[account(seeds = [b"scribe", scribe.manifest_sha.as_ref()], bump = scribe.bump)]
    pub scribe: Account<'info, Scribe>,
    #[account(mut, close = seller, has_one = seller, seeds = [b"listing", scribe.key().as_ref()], bump = listing.bump)]
    pub listing: Account<'info, Listing>,
    /// CHECK: the listing's seller, who gets its rent back (checked by has_one).
    #[account(mut)]
    pub seller: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Buy<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(seeds = [b"market"], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [b"scribe", scribe.manifest_sha.as_ref()], bump = scribe.bump)]
    pub scribe: Account<'info, Scribe>,
    #[account(mut, close = seller, has_one = seller, seeds = [b"listing", scribe.key().as_ref()], bump = listing.bump)]
    pub listing: Account<'info, Listing>,
    /// CHECK: the listing's seller, paid the price (checked by has_one).
    #[account(mut)]
    pub seller: UncheckedAccount<'info>,
    /// CHECK: must be the configured fee receiver.
    #[account(mut, address = config.fee_receiver @ ScribeError::WrongFeeReceiver)]
    pub fee_receiver: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct Listed {
    pub scribe: Pubkey,
    pub seller: Pubkey,
    pub price: u64,
}

#[event]
pub struct Unlisted {
    pub scribe: Pubkey,
}

#[event]
pub struct Sold {
    pub scribe: Pubkey,
    pub from: Pubkey,
    pub to: Pubkey,
    pub price: u64,
    pub fee: u64,
}

#[event]
pub struct Born {
    pub scribe: Pubkey,
    pub owner: Pubkey,
    pub birth_number: u64,
    pub autograph: bool,
}

#[event]
pub struct Verified {
    pub scribe: Pubkey,
    pub burned: u64,
}

#[event]
pub struct Given {
    pub scribe: Pubkey,
    pub from: Pubkey,
    pub to: Pubkey,
}

#[error_code]
pub enum ScribeError {
    #[msg("Only the program's upgrade authority can initialize")]
    NotUpgradeAuthority,
    #[msg("Only the admin can change settings")]
    NotAdmin,
    #[msg("Only the scribe's owner can do this")]
    NotOwner,
    #[msg("The manifest size must be above zero")]
    EmptyManifest,
    #[msg("Birth counter overflow")]
    Overflow,
    #[msg("Fee receiver does not match the settings")]
    WrongFeeReceiver,
    #[msg("Verification opens once the token is set")]
    VerificationClosed,
    #[msg("This scribe is already verified")]
    AlreadyVerified,
    #[msg("The verifier's pass must be the instruction before verify")]
    MissingPass,
    #[msg("The verifier's pass is malformed or for another scribe")]
    BadPass,
    #[msg("The pass was not signed by the verifier")]
    WrongVerifier,
    #[msg("Wrong token mint")]
    WrongMint,
    #[msg("New owner cannot be the default key or the seller")]
    BadOwner,
    #[msg("The sale fee can be at most 10%")]
    FeeTooHigh,
    #[msg("The price must be above zero")]
    BadPrice,
    #[msg("The seller no longer owns this scribe")]
    StaleListing,
    #[msg("The price is higher than you agreed to pay")]
    PriceChanged,
}

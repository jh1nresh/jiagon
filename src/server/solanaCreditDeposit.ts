import { createHash, randomBytes } from "node:crypto";
import bs58 from "bs58";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { solanaCreditConfig } from "@/lib/solanaCredit";
import { solscanClusterParam } from "@/lib/solanaNetwork";

const DRAW_RESTAURANT_DEPOSIT_DISCRIMINATOR = Buffer.from([189, 49, 140, 35, 98, 162, 0, 29]);
const REPAY_RESTAURANT_DEPOSIT_DISCRIMINATOR = Buffer.from([244, 213, 85, 173, 204, 248, 0, 109]);

function configured(value: string | undefined) {
  const trimmed = (value || "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseSecretKey(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error("Secret key JSON must be an array.");
    return Uint8Array.from(parsed.map((item) => {
      const byte = Number(item);
      if (!Number.isInteger(byte) || byte < 0 || byte > 255) throw new Error("Secret key contains an invalid byte.");
      return byte;
    }));
  }

  if (/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) && trimmed.length > 80) {
    const decoded = Buffer.from(trimmed, "base64");
    if (decoded.length === 64) return new Uint8Array(decoded);
  }

  return bs58.decode(trimmed);
}

function keypairFromEnv(name: string) {
  const value = configured(process.env[name]);
  if (!value) return null;
  return Keypair.fromSecretKey(parseSecretKey(value));
}

function requiredPubkey(name: string) {
  const value = configured(process.env[name]);
  if (!value) throw new Error(`${name} is required for devnet credit transactions.`);
  return new PublicKey(value);
}

function pda(seeds: Array<Buffer | Uint8Array>, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

function u64(value: number | bigint) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

function i64(value: number | bigint) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigInt64LE(BigInt(value));
  return buffer;
}

function bytes32(value: string) {
  return createHash("sha256").update(value).digest();
}

export function solanaCreditDepositConfig() {
  const credit = solanaCreditConfig();
  const enabled = process.env.JIAGON_CREDIT_DEVNET_DEMO_ENABLED === "true";
  return {
    ...credit,
    enabled,
    configured: Boolean(
      enabled &&
      configured(process.env.SOLANA_CREDIT_VERIFIER_SECRET_KEY) &&
      configured(process.env.SOLANA_CREDIT_DEMO_OWNER_PUBLIC_KEY) &&
      configured(process.env.SOLANA_CREDIT_DEMO_OWNER_SECRET_KEY) &&
      configured(process.env.SOLANA_CREDIT_DEMO_BORROWER_TOKEN_ACCOUNT) &&
      configured(process.env.SOLANA_CREDIT_PAYMENT_MINT) &&
      configured(process.env.SOLANA_CREDIT_VAULT_TOKEN_ACCOUNT) &&
      configured(process.env.SOLANA_CREDIT_MERCHANT_ESCROW_TOKEN_ACCOUNT)
    ),
  };
}

export async function drawDevnetRestaurantDeposit({
  amountCents,
  merchantName,
}: {
  amountCents: number;
  merchantName: string;
}) {
  const config = solanaCreditDepositConfig();
  if (!config.enabled) throw new Error("JIAGON_CREDIT_DEVNET_DEMO_ENABLED must be true.");
  const verifier = keypairFromEnv("SOLANA_CREDIT_VERIFIER_SECRET_KEY");
  if (!verifier) throw new Error("SOLANA_CREDIT_VERIFIER_SECRET_KEY is required.");

  const connection = new Connection(config.rpcUrl, "confirmed");
  const programId = new PublicKey(config.programId);
  const owner = requiredPubkey("SOLANA_CREDIT_DEMO_OWNER_PUBLIC_KEY");
  const paymentMint = requiredPubkey("SOLANA_CREDIT_PAYMENT_MINT");
  const vaultTokenAccount = requiredPubkey("SOLANA_CREDIT_VAULT_TOKEN_ACCOUNT");
  const merchantEscrowTokenAccount = requiredPubkey("SOLANA_CREDIT_MERCHANT_ESCROW_TOKEN_ACCOUNT");
  const drawId = randomBytes(16);
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;

  const verifierConfig = pda([Buffer.from("jiagon-verifier-config")], programId);
  const creditState = pda([Buffer.from("jiagon-credit-state"), owner.toBuffer()], programId);
  const creditLine = pda([Buffer.from("jiagon-credit-line"), owner.toBuffer()], programId);
  const purposeDraw = pda([Buffer.from("jiagon-purpose-draw"), owner.toBuffer(), drawId], programId);
  const vaultConfig = pda([Buffer.from("jiagon-vault-config")], programId);
  const vaultAuthority = pda([Buffer.from("jiagon-vault-authority")], programId);

  const data = Buffer.concat([
    DRAW_RESTAURANT_DEPOSIT_DISCRIMINATOR,
    drawId,
    bytes32(merchantName || "restaurant"),
    u64(amountCents),
    i64(expiresAt),
  ]);

  const instruction = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: verifier.publicKey, isSigner: true, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: verifierConfig, isSigner: false, isWritable: false },
      { pubkey: creditState, isSigner: false, isWritable: true },
      { pubkey: creditLine, isSigner: false, isWritable: true },
      { pubkey: purposeDraw, isSigner: false, isWritable: true },
      { pubkey: vaultConfig, isSigner: false, isWritable: false },
      { pubkey: vaultAuthority, isSigner: false, isWritable: false },
      { pubkey: paymentMint, isSigner: false, isWritable: false },
      { pubkey: vaultTokenAccount, isSigner: false, isWritable: true },
      { pubkey: merchantEscrowTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(instruction);
  const signature = await sendAndConfirmTransaction(connection, tx, [verifier], { commitment: "confirmed" });

  return {
    status: "drawn",
    cluster: config.cluster,
    signature,
    explorerUrl: `https://solscan.io/tx/${signature}${solscanClusterParam(config.cluster)}`,
    drawId: drawId.toString("hex"),
    purposeDraw: purposeDraw.toBase58(),
    amountCents,
    amountUsd: (amountCents / 100).toFixed(2),
  };
}

export async function repayDevnetRestaurantDeposit({ drawId }: { drawId: string }) {
  const config = solanaCreditDepositConfig();
  if (!config.enabled) throw new Error("JIAGON_CREDIT_DEVNET_DEMO_ENABLED must be true.");
  const ownerKeypair = keypairFromEnv("SOLANA_CREDIT_DEMO_OWNER_SECRET_KEY");
  if (!ownerKeypair) throw new Error("SOLANA_CREDIT_DEMO_OWNER_SECRET_KEY is required.");
  if (!/^[a-fA-F0-9]{32}$/.test(drawId)) throw new Error("A 16-byte draw id is required for repayment.");

  const connection = new Connection(config.rpcUrl, "confirmed");
  const programId = new PublicKey(config.programId);
  const owner = ownerKeypair.publicKey;
  const configuredOwner = requiredPubkey("SOLANA_CREDIT_DEMO_OWNER_PUBLIC_KEY");
  if (!owner.equals(configuredOwner)) {
    throw new Error("SOLANA_CREDIT_DEMO_OWNER_SECRET_KEY must match SOLANA_CREDIT_DEMO_OWNER_PUBLIC_KEY.");
  }
  const paymentMint = requiredPubkey("SOLANA_CREDIT_PAYMENT_MINT");
  const vaultTokenAccount = requiredPubkey("SOLANA_CREDIT_VAULT_TOKEN_ACCOUNT");
  const borrowerTokenAccount = requiredPubkey("SOLANA_CREDIT_DEMO_BORROWER_TOKEN_ACCOUNT");
  const drawIdBytes = Buffer.from(drawId, "hex");

  const creditState = pda([Buffer.from("jiagon-credit-state"), owner.toBuffer()], programId);
  const creditLine = pda([Buffer.from("jiagon-credit-line"), owner.toBuffer()], programId);
  const purposeDraw = pda([Buffer.from("jiagon-purpose-draw"), owner.toBuffer(), drawIdBytes], programId);
  const vaultConfig = pda([Buffer.from("jiagon-vault-config")], programId);

  const instruction = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: creditState, isSigner: false, isWritable: true },
      { pubkey: creditLine, isSigner: false, isWritable: true },
      { pubkey: purposeDraw, isSigner: false, isWritable: true },
      { pubkey: vaultConfig, isSigner: false, isWritable: false },
      { pubkey: paymentMint, isSigner: false, isWritable: false },
      { pubkey: vaultTokenAccount, isSigner: false, isWritable: true },
      { pubkey: borrowerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: REPAY_RESTAURANT_DEPOSIT_DISCRIMINATOR,
  });

  const tx = new Transaction().add(instruction);
  const signature = await sendAndConfirmTransaction(connection, tx, [ownerKeypair], { commitment: "confirmed" });

  return {
    status: "repaid",
    cluster: config.cluster,
    signature,
    explorerUrl: `https://solscan.io/tx/${signature}${solscanClusterParam(config.cluster)}`,
    drawId,
    purposeDraw: purposeDraw.toBase58(),
  };
}

import { createHash, createHmac, randomBytes } from "node:crypto";
import { Pool } from "pg";

export type ReceiptPersistenceResult =
  | {
      configured: false;
      persisted: false;
      reason: string;
    }
  | {
      configured: true;
      persisted: true;
      receiptId: string;
      reviewId: string;
    }
  | {
      configured: true;
      persisted: false;
      error: string;
      reason?: string;
    }
  | {
      configured: boolean;
      persisted: false;
      reason: string;
    };

export type ReceiptReviewRecord = {
  receiptId: string;
  reviewId: string;
  status: string;
  mode?: string | null;
  sourceChain: string;
  sourceTx: string;
  sourceBlock?: number | null;
  logIndex: number;
  ownerSafe?: string | null;
  wallet?: string | null;
  placeProvider?: string | null;
  googlePlaceId?: string | null;
  merchant: string;
  branch: string;
  rating: number;
  tags: string[];
  reviewAttributes?: Record<string, unknown>;
  reviewText: string;
  amount?: string | null;
  amountUsd?: string | null;
  token?: string | null;
  proofLevel: string;
  sourceReceiptHash: string;
  dataHash: string;
  requestedDataHash?: string | null;
  dataMatchesRequest?: boolean | null;
  storageUri: string;
  requestedStorageUri?: string | null;
  credentialChain: string;
  chainId: number;
  credentialId: string;
  credentialTx?: string | null;
  explorerUrl?: string | null;
  registryAddress?: string | null;
  minter?: string | null;
  payload: unknown;
};

export type PublicReceiptReview = {
  receiptId: string;
  reviewId: string;
  status: string;
  mode: string | null;
  sourceChain: string;
  logIndex: number;
  placeProvider: string | null;
  googlePlaceId: string | null;
  merchant: string;
  branch: string;
  rating: number;
  tags: string[];
  reviewAttributes: Record<string, unknown>;
  reviewText: string;
  token: string | null;
  proofLevel: string;
  publicProofId: string;
  dataHash: string;
  dataMatchesRequest: boolean | null;
  storageUri: string;
  credentialChain: string;
  chainId: number;
  credentialId: string;
  credentialTx: string | null;
  explorerUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentMerchantSignal = {
  id: string;
  placeProvider: string | null;
  googlePlaceId: string | null;
  name: string;
  branch: string;
  category: string;
  verifiedVisits: number;
  verifiedWallets: number;
  averageRating: number;
  totalVerifiedSpendUsd: string | null;
  lastVerifiedVisit: string;
  latestReview: string;
  latestAttributes: Record<string, unknown>;
};

export type PrivateAccountState = {
  receiptSync?: unknown;
  solayerProofs?: unknown[];
  publishedReviews?: unknown[];
  reviewedReceiptIds?: string[];
  receiptCredentials?: Record<string, unknown>;
  merchantReceipts?: unknown[];
};

export type MerchantIssuedReceipt = {
  id: string;
  merchantId: string;
  merchantName: string;
  location: string | null;
  receiptNumber: string;
  amountCents: number;
  amountUsd: string;
  currency: string;
  category: string;
  purpose: string;
  issuedBy: string | null;
  memo: string | null;
  status: "issued" | "claimed" | "void";
  receiptHash: string;
  signature: string | null;
  signatureAlgorithm: "hmac-sha256" | "local-demo";
  claimTokenHash: string;
  claimUrl: string;
  issuedAt: string;
  claimedAt: string | null;
  claimedBy: string | null;
  mintStatus?: "none" | "prepared" | "minted";
  credentialId?: string | null;
  credentialChain?: string | null;
  credentialStandard?: string | null;
  credentialTx?: string | null;
  solanaOwner?: string | null;
  dataHash?: string | null;
  storageUri?: string | null;
  explorerUrl?: string | null;
  assetExplorerUrl?: string | null;
  creditUnlockedCents?: number;
};

export type MerchantReceiptIssueInput = {
  merchantId?: string | null;
  merchantName: string;
  location?: string | null;
  receiptNumber?: string | null;
  amountCents: number;
  currency?: string | null;
  category?: string | null;
  purpose?: string | null;
  issuedBy?: string | null;
  memo?: string | null;
  origin: string;
};

export type MerchantReceiptIssueResult = {
  configured: boolean;
  persisted: boolean;
  receipt: MerchantIssuedReceipt;
  claimToken: string;
  error?: string;
};

export type MerchantReceiptClaimResult =
  | {
      configured: boolean;
      claimed: true;
      receipt: MerchantIssuedReceipt;
    }
  | {
      configured: boolean;
      claimed: false;
      receipt?: MerchantIssuedReceipt | null;
      error: string;
    };

export type MerchantReceiptCreditProfile = {
  configured: boolean;
  unlockedCreditCents: number;
  mintedReceiptCount: number;
  receiptIds: string[];
  error?: string;
};

export type MerchantReceiptCreditReservation = {
  receiptId: string;
  amountCents: number;
};

export type AccountStateRecord = {
  configured: boolean;
  state: PrivateAccountState | null;
  updatedAt?: string;
  error?: string;
};

type ReceiptStoreGlobal = typeof globalThis & {
  jiagonReceiptPool?: Pool;
  jiagonReceiptSchemaReady?: Promise<void>;
  jiagonAccountStateSchemaReady?: Promise<void>;
  jiagonMerchantReceiptSchemaReady?: Promise<void>;
  jiagonMerchantReceiptMemory?: Map<string, MerchantIssuedReceipt>;
};

function databaseUrl() {
  return (process.env.DATABASE_URL || "").trim();
}

function publicProofId(sourceReceiptHash: string) {
  return createHash("sha256").update(sourceReceiptHash).digest("hex").slice(0, 16);
}

function getPool() {
  const url = databaseUrl();
  if (!url) return null;

  const globalStore = globalThis as ReceiptStoreGlobal;
  if (!globalStore.jiagonReceiptPool) {
    const wantsSsl =
      process.env.DATABASE_SSL === "true" ||
      url.includes("sslmode=require");
    const allowInsecureSsl =
      process.env.DATABASE_SSL_INSECURE === "true" ||
      process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "false" ||
      url.includes("sslmode=no-verify");
    const enableSsl = wantsSsl || allowInsecureSsl;
    globalStore.jiagonReceiptPool = new Pool({
      connectionString: url,
      max: 5,
      ssl: enableSsl ? { rejectUnauthorized: !allowInsecureSsl } : undefined,
    });
  }

  return globalStore.jiagonReceiptPool;
}

async function ensureSchema(pool: Pool) {
  const globalStore = globalThis as ReceiptStoreGlobal;
  if (!globalStore.jiagonReceiptSchemaReady) {
    globalStore.jiagonReceiptSchemaReady = pool.query(`
      create table if not exists jiagon_receipt_reviews (
        id bigserial primary key,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        receipt_id text not null,
        review_id text not null,
        status text not null,
        mode text,
        source_chain text not null default 'solana',
        source_tx text not null,
        source_block integer,
        log_index integer not null,
        owner_safe text,
        wallet text,
        place_provider text,
        google_place_id text,
        merchant text not null,
        branch text not null,
        rating integer not null check (rating between 1 and 5),
        tags jsonb not null default '[]'::jsonb,
        review_attributes jsonb not null default '{}'::jsonb,
        review_text text not null default '',
        amount text,
        amount_usd text,
        token text,
        proof_level text not null,
        source_receipt_hash text not null unique,
        data_hash text not null,
        requested_data_hash text,
        data_matches_request boolean,
        storage_uri text not null,
        requested_storage_uri text,
        credential_chain text not null,
        chain_id integer not null,
        credential_id text not null,
        credential_tx text,
        explorer_url text,
        registry_address text,
        minter text,
        payload jsonb not null
      );

      alter table jiagon_receipt_reviews
        add column if not exists review_attributes jsonb not null default '{}'::jsonb;

      alter table jiagon_receipt_reviews
        add column if not exists place_provider text,
        add column if not exists google_place_id text;

      alter table jiagon_receipt_reviews
        add column if not exists amount_usd text;

      create index if not exists jiagon_receipt_reviews_google_place_id_idx
        on jiagon_receipt_reviews (google_place_id)
        where google_place_id is not null;
    `).then(() => undefined);
  }

  return globalStore.jiagonReceiptSchemaReady;
}

async function ensureAccountStateSchema(pool: Pool) {
  const globalStore = globalThis as ReceiptStoreGlobal;
  if (!globalStore.jiagonAccountStateSchemaReady) {
    globalStore.jiagonAccountStateSchemaReady = pool.query(`
      create table if not exists jiagon_account_states (
        id bigserial primary key,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        privy_user_id text not null unique,
        session_id text,
        wallet text,
        user_label text,
        state jsonb not null default '{}'::jsonb
      );

      create index if not exists jiagon_account_states_wallet_idx
        on jiagon_account_states (wallet)
        where wallet is not null;
    `).then(() => undefined);
  }

  return globalStore.jiagonAccountStateSchemaReady;
}

async function ensureMerchantReceiptSchema(pool: Pool) {
  const globalStore = globalThis as ReceiptStoreGlobal;
  if (!globalStore.jiagonMerchantReceiptSchemaReady) {
    globalStore.jiagonMerchantReceiptSchemaReady = pool.query(`
      create table if not exists jiagon_merchant_receipts (
        id text primary key,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        merchant_id text not null,
        merchant_name text not null,
        location text,
        receipt_number text not null,
        amount_cents integer not null check (amount_cents > 0),
        amount_usd text not null,
        currency text not null,
        category text not null,
        purpose text not null,
        issued_by text,
        memo text,
        status text not null,
        receipt_hash text not null unique,
        signature text,
        signature_algorithm text not null,
        claim_token_hash text not null unique,
        claim_url text not null,
        issued_at timestamptz not null,
        claimed_at timestamptz,
        claimed_by text,
        mint_status text not null default 'none',
        credential_id text,
        credential_chain text,
        credential_standard text,
        credential_tx text,
        solana_owner text,
        data_hash text,
        storage_uri text,
        explorer_url text,
        asset_explorer_url text,
        credit_unlocked_cents integer not null default 0,
        payload jsonb not null
      );

      alter table jiagon_merchant_receipts
        add column if not exists mint_status text not null default 'none',
        add column if not exists credential_id text,
        add column if not exists credential_chain text,
        add column if not exists credential_standard text,
        add column if not exists credential_tx text,
        add column if not exists solana_owner text,
        add column if not exists data_hash text,
        add column if not exists storage_uri text,
        add column if not exists explorer_url text,
        add column if not exists asset_explorer_url text,
        add column if not exists credit_unlocked_cents integer not null default 0;

      create index if not exists jiagon_merchant_receipts_merchant_idx
        on jiagon_merchant_receipts (merchant_id, issued_at desc);

      create index if not exists jiagon_merchant_receipts_status_idx
        on jiagon_merchant_receipts (status, issued_at desc);

      create index if not exists jiagon_merchant_receipts_claimed_credit_idx
        on jiagon_merchant_receipts (claimed_by, mint_status)
        where claimed_by is not null;
    `)
      .then(() => undefined)
      .catch((error) => {
        globalStore.jiagonMerchantReceiptSchemaReady = undefined;
        throw error;
      });
  }

  return globalStore.jiagonMerchantReceiptSchemaReady;
}

function merchantReceiptMemory() {
  const globalStore = globalThis as ReceiptStoreGlobal;
  if (!globalStore.jiagonMerchantReceiptMemory) {
    globalStore.jiagonMerchantReceiptMemory = new Map();
  }
  return globalStore.jiagonMerchantReceiptMemory;
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return slug || "merchant";
}

function receiptId(prefix: string) {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

function receiptToken() {
  return `jgr_${randomBytes(24).toString("base64url")}`;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function formatUsd(cents: number) {
  return (cents / 100).toFixed(2);
}

function merchantReceiptSigningSecret() {
  return (process.env.JIAGON_MERCHANT_RECEIPT_SIGNING_SECRET || "").trim();
}

function merchantReceiptPayload(receipt: Omit<MerchantIssuedReceipt, "signature" | "signatureAlgorithm" | "claimTokenHash" | "claimUrl">) {
  return {
    id: receipt.id,
    merchantId: receipt.merchantId,
    merchantName: receipt.merchantName,
    location: receipt.location,
    receiptNumber: receipt.receiptNumber,
    amountCents: receipt.amountCents,
    amountUsd: receipt.amountUsd,
    currency: receipt.currency,
    category: receipt.category,
    purpose: receipt.purpose,
    issuedBy: receipt.issuedBy,
    memo: receipt.memo,
    status: receipt.status,
    receiptHash: receipt.receiptHash,
    issuedAt: receipt.issuedAt,
  };
}

function signMerchantReceipt(payload: Record<string, unknown>) {
  const secret = merchantReceiptSigningSecret();
  if (!secret) return null;
  return createHmac("sha256", secret).update(JSON.stringify(payload)).digest("hex");
}

export async function createMerchantIssuedReceipt(input: MerchantReceiptIssueInput): Promise<MerchantReceiptIssueResult> {
  const merchantId = slugify(input.merchantId || input.merchantName);
  const now = new Date().toISOString();
  const token = receiptToken();
  const tokenHash = sha256(token);
  const id = receiptId(`mrc-${merchantId}`);
  const receiptNumber = input.receiptNumber?.trim() || id;
  const amountUsd = formatUsd(input.amountCents);
  const basePayload = {
    id,
    merchantId,
    merchantName: input.merchantName.trim(),
    location: input.location?.trim() || null,
    receiptNumber,
    amountCents: input.amountCents,
    amountUsd,
    currency: (input.currency?.trim() || "USD").toUpperCase(),
    category: input.category?.trim() || "Dining",
    purpose: input.purpose?.trim() || "merchant_receipt",
    issuedBy: input.issuedBy?.trim() || null,
    memo: input.memo?.trim() || null,
    status: "issued" as const,
    issuedAt: now,
    claimedAt: null,
    claimedBy: null,
  };
  const receiptHash = sha256(JSON.stringify(basePayload));
  const claimUrl = new URL(`/claim/${token}`, input.origin).toString();
  const unsignedReceipt = {
    ...basePayload,
    receiptHash,
  };
  const payload = merchantReceiptPayload(unsignedReceipt);
  const signature = signMerchantReceipt(payload);
  const receipt: MerchantIssuedReceipt = {
    ...unsignedReceipt,
    signature,
    signatureAlgorithm: signature ? "hmac-sha256" : "local-demo",
    claimTokenHash: tokenHash,
    claimUrl,
  };

  const pool = getPool();
  if (!pool) {
    merchantReceiptMemory().set(tokenHash, receipt);
    return {
      configured: false,
      persisted: false,
      receipt,
      claimToken: token,
    };
  }

  try {
    await ensureMerchantReceiptSchema(pool);
    await pool.query(
      `
        insert into jiagon_merchant_receipts (
          id,
          merchant_id,
          merchant_name,
          location,
          receipt_number,
          amount_cents,
          amount_usd,
          currency,
          category,
          purpose,
          issued_by,
          memo,
          status,
          receipt_hash,
          signature,
          signature_algorithm,
          claim_token_hash,
          claim_url,
          issued_at,
          claimed_at,
          claimed_by,
          payload
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20, $21, $22::jsonb
        )
      `,
      [
        receipt.id,
        receipt.merchantId,
        receipt.merchantName,
        receipt.location,
        receipt.receiptNumber,
        receipt.amountCents,
        receipt.amountUsd,
        receipt.currency,
        receipt.category,
        receipt.purpose,
        receipt.issuedBy,
        receipt.memo,
        receipt.status,
        receipt.receiptHash,
        receipt.signature,
        receipt.signatureAlgorithm,
        receipt.claimTokenHash,
        receipt.claimUrl,
        receipt.issuedAt,
        receipt.claimedAt,
        receipt.claimedBy,
        JSON.stringify(payload),
      ],
    );

    return {
      configured: true,
      persisted: true,
      receipt,
      claimToken: token,
    };
  } catch {
    return {
      configured: true,
      persisted: false,
      receipt,
      claimToken: token,
      error: "Merchant receipt persistence failed.",
    };
  }
}

function mapMerchantReceiptRow(row: Record<string, unknown>): MerchantIssuedReceipt {
  const issuedAt = row.issued_at instanceof Date ? row.issued_at.toISOString() : String(row.issued_at);
  const claimedAt = row.claimed_at instanceof Date ? row.claimed_at.toISOString() : row.claimed_at ? String(row.claimed_at) : null;

  return {
    id: String(row.id),
    merchantId: String(row.merchant_id),
    merchantName: String(row.merchant_name),
    location: typeof row.location === "string" ? row.location : null,
    receiptNumber: String(row.receipt_number),
    amountCents: Number(row.amount_cents),
    amountUsd: String(row.amount_usd),
    currency: String(row.currency),
    category: String(row.category),
    purpose: String(row.purpose),
    issuedBy: typeof row.issued_by === "string" ? row.issued_by : null,
    memo: typeof row.memo === "string" ? row.memo : null,
    status: row.status === "claimed" || row.status === "void" ? row.status : "issued",
    receiptHash: String(row.receipt_hash),
    signature: typeof row.signature === "string" ? row.signature : null,
    signatureAlgorithm: row.signature_algorithm === "hmac-sha256" ? "hmac-sha256" : "local-demo",
    claimTokenHash: String(row.claim_token_hash),
    claimUrl: String(row.claim_url),
    issuedAt,
    claimedAt,
    claimedBy: typeof row.claimed_by === "string" ? row.claimed_by : null,
    mintStatus: row.mint_status === "prepared" || row.mint_status === "minted" ? row.mint_status : "none",
    credentialId: typeof row.credential_id === "string" ? row.credential_id : null,
    credentialChain: typeof row.credential_chain === "string" ? row.credential_chain : null,
    credentialStandard: typeof row.credential_standard === "string" ? row.credential_standard : null,
    credentialTx: typeof row.credential_tx === "string" ? row.credential_tx : null,
    solanaOwner: typeof row.solana_owner === "string" ? row.solana_owner : null,
    dataHash: typeof row.data_hash === "string" ? row.data_hash : null,
    storageUri: typeof row.storage_uri === "string" ? row.storage_uri : null,
    explorerUrl: typeof row.explorer_url === "string" ? row.explorer_url : null,
    assetExplorerUrl: typeof row.asset_explorer_url === "string" ? row.asset_explorer_url : null,
    creditUnlockedCents: Number.isFinite(Number(row.credit_unlocked_cents)) ? Number(row.credit_unlocked_cents) : 0,
  };
}

export function publicMerchantReceipt(receipt: MerchantIssuedReceipt) {
  return {
    id: receipt.id,
    merchantId: receipt.merchantId,
    merchantName: receipt.merchantName,
    location: receipt.location,
    receiptNumber: receipt.receiptNumber,
    amountCents: receipt.amountCents,
    amountUsd: receipt.amountUsd,
    currency: receipt.currency,
    category: receipt.category,
    purpose: receipt.purpose,
    issuedBy: receipt.issuedBy,
    memo: receipt.memo,
    status: receipt.status,
    receiptHash: receipt.receiptHash,
    signature: receipt.signature,
    signatureAlgorithm: receipt.signatureAlgorithm,
    claimUrl: receipt.claimUrl,
    issuedAt: receipt.issuedAt,
    claimedAt: receipt.claimedAt,
    mintStatus: receipt.mintStatus || "none",
    credentialId: receipt.credentialId || null,
    credentialChain: receipt.credentialChain || null,
    credentialStandard: receipt.credentialStandard || null,
    credentialTx: receipt.credentialTx || null,
    solanaOwner: receipt.solanaOwner || null,
    dataHash: receipt.dataHash || null,
    storageUri: receipt.storageUri || null,
    explorerUrl: receipt.explorerUrl || null,
    assetExplorerUrl: receipt.assetExplorerUrl || null,
    creditUnlockedCents: receipt.creditUnlockedCents || 0,
  };
}

export async function getMerchantIssuedReceiptByToken(claimToken: string): Promise<{
  configured: boolean;
  receipt: MerchantIssuedReceipt | null;
  error?: string;
}> {
  const tokenHash = sha256(claimToken);
  const pool = getPool();

  if (!pool) {
    return {
      configured: false,
      receipt: merchantReceiptMemory().get(tokenHash) || null,
    };
  }

  try {
    await ensureMerchantReceiptSchema(pool);
    const result = await pool.query(
      `
        select
          id,
          merchant_id,
          merchant_name,
          location,
          receipt_number,
          amount_cents,
          amount_usd,
          currency,
          category,
          purpose,
          issued_by,
          memo,
          status,
          receipt_hash,
          signature,
          signature_algorithm,
          claim_token_hash,
          claim_url,
          issued_at,
          claimed_at,
          claimed_by,
          mint_status,
          credential_id,
          credential_chain,
          credential_standard,
          credential_tx,
          solana_owner,
          data_hash,
          storage_uri,
          explorer_url,
          asset_explorer_url,
          credit_unlocked_cents
        from jiagon_merchant_receipts
        where claim_token_hash = $1
        limit 1
      `,
      [tokenHash],
    );

    const row = result.rows[0];
    return {
      configured: true,
      receipt: row ? mapMerchantReceiptRow(row) : null,
    };
  } catch {
    return {
      configured: true,
      receipt: null,
      error: "Merchant receipt query failed.",
    };
  }
}

export async function claimMerchantIssuedReceipt(input: {
  claimToken: string;
  privyUserId: string;
}): Promise<MerchantReceiptClaimResult> {
  const tokenHash = sha256(input.claimToken);
  const pool = getPool();

  if (!pool) {
    const memory = merchantReceiptMemory();
    const receipt = memory.get(tokenHash);
    if (!receipt) {
      return { configured: false, claimed: false, receipt: null, error: "Receipt claim token was not found." };
    }
    if (receipt.status !== "issued") {
      return { configured: false, claimed: false, receipt, error: "Receipt has already been claimed." };
    }
    const claimed: MerchantIssuedReceipt = {
      ...receipt,
      status: "claimed",
      claimedAt: new Date().toISOString(),
      claimedBy: input.privyUserId,
    };
    memory.set(tokenHash, claimed);
    return { configured: false, claimed: true, receipt: claimed };
  }

  try {
    await ensureMerchantReceiptSchema(pool);
    const result = await pool.query(
      `
        update jiagon_merchant_receipts
        set
          updated_at = now(),
          status = 'claimed',
          claimed_at = now(),
          claimed_by = $2
        where claim_token_hash = $1
          and status = 'issued'
        returning
          id,
          merchant_id,
          merchant_name,
          location,
          receipt_number,
          amount_cents,
          amount_usd,
          currency,
          category,
          purpose,
          issued_by,
          memo,
          status,
          receipt_hash,
          signature,
          signature_algorithm,
          claim_token_hash,
          claim_url,
          issued_at,
          claimed_at,
          claimed_by,
          mint_status,
          credential_id,
          credential_chain,
          credential_standard,
          credential_tx,
          solana_owner,
          data_hash,
          storage_uri,
          explorer_url,
          asset_explorer_url,
          credit_unlocked_cents
      `,
      [tokenHash, input.privyUserId],
    );

    const claimedRow = result.rows[0];
    if (claimedRow) {
      return { configured: true, claimed: true, receipt: mapMerchantReceiptRow(claimedRow) };
    }

    const existing = await getMerchantIssuedReceiptByToken(input.claimToken);
    if (existing.error) {
      return {
        configured: true,
        claimed: false,
        receipt: null,
        error: "Merchant receipt claim failed.",
      };
    }
    return {
      configured: true,
      claimed: false,
      receipt: existing.receipt,
      error: existing.receipt ? "Receipt has already been claimed." : "Receipt claim token was not found.",
    };
  } catch {
    return {
      configured: true,
      claimed: false,
      receipt: null,
      error: "Merchant receipt claim failed.",
    };
  }
}

function unlockedCreditForMint(input: {
  mintStatus: "prepared" | "minted";
  creditUnlockedCents?: number;
}) {
  return input.mintStatus === "minted"
    ? Math.max(0, Math.min(2_500, Math.trunc(input.creditUnlockedCents || 0)))
    : 0;
}

export async function recordMerchantReceiptCredential(input: {
  receiptId: string;
  privyUserId: string;
  mintStatus: "prepared" | "minted";
  credentialId?: string | null;
  credentialChain?: string | null;
  credentialStandard?: string | null;
  credentialTx?: string | null;
  solanaOwner?: string | null;
  dataHash?: string | null;
  storageUri?: string | null;
  explorerUrl?: string | null;
  assetExplorerUrl?: string | null;
  creditUnlockedCents?: number;
}): Promise<{
  configured: boolean;
  updated: boolean;
  error?: string;
}> {
  const pool = getPool();
  const creditUnlockedCents = unlockedCreditForMint(input);
  if (!pool) {
    const memory = merchantReceiptMemory();
    for (const [tokenHash, receipt] of memory.entries()) {
      if (
        receipt.id === input.receiptId &&
        receipt.claimedBy === input.privyUserId &&
        receipt.status === "claimed"
      ) {
        memory.set(tokenHash, {
          ...receipt,
          mintStatus: input.mintStatus,
          credentialId: input.credentialId || null,
          credentialChain: input.credentialChain || null,
          credentialStandard: input.credentialStandard || null,
          credentialTx: input.credentialTx || null,
          solanaOwner: input.solanaOwner || null,
          dataHash: input.dataHash || null,
          storageUri: input.storageUri || null,
          explorerUrl: input.explorerUrl || null,
          assetExplorerUrl: input.assetExplorerUrl || null,
          creditUnlockedCents,
        });
        return { configured: false, updated: true };
      }
    }
    return { configured: false, updated: false };
  }

  try {
    await ensureMerchantReceiptSchema(pool);
    const result = await pool.query(
      `
        update jiagon_merchant_receipts
        set
          updated_at = now(),
          mint_status = $3,
          credential_id = $4,
          credential_chain = $5,
          credential_standard = $6,
          credential_tx = $7,
          solana_owner = $8,
          data_hash = $9,
          storage_uri = $10,
          explorer_url = $11,
          asset_explorer_url = $12,
          credit_unlocked_cents = $13
        where id = $1
          and claimed_by = $2
          and status = 'claimed'
      `,
      [
        input.receiptId,
        input.privyUserId,
        input.mintStatus,
        input.credentialId || null,
        input.credentialChain || null,
        input.credentialStandard || null,
        input.credentialTx || null,
        input.solanaOwner || null,
        input.dataHash || null,
        input.storageUri || null,
        input.explorerUrl || null,
        input.assetExplorerUrl || null,
        creditUnlockedCents,
      ],
    );

    return {
      configured: true,
      updated: (result.rowCount || 0) > 0,
    };
  } catch {
    return {
      configured: true,
      updated: false,
      error: "Merchant receipt credential index update failed.",
    };
  }
}

export async function reserveMerchantReceiptCreditAtomic(privyUserId: string, amountCents: number): Promise<{
  configured: boolean;
  reserved: boolean;
  unlockedCreditCents: number;
  mintedReceiptCount: number;
  receiptIds: string[];
  reservations: MerchantReceiptCreditReservation[];
  creditProfile?: MerchantReceiptCreditProfile;
  error?: string;
}> {
  const pool = getPool();
  if (!pool) {
    return {
      configured: false,
      reserved: false,
      unlockedCreditCents: 0,
      mintedReceiptCount: 0,
      receiptIds: [],
      reservations: [],
    };
  }

  const requested = Math.max(0, Math.trunc(amountCents));
  if (requested <= 0) {
    return {
      configured: true,
      reserved: false,
      unlockedCreditCents: 0,
      mintedReceiptCount: 0,
      receiptIds: [],
      reservations: [],
      error: "Credit reservation amount must be positive.",
    };
  }

  const client = await pool.connect();
  try {
    await ensureMerchantReceiptSchema(pool);
    await client.query("begin");
    const result = await client.query(
      `
        select
          id,
          credit_unlocked_cents
        from jiagon_merchant_receipts
        where claimed_by = $1
          and status = 'claimed'
          and mint_status = 'minted'
          and credential_id is not null
          and coalesce(credit_unlocked_cents, 0) > 0
        order by updated_at desc
        limit 25
        for update
      `,
      [privyUserId],
    );
    const receiptIds = result.rows.map((row) => String(row.id));
    const total = result.rows.reduce((sum, row) => sum + Math.max(0, Number(row.credit_unlocked_cents) || 0), 0);
    const unlockedCreditCents = Math.min(2_500, total);
    if (requested > unlockedCreditCents) {
      await client.query("rollback");
      return {
        configured: true,
        reserved: false,
        unlockedCreditCents,
        mintedReceiptCount: receiptIds.length,
        receiptIds,
        reservations: [],
      };
    }

    let remaining = requested;
    const reservations: MerchantReceiptCreditReservation[] = [];
    for (const row of result.rows) {
      if (remaining <= 0) break;
      const receiptId = String(row.id);
      const available = Math.max(0, Number(row.credit_unlocked_cents) || 0);
      const debit = Math.min(available, remaining);
      if (debit <= 0) continue;
      await client.query(
        `
          update jiagon_merchant_receipts
          set
            updated_at = now(),
            credit_unlocked_cents = greatest(0, credit_unlocked_cents - $2)
          where id = $1
        `,
        [receiptId, debit],
      );
      reservations.push({ receiptId, amountCents: debit });
      remaining -= debit;
    }

    if (remaining > 0) {
      await client.query("rollback");
      return {
        configured: true,
        reserved: false,
        unlockedCreditCents,
        mintedReceiptCount: receiptIds.length,
        receiptIds,
        reservations: [],
      };
    }

    await client.query("commit");
    const creditProfile = await getMerchantReceiptCreditProfile(privyUserId);
    return {
      configured: true,
      reserved: true,
      unlockedCreditCents,
      mintedReceiptCount: receiptIds.length,
      receiptIds,
      reservations,
      creditProfile,
    };
  } catch {
    try {
      await client.query("rollback");
    } catch {
      // Ignore rollback errors after a failed reservation attempt.
    }
    return {
      configured: true,
      reserved: false,
      unlockedCreditCents: 0,
      mintedReceiptCount: 0,
      receiptIds: [],
      reservations: [],
      error: "Merchant receipt credit reservation failed.",
    };
  } finally {
    client.release();
  }
}

export async function releaseMerchantReceiptCreditReservation(
  privyUserId: string,
  reservations: MerchantReceiptCreditReservation[],
): Promise<{ configured: boolean; released: boolean; error?: string }> {
  const pool = getPool();
  if (!pool) return { configured: false, released: false };
  const cleanReservations = reservations
    .map((reservation) => ({
      receiptId: reservation.receiptId,
      amountCents: Math.max(0, Math.trunc(reservation.amountCents)),
    }))
    .filter((reservation) => reservation.receiptId && reservation.amountCents > 0);
  if (cleanReservations.length === 0) return { configured: true, released: true };

  const client = await pool.connect();
  try {
    await ensureMerchantReceiptSchema(pool);
    await client.query("begin");
    for (const reservation of cleanReservations) {
      await client.query(
        `
          update jiagon_merchant_receipts
          set
            updated_at = now(),
            credit_unlocked_cents = least(2500, credit_unlocked_cents + $3)
          where id = $1
            and claimed_by = $2
            and status = 'claimed'
            and mint_status = 'minted'
            and credential_id is not null
        `,
        [reservation.receiptId, privyUserId, reservation.amountCents],
      );
    }
    await client.query("commit");
    return { configured: true, released: true };
  } catch {
    try {
      await client.query("rollback");
    } catch {
      // Ignore rollback errors after a failed release attempt.
    }
    return {
      configured: true,
      released: false,
      error: "Merchant receipt credit reservation release failed.",
    };
  } finally {
    client.release();
  }
}

export async function getMerchantReceiptCreditProfile(privyUserId: string): Promise<MerchantReceiptCreditProfile> {
  const pool = getPool();
  if (!pool) {
    return {
      configured: false,
      unlockedCreditCents: 0,
      mintedReceiptCount: 0,
      receiptIds: [],
    };
  }

  try {
    await ensureMerchantReceiptSchema(pool);
    const result = await pool.query(
      `
        select
          id,
          credit_unlocked_cents
        from jiagon_merchant_receipts
        where claimed_by = $1
          and status = 'claimed'
          and mint_status = 'minted'
          and credential_id is not null
          and coalesce(credit_unlocked_cents, 0) > 0
        order by updated_at desc
        limit 25
      `,
      [privyUserId],
    );
    const receiptIds = result.rows.map((row) => String(row.id));
    const total = result.rows.reduce((sum, row) => sum + Math.max(0, Number(row.credit_unlocked_cents) || 0), 0);

    return {
      configured: true,
      unlockedCreditCents: Math.min(2_500, total),
      mintedReceiptCount: receiptIds.length,
      receiptIds,
    };
  } catch {
    return {
      configured: true,
      unlockedCreditCents: 0,
      mintedReceiptCount: 0,
      receiptIds: [],
      error: "Merchant receipt credit profile query failed.",
    };
  }
}

function cleanStringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0).slice(0, 250);
}

function cleanPrivateAccountState(value: unknown): PrivateAccountState {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const receiptCredentials =
    input.receiptCredentials && typeof input.receiptCredentials === "object" && !Array.isArray(input.receiptCredentials)
      ? (input.receiptCredentials as Record<string, unknown>)
      : {};

  return {
    receiptSync: input.receiptSync && typeof input.receiptSync === "object" ? input.receiptSync : undefined,
    solayerProofs: Array.isArray(input.solayerProofs) ? input.solayerProofs.slice(0, 25) : [],
    publishedReviews: Array.isArray(input.publishedReviews) ? input.publishedReviews.slice(0, 250) : [],
    reviewedReceiptIds: cleanStringList(input.reviewedReceiptIds),
    receiptCredentials,
    merchantReceipts: Array.isArray(input.merchantReceipts) ? input.merchantReceipts.slice(0, 250) : [],
  };
}

function mergePrivateAccountState(current: unknown, next: unknown): PrivateAccountState {
  const currentState = cleanPrivateAccountState(current);
  const nextState = cleanPrivateAccountState(next);
  const currentCredentials =
    currentState.receiptCredentials && typeof currentState.receiptCredentials === "object"
      ? currentState.receiptCredentials
      : {};
  const nextCredentials =
    nextState.receiptCredentials && typeof nextState.receiptCredentials === "object"
      ? nextState.receiptCredentials
      : {};

  const reviewsById = new Map<string, unknown>();
  for (const review of currentState.publishedReviews || []) {
    if (review && typeof review === "object" && "id" in review && typeof review.id === "string") {
      reviewsById.set(review.id, review);
    }
  }
  for (const review of nextState.publishedReviews || []) {
    if (review && typeof review === "object" && "id" in review && typeof review.id === "string") {
      reviewsById.set(review.id, review);
    }
  }

  const merchantReceiptsById = new Map<string, unknown>();
  for (const receipt of currentState.merchantReceipts || []) {
    if (receipt && typeof receipt === "object" && "id" in receipt && typeof receipt.id === "string") {
      merchantReceiptsById.set(receipt.id, receipt);
    }
  }
  for (const receipt of nextState.merchantReceipts || []) {
    if (receipt && typeof receipt === "object" && "id" in receipt && typeof receipt.id === "string") {
      merchantReceiptsById.set(receipt.id, receipt);
    }
  }

  return {
    receiptSync: nextState.receiptSync || currentState.receiptSync,
    solayerProofs: Array.from(
      new Map(
        [...(currentState.solayerProofs || []), ...(nextState.solayerProofs || [])]
          .filter((proof): proof is Record<string, unknown> => Boolean(proof && typeof proof === "object" && !Array.isArray(proof)))
          .map((proof) => [typeof proof.id === "string" ? proof.id : JSON.stringify(proof).slice(0, 120), proof]),
      ).values(),
    ).slice(0, 25),
    publishedReviews: Array.from(reviewsById.values()).slice(0, 250),
    reviewedReceiptIds: Array.from(
      new Set([...(currentState.reviewedReceiptIds || []), ...(nextState.reviewedReceiptIds || [])]),
    ),
    receiptCredentials: {
      ...currentCredentials,
      ...nextCredentials,
    },
    merchantReceipts: Array.from(merchantReceiptsById.values()).slice(0, 250),
  };
}

export async function getPrivateAccountState(privyUserId: string): Promise<AccountStateRecord> {
  const pool = getPool();
  if (!pool) return { configured: false, state: null };

  try {
    await ensureAccountStateSchema(pool);
    const result = await pool.query(
      `
        select state, updated_at
        from jiagon_account_states
        where privy_user_id = $1
        limit 1
      `,
      [privyUserId],
    );

    const row = result.rows[0];
    if (!row) return { configured: true, state: null };

    return {
      configured: true,
      state: cleanPrivateAccountState(row.state),
      updatedAt: row.updated_at.toISOString(),
    };
  } catch {
    return {
      configured: true,
      state: null,
      error: "Private account state query failed.",
    };
  }
}

export async function savePrivateAccountState(input: {
  privyUserId: string;
  sessionId?: string;
  wallet?: string | null;
  userLabel?: string | null;
  state: unknown;
  ifUnmodifiedSince?: string | null;
}): Promise<AccountStateRecord> {
  const pool = getPool();
  if (!pool) return { configured: false, state: null };

  try {
    await ensureAccountStateSchema(pool);
    const client = await pool.connect();
    try {
      await client.query("begin");
      const existing = await client.query(
        `
          select state, updated_at
          from jiagon_account_states
          where privy_user_id = $1
          limit 1
          for update
        `,
        [input.privyUserId],
      );
      const existingRow = existing.rows[0];
      const existingUpdatedAt = existingRow?.updated_at?.toISOString();

      if (input.ifUnmodifiedSince && existingUpdatedAt && input.ifUnmodifiedSince !== existingUpdatedAt) {
        await client.query("rollback");
        return {
          configured: true,
          state: cleanPrivateAccountState(existingRow.state),
          updatedAt: existingUpdatedAt,
          error: "Private account state changed on another device. Refresh before saving.",
        };
      }

      const state = mergePrivateAccountState(existingRow?.state, input.state);
      const result = existingRow
        ? await client.query(
            `
              update jiagon_account_states
              set
                updated_at = now(),
                session_id = $2,
                wallet = $3,
                user_label = $4,
                state = $5::jsonb
              where privy_user_id = $1
              returning state, updated_at
            `,
            [
              input.privyUserId,
              input.sessionId || null,
              input.wallet || null,
              input.userLabel || null,
              JSON.stringify(state),
            ],
          )
        : await client.query(
            `
              insert into jiagon_account_states (
                privy_user_id,
                session_id,
                wallet,
                user_label,
                state
              )
              values ($1, $2, $3, $4, $5::jsonb)
              returning state, updated_at
            `,
            [
              input.privyUserId,
              input.sessionId || null,
              input.wallet || null,
              input.userLabel || null,
              JSON.stringify(state),
            ],
          );

      await client.query("commit");
      const row = result.rows[0];
      return {
        configured: true,
        state: cleanPrivateAccountState(row.state),
        updatedAt: row.updated_at.toISOString(),
      };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch {
    return {
      configured: true,
      state: null,
      error: "Private account state save failed.",
    };
  }
}

export async function persistReceiptReview(record: ReceiptReviewRecord): Promise<ReceiptPersistenceResult> {
  if (record.status !== "minted") {
    return {
      configured: Boolean(databaseUrl()),
      persisted: false,
      reason: "Only minted Solana receipt credentials are persisted for agent data.",
    };
  }

  if (record.dataMatchesRequest === false) {
    return {
      configured: Boolean(databaseUrl()),
      persisted: false,
      reason: "Onchain credential data differs from the submitted review; review was not persisted.",
    };
  }

  const pool = getPool();
  if (!pool) {
    return {
      configured: false,
      persisted: false,
      reason: "DATABASE_URL is not configured.",
    };
  }

  try {
    await ensureSchema(pool);

    await pool.query(
      `
        insert into jiagon_receipt_reviews (
          receipt_id,
          review_id,
          status,
          mode,
          source_chain,
          source_tx,
          source_block,
          log_index,
          owner_safe,
          wallet,
          place_provider,
          google_place_id,
          merchant,
          branch,
          rating,
          tags,
          review_attributes,
          review_text,
          amount,
          amount_usd,
          token,
          proof_level,
          source_receipt_hash,
          data_hash,
          requested_data_hash,
          data_matches_request,
          storage_uri,
          requested_storage_uri,
          credential_chain,
          chain_id,
          credential_id,
          credential_tx,
          explorer_url,
          registry_address,
          minter,
          payload
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15,
          $16::jsonb, $17::jsonb, $18, $19, $20,
          $21, $22, $23, $24, $25, $26, $27,
          $28, $29, $30, $31, $32, $33, $34, $35, $36::jsonb
        )
        on conflict (source_receipt_hash) do update set
          updated_at = now(),
          receipt_id = excluded.receipt_id,
          review_id = excluded.review_id,
          status = excluded.status,
          mode = excluded.mode,
          source_block = excluded.source_block,
          owner_safe = excluded.owner_safe,
          wallet = excluded.wallet,
          place_provider = excluded.place_provider,
          google_place_id = excluded.google_place_id,
          merchant = excluded.merchant,
          branch = excluded.branch,
          rating = excluded.rating,
          tags = excluded.tags,
          review_attributes = excluded.review_attributes,
          review_text = excluded.review_text,
          amount = excluded.amount,
          amount_usd = excluded.amount_usd,
          token = excluded.token,
          proof_level = excluded.proof_level,
          data_hash = excluded.data_hash,
          requested_data_hash = excluded.requested_data_hash,
          data_matches_request = excluded.data_matches_request,
          storage_uri = excluded.storage_uri,
          requested_storage_uri = excluded.requested_storage_uri,
          credential_chain = excluded.credential_chain,
          chain_id = excluded.chain_id,
          credential_id = excluded.credential_id,
          credential_tx = excluded.credential_tx,
          explorer_url = excluded.explorer_url,
          registry_address = excluded.registry_address,
          minter = excluded.minter,
          payload = excluded.payload
      `,
      [
        record.receiptId,
        record.reviewId,
        record.status,
        record.mode || null,
        record.sourceChain,
        record.sourceTx,
        record.sourceBlock || null,
        record.logIndex,
        record.ownerSafe || null,
        record.wallet || null,
        record.placeProvider || null,
        record.googlePlaceId || null,
        record.merchant,
        record.branch,
        record.rating,
        JSON.stringify(record.tags || []),
        JSON.stringify(record.reviewAttributes || {}),
        record.reviewText || "",
        record.amount || null,
        record.amountUsd || null,
        record.token || null,
        record.proofLevel,
        record.sourceReceiptHash,
        record.dataHash,
        record.requestedDataHash || null,
        typeof record.dataMatchesRequest === "boolean" ? record.dataMatchesRequest : null,
        record.storageUri,
        record.requestedStorageUri || null,
        record.credentialChain,
        record.chainId,
        record.credentialId,
        record.credentialTx || null,
        record.explorerUrl || null,
        record.registryAddress || null,
        record.minter || null,
        JSON.stringify(record.payload),
      ],
    );

    return {
      configured: true,
      persisted: true,
      receiptId: record.receiptId,
      reviewId: record.reviewId,
    };
  } catch {
    return {
      configured: true,
      persisted: false,
      error: "Receipt persistence failed.",
    };
  }
}

export async function listReceiptReviews(limit = 50): Promise<{
  configured: boolean;
  reviews: PublicReceiptReview[];
  error?: string;
}> {
  const pool = getPool();
  if (!pool) return { configured: false, reviews: [] };

  try {
    await ensureSchema(pool);
    const cappedLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
    const result = await pool.query(
      `
        select
          receipt_id,
          review_id,
          status,
          mode,
          source_chain,
          log_index,
          place_provider,
          google_place_id,
          merchant,
          branch,
          rating,
          tags,
          review_attributes,
          review_text,
          token,
          proof_level,
          source_receipt_hash,
          data_hash,
          data_matches_request,
          storage_uri,
          credential_chain,
          chain_id,
          credential_id,
          credential_tx,
          explorer_url,
          created_at,
          updated_at
        from jiagon_receipt_reviews
        where status = 'minted' and data_matches_request is true
        order by created_at desc
        limit $1
      `,
      [cappedLimit],
    );

    return {
      configured: true,
      reviews: result.rows.map((row) => ({
        receiptId: row.receipt_id,
        reviewId: row.review_id,
        status: row.status,
        mode: row.mode,
        sourceChain: row.source_chain,
        logIndex: row.log_index,
        placeProvider: row.place_provider,
        googlePlaceId: row.google_place_id,
        merchant: row.merchant,
        branch: row.branch,
        rating: row.rating,
        tags: Array.isArray(row.tags) ? row.tags.filter((tag: unknown): tag is string => typeof tag === "string") : [],
        reviewAttributes:
          row.review_attributes && typeof row.review_attributes === "object" && !Array.isArray(row.review_attributes)
            ? row.review_attributes
            : {},
        reviewText: row.review_text,
        token: row.token,
        proofLevel: row.proof_level,
        publicProofId: publicProofId(row.source_receipt_hash),
        dataHash: row.data_hash,
        dataMatchesRequest: row.data_matches_request,
        storageUri: row.storage_uri,
        credentialChain: row.credential_chain,
        chainId: row.chain_id,
        credentialId: row.credential_id,
        credentialTx: row.credential_tx,
        explorerUrl: row.explorer_url,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      })),
    };
  } catch {
    return {
      configured: true,
      reviews: [],
      error: "Receipt review query failed.",
    };
  }
}

export async function getVerifiedReceiptReviewBySourceHash(sourceReceiptHash: string): Promise<{
  configured: boolean;
  review: ReceiptReviewRecord | null;
  error?: string;
}> {
  const pool = getPool();
  if (!pool) return { configured: false, review: null };

  try {
    await ensureSchema(pool);
    const result = await pool.query(
      `
        select
          receipt_id,
          review_id,
          status,
          mode,
          source_chain,
          source_tx,
          source_block,
          log_index,
          owner_safe,
          wallet,
          place_provider,
          google_place_id,
          merchant,
          branch,
          rating,
          tags,
          review_attributes,
          review_text,
          amount,
          amount_usd,
          token,
          proof_level,
          source_receipt_hash,
          data_hash,
          requested_data_hash,
          data_matches_request,
          storage_uri,
          requested_storage_uri,
          credential_chain,
          chain_id,
          credential_id,
          credential_tx,
          explorer_url,
          registry_address,
          minter,
          payload
        from jiagon_receipt_reviews
        where source_receipt_hash = $1
          and status = 'minted'
          and data_matches_request is true
        limit 1
      `,
      [sourceReceiptHash],
    );
    const row = result.rows[0];

    if (!row) return { configured: true, review: null };

    return {
      configured: true,
      review: {
        receiptId: row.receipt_id,
        reviewId: row.review_id,
        status: row.status,
        mode: row.mode,
        sourceChain: row.source_chain,
        sourceTx: row.source_tx,
        sourceBlock: row.source_block,
        logIndex: row.log_index,
        ownerSafe: row.owner_safe,
        wallet: row.wallet,
        placeProvider: row.place_provider,
        googlePlaceId: row.google_place_id,
        merchant: row.merchant,
        branch: row.branch,
        rating: row.rating,
        tags: Array.isArray(row.tags) ? row.tags.filter((tag: unknown): tag is string => typeof tag === "string") : [],
        reviewAttributes:
          row.review_attributes && typeof row.review_attributes === "object" && !Array.isArray(row.review_attributes)
            ? row.review_attributes
            : {},
        reviewText: row.review_text,
        amount: row.amount,
        amountUsd: row.amount_usd,
        token: row.token,
        proofLevel: row.proof_level,
        sourceReceiptHash: row.source_receipt_hash,
        dataHash: row.data_hash,
        requestedDataHash: row.requested_data_hash,
        dataMatchesRequest: row.data_matches_request,
        storageUri: row.storage_uri,
        requestedStorageUri: row.requested_storage_uri,
        credentialChain: row.credential_chain,
        chainId: row.chain_id,
        credentialId: row.credential_id,
        credentialTx: row.credential_tx,
        explorerUrl: row.explorer_url,
        registryAddress: row.registry_address,
        minter: row.minter,
        payload: row.payload,
      },
    };
  } catch {
    return {
      configured: true,
      review: null,
      error: "Receipt review query failed.",
    };
  }
}

export async function listAgentMerchantSignals(limit = 25): Promise<{
  configured: boolean;
  merchants: AgentMerchantSignal[];
  error?: string;
}> {
  const pool = getPool();
  if (!pool) return { configured: false, merchants: [] };

  try {
    await ensureSchema(pool);
    const cappedLimit = Math.min(50, Math.max(1, Math.trunc(limit)));
    const result = await pool.query(
      `
        select
          merchant,
          branch,
          (array_remove(array_agg(place_provider order by created_at desc), null))[1] as place_provider,
          (array_remove(array_agg(google_place_id order by created_at desc), null))[1] as google_place_id,
          count(distinct source_receipt_hash)::integer as verified_visits,
          count(distinct coalesce(owner_safe, wallet))::integer as verified_wallets,
          round(avg(rating)::numeric, 1)::float as average_rating,
          max(created_at) as last_verified_visit,
          (array_agg(review_text order by created_at desc))[1] as latest_review,
          (array_agg(review_attributes order by created_at desc))[1] as latest_attributes
        from jiagon_receipt_reviews
        where status = 'minted' and data_matches_request is true
        group by merchant, branch
        order by max(created_at) desc
        limit $1
      `,
      [cappedLimit],
    );

    return {
      configured: true,
      merchants: result.rows.map((row) => {
        const key = `${row.merchant.toLowerCase()}::${row.branch.toLowerCase()}`;
        return {
          id: key.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
          placeProvider: row.place_provider || null,
          googlePlaceId: row.google_place_id || null,
          name: row.merchant,
          branch: row.branch,
          category: "Local",
          verifiedVisits: row.verified_visits,
          verifiedWallets: row.verified_wallets,
          averageRating: row.average_rating,
          totalVerifiedSpendUsd: null,
          lastVerifiedVisit: row.last_verified_visit.toISOString().slice(0, 10),
          latestReview: row.latest_review || "",
          latestAttributes: row.latest_attributes && typeof row.latest_attributes === "object" ? row.latest_attributes : {},
        };
      }),
    };
  } catch {
    return {
      configured: true,
      merchants: [],
      error: "Agent merchant signal query failed.",
    };
  }
}

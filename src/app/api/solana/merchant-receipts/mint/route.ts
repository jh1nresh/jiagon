import { createHash } from "node:crypto";
import { isSolanaPubkey } from "@/lib/solanaCredit";
import { bearerTokenFromRequest, verifyPrivyAccessToken } from "@/server/privyAuth";
import { getPrivateAccountState, recordMerchantReceiptCredential, savePrivateAccountState } from "@/server/receiptStore";
import { mintJiagonBubblegumReceipt, solanaBubblegumConfig } from "@/server/solanaBubblegum";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MerchantReceiptMintRequest = {
  receiptId?: string;
  receipt?: Record<string, unknown>;
  solanaOwner?: string;
};

const LOCAL_DEMO_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => typeof nested !== "undefined")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, stable(nested)]),
  );
}

function dataHash(value: unknown) {
  return `0x${sha256Hex(JSON.stringify(stable(value)))}`;
}

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to verify Privy access token.";
  const status = message.includes("not configured") ? 503 : 401;
  return Response.json({ error: message }, { status });
}

function isTrustedLocalDemo(request: Request) {
  const requestHost = request.headers.get("host")?.split(":")[0]?.toLowerCase();
  return process.env.NODE_ENV !== "production" && Boolean(requestHost && LOCAL_DEMO_HOSTS.has(requestHost));
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host")?.toLowerCase();
  if (!origin || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

function verifiedNativeClient(request: Request, claims: Awaited<ReturnType<typeof verifiedClaims>>) {
  return Boolean(claims.userId) &&
    request.headers.get("x-jiagon-client")?.toLowerCase() === "mobile" &&
    !request.headers.get("origin");
}

async function verifiedClaims(request: Request) {
  const token = bearerTokenFromRequest(request);
  if (!token) throw new Error("Privy bearer token is required.");
  return verifyPrivyAccessToken(token);
}

function cleanText(value: unknown, maxLength = 100) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function normalizeMerchantReceipt(value: unknown) {
  const receipt = value && typeof value === "object" ? value as Record<string, unknown> : null;
  if (!receipt) return null;

  const id = cleanText(receipt.id);
  const merchantName = cleanText(receipt.merchantName);
  const receiptHash = cleanText(receipt.receiptHash, 90);
  if (!id || !merchantName || !/^0x[a-fA-F0-9]{64}$|^[a-fA-F0-9]{64}$/.test(receiptHash)) return null;

  return {
    ...receipt,
    id,
    merchantName,
    receiptNumber: cleanText(receipt.receiptNumber) || id,
    amountUsd: cleanText(receipt.amountUsd) || "0.00",
    currency: cleanText(receipt.currency, 12) || "USD",
    category: cleanText(receipt.category) || "Merchant",
    purpose: cleanText(receipt.purpose) || "merchant_receipt",
    status: cleanText(receipt.status, 24) || "claimed",
    receiptHash: receiptHash.startsWith("0x") ? receiptHash : `0x${receiptHash}`,
    issuedAt: cleanText(receipt.issuedAt, 40) || null,
    claimedAt: cleanText(receipt.claimedAt, 40) || null,
  };
}

function findAccountReceipt(state: unknown, receiptId: string) {
  const record = state && typeof state === "object" ? state as { merchantReceipts?: unknown[] } : null;
  const receipts = Array.isArray(record?.merchantReceipts) ? record.merchantReceipts : [];
  return receipts.map(normalizeMerchantReceipt).find((receipt) => receipt?.id === receiptId) || null;
}

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return Response.json({ error: "Merchant receipt mint requires a JSON request." }, { status: 415 });
  }

  let claims: Awaited<ReturnType<typeof verifiedClaims>>;
  try {
    claims = await verifiedClaims(request);
  } catch (error) {
    return authError(error);
  }

  if (!isTrustedLocalDemo(request) && !sameOrigin(request) && !verifiedNativeClient(request, claims)) {
    return Response.json(
      { error: "Merchant receipt mint must be requested from the Jiagon app origin or an authenticated Jiagon mobile client." },
      { status: 403 },
    );
  }

  let body: MerchantReceiptMintRequest;
  try {
    const rawBody = await request.text();
    if (rawBody.length > 100_000) {
      return Response.json({ error: "Merchant receipt mint payload is too large." }, { status: 413 });
    }
    body = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const receiptId = cleanText(body.receiptId || body.receipt?.id);
  const rawSolanaOwner = body.solanaOwner || process.env.SOLANA_BUBBLEGUM_DEFAULT_LEAF_OWNER || "";
  const solanaOwner = typeof rawSolanaOwner === "string" ? rawSolanaOwner.trim() : "";

  if (!receiptId) {
    return Response.json({ error: "Merchant receipt id is required." }, { status: 400 });
  }
  if (!isSolanaPubkey(solanaOwner)) {
    return Response.json({ error: "A valid Solana owner public key is required before minting the receipt cNFT." }, { status: 400 });
  }

  const accountState = await getPrivateAccountState(claims.userId);
  let receipt = findAccountReceipt(accountState.state, receiptId);
  if (!receipt && !accountState.configured && isTrustedLocalDemo(request)) {
    receipt = normalizeMerchantReceipt(body.receipt);
  }
  if (!receipt) {
    return Response.json({ error: "Claimed merchant receipt was not found for this Privy account." }, { status: 404 });
  }
  if (receipt.status !== "claimed") {
    return Response.json({ error: "Receipt must be claimed before minting." }, { status: 409 });
  }

  const sourceReceiptHash = receipt.receiptHash;
  const metadataObject = {
    name: `Jiagon Receipt ${receipt.merchantName}`.slice(0, 64),
    symbol: "JIAGON",
    description: "Jiagon merchant-issued receipt credential minted as a Bubblegum compressed NFT.",
    source: {
      type: "merchant-issued",
      sourceReceiptHash,
      receiptId: receipt.id,
    },
    receipt: {
      merchantName: receipt.merchantName,
      receiptNumber: receipt.receiptNumber,
      amountUsd: receipt.amountUsd,
      currency: receipt.currency,
      category: receipt.category,
      purpose: receipt.purpose,
      issuedAt: receipt.issuedAt || null,
      claimedAt: receipt.claimedAt || null,
    },
    solanaOwner,
    proofLevel: "merchant-issued",
  };
  const receiptDataHash = dataHash(metadataObject);
  const metadataUri = `jiagon://merchant-receipt/${sourceReceiptHash.replace(/^0x/, "")}`;
  const config = solanaBubblegumConfig();

  const prepared = {
    status: "prepared",
    mode: "bubblegum-prepare-only",
    network: `Solana ${config.cluster}`,
    credentialChain: `solana-${config.cluster}`,
    standard: "bubblegum-v2-cnft",
    merkleTree: config.merkleTree,
    credentialId: `bubblegum-ready-${sourceReceiptHash.replace(/^0x/, "").slice(0, 12)}`,
    sourceReceiptHash,
    dataHash: receiptDataHash,
    storageUri: metadataUri,
    solanaOwner,
    metaplexBubblegum: {
      status: "tree-or-minter-required",
      tree: config.merkleTree,
      dasRequired: true,
    },
    metadata: metadataObject,
    note: "Merchant receipt is claimed. Solana Bubblegum cNFT mint is prepare-only until SOLANA_BUBBLEGUM_TREE and SOLANA_BUBBLEGUM_MINTER_SECRET_KEY are configured.",
  };

  let result;
  if (config.mintConfigured) {
    try {
      const mint = await mintJiagonBubblegumReceipt({
        leafOwner: solanaOwner,
        sourceReceiptHash,
        dataHash: receiptDataHash,
        metadataUri,
        name: metadataObject.name,
      });
      result = {
        ...mint,
        mode: "bubblegum-minted",
        credentialId: mint.assetId,
        solanaOwner,
        metaplexCoreAsset: mint.assetId,
        metadata: metadataObject,
        note: "Merchant receipt claimed and Solana Bubblegum receipt cNFT minted.",
      };
    } catch (error) {
      console.error("Merchant receipt Bubblegum mint failed", error);
      const message = error instanceof Error ? error.message : "Unable to mint Solana Bubblegum receipt cNFT.";
      return Response.json(
        {
          error: message,
          mode: "bubblegum-mint-failed",
          credentialId: null,
          solanaOwner,
          metadata: metadataObject,
        },
        { status: 502 },
      );
    }
  } else {
    result = prepared;
  }

  const mintedForCredit = result.mode === "bubblegum-minted" && result.status === "minted";
  const mintStatus = mintedForCredit ? "minted" : "prepared";
  const creditIndex = await recordMerchantReceiptCredential({
    receiptId: receipt.id,
    privyUserId: claims.userId,
    mintStatus,
    credentialId: result.credentialId,
    credentialChain: result.credentialChain,
    credentialStandard: result.standard,
    solanaOwner,
    credentialTx: "credentialTx" in result ? result.credentialTx : null,
    dataHash: result.dataHash,
    storageUri: result.storageUri,
    explorerUrl: "explorerUrl" in result ? result.explorerUrl : null,
    assetExplorerUrl: "assetExplorerUrl" in result ? result.assetExplorerUrl : null,
    creditUnlockedCents: mintedForCredit ? 2_500 : 0,
  });
  const creditEligible = mintedForCredit && creditIndex.configured && creditIndex.updated && !creditIndex.error;
  const creditImpact = creditEligible
    ? {
        eligible: true,
        unlockedCreditUsd: 25,
        reason: "Merchant receipt credential is indexed for Jiagon credit underwriting.",
      }
    : {
        eligible: false,
        unlockedCreditUsd: 0,
        reason: mintedForCredit
          ? "Bubblegum receipt minted, but server-side credit index is not ready yet."
          : "Merchant-issued receipt must be minted as a Bubblegum cNFT before credit unlock.",
      };
  await savePrivateAccountState({
    privyUserId: claims.userId,
    sessionId: claims.sessionId,
    state: {
      merchantReceipts: [
        {
          ...receipt,
          mintStatus,
          credentialId: result.credentialId,
          credentialChain: result.credentialChain,
          standard: result.standard,
          dataHash: result.dataHash,
          storageUri: result.storageUri,
          solanaOwner,
          credentialTx: "credentialTx" in result ? result.credentialTx : null,
          explorerUrl: "explorerUrl" in result ? result.explorerUrl : null,
          assetExplorerUrl: "assetExplorerUrl" in result ? result.assetExplorerUrl : null,
          creditImpact,
        },
      ],
    },
  });

  return Response.json({ ...result, creditImpact, creditIndex });
}

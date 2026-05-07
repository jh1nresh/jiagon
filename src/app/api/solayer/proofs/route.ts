import {
  buildSolayerProofMessage,
  canonicalJson,
  normalizeSolayerProofInput,
  type SolayerProofInput,
} from "@/lib/solayerProof";
import { isSolanaPubkey } from "@/lib/solanaCredit";
import {
  sha256Hex,
  signSolayerProofAdapter,
  solayerProofSigningSecret,
} from "@/server/solayerProofSigner";
import bs58 from "bs58";
import nacl from "tweetnacl";

export const runtime = "nodejs";

function cleanSolanaOwner(value: unknown) {
  if (typeof value !== "string") return null;
  const owner = value.trim();
  return isSolanaPubkey(owner) ? owner : null;
}

function decodeSignature(value: unknown) {
  if (typeof value !== "string") return null;
  const signature = value.trim();
  const looksBase64 = /[+/=]/.test(signature);
  try {
    if (!looksBase64) {
      const decoded = bs58.decode(signature);
      if (decoded.length === 64) return decoded;
      return null;
    }
  } catch {
    // Fall through to base64 decoding.
  }
  const decoded = Buffer.from(signature, "base64");
  return decoded.length === 64 ? new Uint8Array(decoded) : null;
}

function verifySolanaMessageSignature(input: {
  signer: string;
  message: string;
  signature: Uint8Array;
}) {
  try {
    const publicKey = bs58.decode(input.signer);
    if (publicKey.length !== 32) return false;
    return nacl.sign.detached.verify(
      new TextEncoder().encode(input.message),
      input.signature,
      publicKey,
    );
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return Response.json({ error: "Solayer proof upload requires a JSON request." }, { status: 415 });
  }

  let body: {
    wallet?: unknown;
    proof?: SolayerProofInput;
    ownership?: {
      signer?: unknown;
      signature?: unknown;
    };
  };

  try {
    const rawBody = await request.text();
    if (rawBody.length > 200_000) {
      return Response.json({ error: "Solayer proof payload is too large." }, { status: 413 });
    }
    body = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const wallet = cleanSolanaOwner(body.wallet);
    const signer = cleanSolanaOwner(body.ownership?.signer);
    const signature = decodeSignature(body.ownership?.signature);
    const signingSecret = solayerProofSigningSecret();

    if (!wallet || !signer || wallet !== signer) {
      return Response.json({ error: "A matching wallet signer is required for Solayer proof upload." }, { status: 400 });
    }

    if (!signature) {
      return Response.json({ error: "A wallet signature is required for Solayer proof upload." }, { status: 400 });
    }

    if (signingSecret.length < 32) {
      return Response.json({ error: "Solayer adapter signing secret is not configured." }, { status: 500 });
    }

    const normalized = normalizeSolayerProofInput(body.proof || {});
    if (!normalized.account || normalized.positionUsd <= 0) {
      return Response.json({ error: "Solayer account and position amount are required." }, { status: 400 });
    }

    const message = buildSolayerProofMessage({ wallet, proof: body.proof || {} });
    if (!verifySolanaMessageSignature({ signer, message, signature })) {
      return Response.json({ error: "Solayer proof ownership verification failed." }, { status: 403 });
    }

    const proofHash = `0x${sha256Hex(canonicalJson({ owner: wallet, proof: normalized }))}`;
    const generatedAt = new Date().toISOString();
    const unsignedProof = {
      id: `solayer-${proofHash.slice(2, 14)}`,
      owner: wallet,
      provider: "solayer" as const,
      account: normalized.account,
      asset: normalized.asset,
      positionUsd: normalized.positionUsd,
      sourceUri: normalized.sourceUri,
      proofType: normalized.proofType,
      verifier: normalized.verifier,
      verifierSignature: normalized.verifierSignature,
      proofHash,
      proofLevel: "B" as const,
      status: "adapter-attested" as const,
      verificationStatus: "wallet-attested" as const,
      adapterMode: "zktls-compatible-signed-adapter" as const,
      generatedAt,
    };

    return Response.json({
      ...unsignedProof,
      signedAdapter: signSolayerProofAdapter(unsignedProof, signingSecret),
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to create Solayer proof adapter.",
      },
      { status: 500 },
    );
  }
}

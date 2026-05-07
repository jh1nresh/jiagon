import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  canonicalJson,
  solayerProofSigningPayload,
  type SolayerCreditProof,
} from "@/lib/solayerProof";

export function solayerProofSigningSecret() {
  return (process.env.JIAGON_SOLAYER_ADAPTER_SECRET || process.env.JIAGON_SOLANA_ADAPTER_SECRET || "").trim();
}

export function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function signCanonicalPayload(canonical: string, signingSecret: string) {
  const digest = `0x${sha256Hex(canonical)}`;
  const signature = `0x${createHmac("sha256", signingSecret).update(canonical).digest("hex")}`;

  return {
    algorithm: "HMAC-SHA256" as const,
    digest,
    signature,
    signedAt: new Date().toISOString(),
  };
}

export function signSolayerProofAdapter(
  proof: Omit<SolayerCreditProof, "signedAdapter">,
  signingSecret: string,
) {
  if (!signingSecret || signingSecret.length < 32) {
    throw new Error("Solayer adapter signing secret is not configured.");
  }

  const canonical = canonicalJson(solayerProofSigningPayload(proof));
  return signCanonicalPayload(canonical, signingSecret);
}

function signLegacyLowercaseOwnerAdapter(
  proof: Omit<SolayerCreditProof, "signedAdapter">,
  signingSecret: string,
) {
  const canonical = canonicalJson({
    ...solayerProofSigningPayload(proof),
    owner: proof.owner.toLowerCase(),
  });
  return signCanonicalPayload(canonical, signingSecret);
}

function adapterMatches(candidate: SolayerCreditProof, expected: ReturnType<typeof signCanonicalPayload>) {
  const expectedSignature = Buffer.from(expected.signature.slice(2), "hex");
  const actualSignature = Buffer.from(candidate.signedAdapter?.signature.slice(2) || "", "hex");
  const digestMatches = candidate.signedAdapter?.digest === expected.digest;
  const signatureMatches =
    expectedSignature.length === actualSignature.length &&
    timingSafeEqual(expectedSignature, actualSignature);

  return digestMatches && signatureMatches;
}

export function verifySolayerProofAdapter(proof: unknown, signingSecret: string): SolayerCreditProof | null {
  if (!proof || typeof proof !== "object") return null;
  const candidate = proof as SolayerCreditProof;
  if (!candidate.signedAdapter?.signature || !candidate.signedAdapter?.digest) return null;
  if (!/^0x[a-fA-F0-9]{64}$/.test(candidate.signedAdapter.signature)) return null;
  if (!/^0x[a-fA-F0-9]{64}$/.test(candidate.signedAdapter.digest)) return null;
  if (!/^0x[a-fA-F0-9]{64}$/.test(candidate.proofHash || "")) return null;
  if (typeof candidate.owner !== "string" || candidate.owner.length < 32 || candidate.owner.length > 44) return null;
  if (candidate.provider !== "solayer" || candidate.status !== "adapter-attested") return null;
  if (candidate.verificationStatus !== "wallet-attested") return null;
  if (candidate.adapterMode !== "zktls-compatible-signed-adapter") return null;

  const unsigned = {
    ...candidate,
    signedAdapter: undefined,
  } as Omit<SolayerCreditProof, "signedAdapter">;

  try {
    const expected = signSolayerProofAdapter(unsigned, signingSecret);
    if (adapterMatches(candidate, expected)) return candidate;

    const legacyExpected = signLegacyLowercaseOwnerAdapter(unsigned, signingSecret);
    return adapterMatches(candidate, legacyExpected) ? candidate : null;
  } catch {
    return null;
  }
}

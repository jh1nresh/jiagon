export type SolayerProofInput = {
  account?: unknown;
  asset?: unknown;
  positionUsd?: unknown;
  sourceUri?: unknown;
  proofType?: unknown;
  verifier?: unknown;
  verifierSignature?: unknown;
};

export type SolayerCreditProof = {
  id: string;
  owner: string;
  provider: "solayer";
  account: string;
  asset: string;
  positionUsd: number;
  sourceUri: string | null;
  proofType: string;
  verifier: string | null;
  verifierSignature: string | null;
  proofHash: string;
  proofLevel: "B";
  status: "adapter-attested";
  verificationStatus: "wallet-attested" | "verifier-attested";
  adapterMode: "zktls-compatible-signed-adapter";
  generatedAt: string;
  signedAdapter?: {
    algorithm: "HMAC-SHA256";
    digest: string;
    signature: string;
    signedAt: string;
  };
};

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function cleanOptionalText(value: unknown, maxLength: number) {
  const cleaned = cleanText(value, maxLength);
  return cleaned || null;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => typeof entryValue !== "undefined")
    .sort(([a], [b]) => a.localeCompare(b));

  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`).join(",")}}`;
}

export function normalizeSolayerProofInput(input: SolayerProofInput) {
  const positionUsd = Number(String(input.positionUsd || "").replace(/[^0-9.-]/g, ""));

  return {
    account: cleanText(input.account, 96),
    asset: cleanText(input.asset, 32) || "sSOL",
    positionUsd: Number.isFinite(positionUsd) && positionUsd > 0 ? Math.round(positionUsd * 100) / 100 : 0,
    sourceUri: cleanOptionalText(input.sourceUri, 240),
    proofType: cleanText(input.proofType, 80) || "solayer-position",
    verifier: cleanOptionalText(input.verifier, 80),
    verifierSignature: cleanOptionalText(input.verifierSignature, 256),
  };
}

export function solayerProofMessagePayload({ wallet, proof }: { wallet: string; proof: SolayerProofInput }) {
  return {
    wallet: wallet.trim(),
    proof: normalizeSolayerProofInput(proof),
  };
}

export function buildSolayerProofMessage({ wallet, proof }: { wallet: string; proof: SolayerProofInput }) {
  return [
    "Jiagon Solayer proof upload",
    "Purpose: add offchain Solayer underwriting signal",
    `Payload: ${canonicalJson(solayerProofMessagePayload({ wallet, proof }))}`,
  ].join("\n");
}

export function solayerProofSigningPayload(proof: Omit<SolayerCreditProof, "signedAdapter">) {
  return {
    id: proof.id,
    owner: proof.owner,
    provider: proof.provider,
    account: proof.account,
    asset: proof.asset,
    positionUsd: proof.positionUsd,
    sourceUri: proof.sourceUri,
    proofType: proof.proofType,
    verifier: proof.verifier,
    verifierSignature: proof.verifierSignature,
    proofHash: proof.proofHash,
    proofLevel: proof.proofLevel,
    status: proof.status,
    verificationStatus: proof.verificationStatus,
    adapterMode: proof.adapterMode,
    generatedAt: proof.generatedAt,
  };
}

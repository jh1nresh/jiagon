import { listAgentMerchantSignals, type AgentMerchantSignal } from "@/server/receiptStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Candidate = {
  provider?: string;
  placeId?: string;
  name?: string;
  branch?: string;
  category?: string;
  rating?: number;
  distanceMeters?: number;
  openNow?: boolean;
};

const PROOF_BOUNDARY = {
  payment: "optional_solana_pay",
  merchant: "merchant_completed",
  review: "published_after_customer_claim",
  recommendationUse: "reranking signal, not an official merchant fact",
};

function credentialChainLabel() {
  return (process.env.SOLANA_CREDENTIAL_CHAIN || process.env.NEXT_PUBLIC_SOLANA_CREDENTIAL_CHAIN || "Solana devnet Bubblegum").trim();
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalize(value: unknown) {
  return cleanText(value).toLowerCase();
}

function candidateId(candidate: Candidate, index: number) {
  return candidate.placeId || `${normalize(candidate.name)}::${normalize(candidate.branch)}::${index}`;
}

function googleBaseline(candidate: Candidate) {
  const rating = Number(candidate.rating);
  const ratingScore = Number.isFinite(rating) ? rating * 8 : 0;
  const openScore = candidate.openNow === true ? 6 : 0;
  const distance = Number(candidate.distanceMeters);
  const distanceScore = Number.isFinite(distance) ? Math.max(0, 12 - Math.floor(distance / 500)) : 0;

  return ratingScore + openScore + distanceScore;
}

function queryScore(query: string, candidate: Candidate) {
  const normalized = query.toLowerCase();
  let score = 0;

  for (const value of [candidate.name, candidate.branch, candidate.category]) {
    const text = normalize(value);
    if (text && normalized.includes(text)) score += 10;
  }

  if (normalized.includes("coffee") && /coffee|cafe|bakery/i.test(`${candidate.name} ${candidate.category}`)) score += 10;
  if (normalized.includes("bakery") && /bakery|pastry|bread/i.test(`${candidate.name} ${candidate.category}`)) score += 10;

  return score;
}

function matchesSignal(candidate: Candidate, signal: AgentMerchantSignal) {
  const candidateName = normalize(candidate.name);
  const candidateBranch = normalize(candidate.branch);
  const signalName = normalize(signal.name);
  const signalBranch = normalize(signal.branch);

  if (!candidateName || !signalName) return false;
  const nameMatch = candidateName === signalName || candidateName.includes(signalName) || signalName.includes(candidateName);
  const branchMatch = !candidateBranch || !signalBranch || candidateBranch === signalBranch || candidateBranch.includes(signalBranch) || signalBranch.includes(candidateBranch);

  return nameMatch && branchMatch;
}

function matchType(candidate: Candidate, signal?: AgentMerchantSignal) {
  if (!signal || !matchesSignal(candidate, signal)) return null;
  if (candidate.provider?.toLowerCase() === "google" && candidate.placeId && signal.googlePlaceId && candidate.placeId === signal.googlePlaceId) {
    return "merchant_branch_and_user_claimed_google_place_id";
  }
  return "merchant_branch";
}

function proofBoost(signal?: AgentMerchantSignal) {
  if (!signal) return 0;

  const freshnessBoost = signal.lastVerifiedVisit ? 8 : 0;
  const visitBoost = Math.min(20, signal.verifiedVisits * 5);
  const walletBoost = Math.min(15, signal.verifiedWallets * 5);
  const ratingBoost = signal.averageRating * 6;

  return 30 + freshnessBoost + visitBoost + walletBoost + ratingBoost;
}

export async function POST(request: Request) {
  let body: { query?: string; candidates?: Candidate[] };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const query = cleanText(body.query || "");
  const candidates = Array.isArray(body.candidates) ? body.candidates.slice(0, 50) : [];

  if (candidates.length === 0) {
    return Response.json({ error: "At least one candidate is required." }, { status: 400 });
  }

  const persisted = await listAgentMerchantSignals(50);
  if (persisted.configured && persisted.error) {
    return Response.json(
      {
        error: "Unable to load Jiagon receipt signals.",
        persistence: {
          configured: true,
          error: persisted.error,
        },
      },
      { status: 503 },
    );
  }

  const ranked = candidates
    .map((candidate, index) => {
      const signal = persisted.merchants.find((merchant) => matchesSignal(candidate, merchant));
      const signalMatchType = matchType(candidate, signal);
      const baseScore = googleBaseline(candidate) + queryScore(query, candidate);
      const jiagonBoost = proofBoost(signal);

      return {
        id: candidateId(candidate, index),
        provider: candidate.provider || null,
        placeId: candidate.placeId || null,
        name: candidate.name || signal?.name || "Unknown place",
        branch: candidate.branch || signal?.branch || null,
        category: candidate.category || signal?.category || null,
        inputRating: typeof candidate.rating === "number" ? candidate.rating : null,
        baseScore,
        jiagonBoost,
        agentScore: baseScore + jiagonBoost,
        jiagonProof: signal
          ? {
              matched: true,
              matchType: signalMatchType,
              placeLinkProof: signal.googlePlaceId ? "user_claimed_place_id" : null,
              payment: PROOF_BOUNDARY.payment,
              merchant: PROOF_BOUNDARY.merchant,
              credentialChain: credentialChainLabel(),
              verifiedVisits: signal.verifiedVisits,
              verifiedWallets: signal.verifiedWallets,
              averageRating: signal.averageRating,
              lastVerifiedVisit: signal.lastVerifiedVisit,
              latestReview: signal.latestReview,
              agentSignals: signal.latestAttributes,
              caveat: "Merchant completion and customer claim are verified by Jiagon; payment proof is an optional additional signal and is not required for this rerank boost.",
            }
          : {
              matched: false,
              caveat: "No Jiagon receipt-backed signal found for this candidate yet.",
            },
        reasons: signal
          ? [
              "Candidate matched Jiagon receipt-backed taste signals.",
              `Verified visits: ${signal.verifiedVisits}.`,
              `Verified wallets: ${signal.verifiedWallets}.`,
              signalMatchType === "merchant_branch_and_user_claimed_google_place_id"
                ? "Matched by merchant/branch text plus user-claimed Google place id."
                : "Matched by merchant and branch text.",
              candidate.branch ? null : "Candidate branch was missing; treat location match as lower confidence.",
            ].filter((reason): reason is string => Boolean(reason))
          : ["No Jiagon proof boost applied."],
      };
    })
    .sort((a, b) => b.agentScore - a.agentScore);

  return Response.json({
    query,
    product: "Jiagon proof reranking layer",
    usage: "Use Google/Places or another place graph for candidates, then use Jiagon to boost candidates with receipt-backed proof.",
    dataSource: persisted.merchants.length > 0 ? "postgres-merchant-signals" : "empty",
    proofBoundary: PROOF_BOUNDARY,
    persistence: {
      configured: persisted.configured,
      error: persisted.error,
    },
    ranked,
  });
}

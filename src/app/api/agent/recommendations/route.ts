import { listAgentMerchantSignals } from "@/server/receiptStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RecommendationMerchant = {
  name: string;
  branch: string;
  category: string;
  averageRating: number;
  verifiedVisits: number;
  verifiedWallets: number;
};

const PROOF_BOUNDARY = {
  payment: "optional_solana_pay",
  merchant: "merchant_completed",
  review: "published_after_customer_claim",
  recommendationUse: "ranking signal, not an official merchant fact",
};

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function buildAgentSignals(attributes: Record<string, unknown>) {
  const valueRating = Number(attributes.valueRating);

  return {
    visitType: stringValue(attributes.visitType),
    occasion: stringValue(attributes.occasion),
    valueRating: Number.isFinite(valueRating) ? valueRating : null,
    wouldReturn: typeof attributes.wouldReturn === "boolean" ? attributes.wouldReturn : null,
    bestFor: stringList(attributes.bestFor),
  };
}

const scoreMerchant = (query: string, merchant: RecommendationMerchant) => {
  const normalized = query.toLowerCase();
  let score = merchant.averageRating * 10 + merchant.verifiedVisits + merchant.verifiedWallets;

  if (normalized.includes(merchant.category.toLowerCase())) score += 18;
  if (normalized.includes(merchant.branch.toLowerCase())) score += 18;
  if (normalized.includes(merchant.name.toLowerCase())) score += 24;
  if (normalized.includes("coffee") && merchant.category.toLowerCase() === "cafe") score += 12;
  if (normalized.includes("bakery") && merchant.category.toLowerCase() === "bakery") score += 12;

  return score;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("query") || "";
  const limit = Math.min(5, Math.max(1, Number(searchParams.get("limit") || 3)));
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

  const merchantSource = persisted.merchants.map((merchant) => ({
    ...merchant,
    agentSignals: buildAgentSignals(merchant.latestAttributes),
    proofBoundary: PROOF_BOUNDARY,
    proofLevel: {
      payment: "A",
      merchant: "C",
      source: "Jiagon agentic POS receipt",
      credentialChain: "Solana devnet Bubblegum",
      storageLayer: "receipt metadata URI",
      caveat: "Merchant completion and customer claim are verified by Jiagon; payment proof is optional until Solana Pay verification is configured.",
    },
    reasons: (() => {
      const signals = buildAgentSignals(merchant.latestAttributes);
      return [
        "Built from persisted receipt-backed Jiagon reviews.",
        `Recent verified visit signal: ${merchant.lastVerifiedVisit}.`,
        signals.visitType ? `Latest visit type: ${signals.visitType}.` : null,
        signals.bestFor.length > 0 ? `Best for: ${signals.bestFor.slice(0, 4).join(", ")}.` : null,
        typeof signals.wouldReturn === "boolean" ? `Reviewer would return: ${signals.wouldReturn ? "yes" : "no"}.` : null,
        signals.valueRating ? `Value signal: ${signals.valueRating}/5.` : null,
        merchant.latestReview
          ? `Latest review note: ${merchant.latestReview.slice(0, 120)}${merchant.latestReview.length > 120 ? "..." : ""}`
          : "No long-form review text was published.",
      ].filter((reason): reason is string => Boolean(reason));
    })(),
  }));

  const recommendations = merchantSource
    .map((merchant) => ({
      ...merchant,
      agentScore: scoreMerchant(query, merchant),
    }))
    .sort((a, b) => b.agentScore - a.agentScore)
    .slice(0, limit);

  return Response.json({
    query,
    product: "Jiagon verified local taste signal layer",
    privacy: "Response includes published or aggregate receipt review signals. Private receipt inbox data should stay user-scoped.",
    dataSource: persisted.merchants.length > 0 ? "postgres-merchant-signals" : "empty",
    persistence: {
      configured: persisted.configured,
      error: persisted.error,
    },
    architecture: {
      source: "agentic-pos-order",
      credentialChain: "solana-devnet",
      storageLayer: "receipt metadata URI",
      flow: "Agent order -> merchant completion -> customer claim -> Bubblegum receipt cNFT",
    },
    proofLevels: {
      A: "Solana payment plus merchant fulfillment plus customer claim",
      B: "Bubblegum receipt cNFT minted from merchant-completed, customer-claimed receipt",
      C: "Merchant-completed receipt claimed by customer",
      D: "Order intent only",
    },
    recommendations,
  });
}

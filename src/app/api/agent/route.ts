import { agentDiscovery, originFromRequest } from "@/lib/agentDiscovery";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = originFromRequest(request);

  return Response.json({
    ...agentDiscovery(origin),
    howAgentsUseThis: [
      "Read /api/agent or /.well-known/jiagon-agent.json to discover endpoints.",
      "Call /api/agent/orders when the user asks a personal agent to order from a Jiagon merchant.",
      "Use Google Places or another place graph to get candidates when Jiagon does not have enough coverage.",
      "Call /api/agent/rerank with those candidates to apply Jiagon receipt proof boosts.",
      "Call /api/agent/recommendations directly when you only want places already present in Jiagon taste signals.",
      "Use proofLevel, proofBoundary, reasons, freshness, verifiedVisits, and verifiedWallets to decide whether to recommend a merchant.",
      "Do not treat user-claimed merchant identity as an official merchant fact unless a stronger proof level is present.",
    ],
    coffeeExample: {
      userIntent: "I want coffee near Irvine.",
      agentRequest: {
        method: "GET",
        url: `${origin}/api/agent/recommendations?query=coffee%20irvine&limit=3`,
      },
      agentDecisionProcess: [
        "Fetch coffee candidates from Google Places or another place graph.",
        "Send those candidates to /api/agent/rerank.",
        "Prefer candidates with merchant-completed, customer-claimed, and Solana-minted receipt credentials.",
        "Read agentSignals such as bestFor, valueRating, wouldReturn, and latest review text.",
        "Return a recommendation with a proof caveat if merchant identity is still user-claimed.",
      ],
    },
  });
}

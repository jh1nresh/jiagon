import { agentDiscovery, originFromRequest } from "@/lib/agentDiscovery";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = originFromRequest(request);

  return Response.json({
    ...agentDiscovery(origin),
    howAgentsUseThis: [
      "Read /api/agent or /.well-known/jiagon-agent.json to discover endpoints.",
      "Call /api/agent/orders when the user says an intent like 'I want coffee' and delegates merchant ordering to their personal agent.",
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
    orderingExample: {
      userIntent: "I want a coffee. Keep it under $10 and use crypto pay if possible.",
      agentRequest: {
        method: "POST",
        url: `${origin}/api/agent/orders`,
        body: {
          agentId: "seeker-demo-agent",
          userIntent: "I want a coffee. Keep it under $10 and use crypto pay if possible.",
          maxSpendUsd: "10.00",
          paymentMode: "crypto_pay",
        },
      },
      agentDecisionProcess: [
        "Use Jiagon's demo merchant default when the user does not specify a shop.",
        "Let Jiagon match the intent to a Raposa Coffee menu item.",
        "Return only the user-visible pickup result plus payment approval step.",
        "Track merchant Paid + Done and receipt claim so the user does not operate POS screens.",
      ],
    },
  });
}

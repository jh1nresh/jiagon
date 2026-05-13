const product = {
  name: "Jiagon",
  title: "Jiagon merchant negotiator agent",
  description: "Quote-first real-world merchant ordering, fulfillment handoff, and receipt proof for personal agents.",
  version: "0.1.0",
};

const proofLevels = {
  A: "Verified payment plus merchant fulfillment plus passport claim.",
  B: "Bubblegum receipt cNFT minted from merchant-completed, passport-claimed receipt.",
  C: "Merchant-completed order receipt claimed into passport memory.",
  L4: "Payment-backed order receipt from Shopify, MoonPay Commerce, or verified Solana Pay.",
  D: "Order intent only; not credit-grade until merchant completion.",
};

const privacy =
  "Recommendations use published or aggregate receipt-backed review signals. Private receipt inbox data stays user-scoped.";

const sampleSolanaOwner = "11111111111111111111111111111111";

const adapterHandoff = {
  boundary: "For the YC Call My Agent demo, merchant negotiation is the core path. Receipt memory is the proof that the agent completed useful work.",
  orderAgent: {
    role: "Personal Order Agent",
    responsibility: "Captures user intent, checks merchant capabilities, asks for a feasible quote, then creates an order or checkout pass only after constraints are satisfied.",
    entrypoints: [
      "/api/agent/merchants/{merchantId}/capabilities",
      "/api/agent/merchants/{merchantId}/quote",
      "/api/agent/merchants/{merchantId}/orders",
      "/api/agent/orders",
      "/api/agent/orders/{id}/verify-solana-pay",
      "/api/agent/shopify/orders",
    ],
  },
  takeOrderAgent: {
    role: "Merchant Take-Order Agent",
    responsibility: "Receives the pass in the merchant queue, Telegram terminal, Shopify checkout, or MoonPay Commerce payment flow, then confirms the paid or fulfilled event.",
    entrypoints: ["/merchant", "/api/merchant/orders/{id}/action", "/api/merchant/orders/{id}/complete", "/api/webhooks/shopify/orders-paid", "/api/webhooks/moonpay"],
  },
  receiptPassport: {
    role: "Receipt Passport",
    responsibility: "Turns paid or merchant-fulfilled events into claimable receipt proof after the real-world task is complete.",
    entrypoints: ["/claim/{token}", "/passport", "/api/agent/proofs/{receiptHash}", "/api/agent/credit-eligibility"],
  },
};

export function originFromRequest(request: Request) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export function agentDiscovery(origin: string) {
  return {
    ...product,
    homepage: origin,
    privacy,
    humanDocs: `${origin}/api/agent`,
    openapi: `${origin}/openapi.json`,
    wellKnown: `${origin}/.well-known/jiagon-agent.json`,
    primaryUseCase:
      "Let a personal agent negotiate real-world merchant orders by checking budget, time, stock, and fulfillment constraints before creating an order handoff.",
    capabilityOrder: [
      "/api/agent/merchants/{merchantId}/capabilities",
      "/api/agent/merchants/{merchantId}/quote",
      "/api/agent/merchants/{merchantId}/orders",
      "/api/merchant/orders/{id}/action",
      "/api/agent/proofs/{receiptHash}",
      "/api/agent/merchants/{merchantId}/trust",
      "/api/agent/credit-eligibility",
      "/api/agent/rerank",
      "/api/agent/recommendations",
      "/api/agent/orders",
      "/api/agent/orders/{id}/verify-solana-pay",
      "/api/agent/shopify/products",
      "/api/agent/shopify/orders",
      "/api/webhooks/shopify/orders-paid",
      "/api/webhooks/moonpay",
    ],
    adapterHandoff,
    exampleUserIntent: "Get me an iced latte from Raposa under $10, ready in 15 minutes.",
    exampleProofCall: {
      method: "GET",
      url: `${origin}/api/agent/proofs/{receiptHash}`,
    },
    exampleTrustCall: {
      method: "GET",
      url: `${origin}/api/agent/merchants/raposa-coffee/trust`,
    },
    exampleCreditEligibilityCall: {
      method: "GET",
      url: `${origin}/api/agent/credit-eligibility?owner=${sampleSolanaOwner}`,
    },
    exampleRerankCall: {
      method: "POST",
      url: `${origin}/api/agent/rerank`,
      body: {
        query: "coffee irvine",
        candidates: [
          {
            provider: "google",
            placeId: "ChIJ...",
            name: "85C Bakery Cafe",
            branch: "Irvine",
            category: "Cafe",
            rating: 4.4,
            openNow: true,
          },
        ],
      },
    },
    endpoints: {
      receiptProof: {
        method: "GET",
        url: `${origin}/api/agent/proofs/{receiptHash}`,
        capability: "core proof API",
        returns: [
          "public merchant receipt proof",
          "claim and mint status",
          "Solana credential metadata when available",
          "proof boundary for agent decisions",
        ],
      },
      merchantTrust: {
        method: "GET",
        url: `${origin}/api/agent/merchants/{merchantId}/trust`,
        capability: "core merchant trust API",
        returns: [
          "agent-readable merchant trust score",
          "aggregate verified receipt and review memory",
          "whether the merchant should be boosted in an agent recommendation",
          "purpose-bound credit eligibility caveats",
        ],
      },
      merchantCapabilities: {
        method: "GET",
        url: `${origin}/api/agent/merchants/{merchantId}/capabilities`,
        capability: "merchant negotiation capability API",
        returns: [
          "merchant catalog and fulfillment mode",
          "which constraints the merchant adapter can quote",
          "available negotiation and order actions",
          "caveats separating estimates from final merchant acceptance",
        ],
      },
      merchantQuote: {
        method: "POST",
        url: `${origin}/api/agent/merchants/{merchantId}/quote`,
        capability: "merchant negotiation quote API",
        body: {
          userIntent: "Natural-language request. Example: get me an iced latte within 15 minutes under $10.",
          itemId: "Optional exact catalog item id.",
          maxSpendUsd: "Optional budget constraint.",
          deadlineMinutes: "Optional pickup deadline for local merchants.",
          deliverByDays: "Optional shipping deadline for ecommerce merchants.",
        },
        returns: [
          "whether the request is feasible",
          "matched item and subtotal",
          "pickup queue / ready-time or shipping estimate",
          "reasons and alternatives when constraints cannot be met",
        ],
      },
      merchantScopedOrder: {
        method: "POST",
        url: `${origin}/api/agent/merchants/{merchantId}/orders`,
        capability: "merchant-scoped order execution after quote",
        body: {
          agentId: "Stable id for the user's personal agent.",
          userIntent: "Natural order request already checked with the quote endpoint.",
          maxSpendUsd: "Optional user spending policy enforced before order creation.",
          paymentMode: "Optional: crypto_pay for external wallet approval, or pay_at_counter for a pilot fallback.",
        },
        returns: [
          "same order pass, payment intent, pickup estimate, and receipt-source handoff as /api/agent/orders",
          "merchantId is pinned from the URL to avoid the agent drifting after quote",
        ],
      },
      creditEligibility: {
        method: "GET",
        url: `${origin}/api/agent/credit-eligibility`,
        capability: "core purpose-bound credit eligibility API",
        query: {
          owner: "Solana wallet public key.",
        },
        returns: [
          "eligible or not eligible state",
          "unlocked demo credit from minted receipt credentials",
          "allowed purpose: dining deposit",
          "bounded recipient and max demo cap",
        ],
      },
      rerank: {
        method: "POST",
        url: `${origin}/api/agent/rerank`,
        capability: "core rerank and recommendation API",
        body: {
          query: "Free text user intent. Example: coffee irvine.",
          candidates: "Candidate places from Google Places or another place graph. Jiagon does not need to own the full place graph.",
        },
        returns: [
          "candidate ranking with Jiagon proof boost",
          "matched receipt-backed signals when available",
          "proof caveats for candidates without Jiagon data",
        ],
      },
      recommendations: {
        method: "GET",
        url: `${origin}/api/agent/recommendations`,
        capability: "core rerank and recommendation API",
        query: {
          query: "Free text need, category, merchant, or location. Example: coffee irvine.",
          limit: "Optional integer from 1 to 5.",
        },
        returns: [
          "ranked merchant recommendations",
          "proof level boundaries",
          "agent-readable reasons",
          "aggregate verified visits and wallets",
          "credential and proof-level context",
        ],
      },
      publishedReviews: {
        method: "GET",
        url: `${origin}/api/receipts/reviews`,
        query: {
          limit: "Optional integer from 1 to 100.",
        },
        returns: [
          "published receipt-backed review signals",
          "public proof ids",
          "credential transaction metadata",
          "storage URI and data hash",
        ],
      },
      orderAdapter: {
        method: "POST",
        url: `${origin}/api/agent/orders`,
        capability: "optional Personal Order Agent adapter, not the core Jiagon capability",
        body: {
          agentId: "Stable id for the user's personal agent.",
          userIntent: "Natural order request. Example: get me a coffee under $10.",
          merchantId: "Optional known Jiagon merchant id. Defaults to raposa-coffee in the demo.",
          items: "Optional structured menu items instead of natural language.",
          maxSpendUsd: "Optional user spending policy enforced before the order pass is created.",
          paymentMode: "Optional: crypto_pay for external wallet approval, or pay_at_counter for a pilot fallback.",
        },
        returns: [
          "Personal Order Agent to Merchant Take-Order Agent handoff",
          "adapter-created order pass and pickup code",
          "pickup estimate",
          "optional external Solana wallet payment request",
          "merchant staff dispatch status",
          "NFC receipt station URL for claim after merchant fulfillment",
        ],
      },
      shopifyProducts: {
        method: "GET",
        url: `${origin}/api/agent/shopify/products`,
        capability: "optional Shopify product search adapter for checkout creation, not the core Jiagon capability",
        query: {
          query: "Required Shopify product search query. Example: beanie.",
          limit: "Optional integer from 1 to 10.",
        },
        returns: [
          "Shopify product variants available for agent checkout",
          "variant ids usable by the Shopify order adapter",
          "price and availability metadata when Shopify is configured",
        ],
      },
      shopifyOrderAdapter: {
        method: "POST",
        url: `${origin}/api/agent/shopify/orders`,
        capability: "optional Shopify checkout adapter for the Personal Order Agent handoff, not the core Jiagon capability",
        body: {
          agentId: "Stable id for the user's personal agent.",
          userIntent: "Natural purchase request. Example: buy a beanie under $100.",
          query: "Optional Shopify product search query.",
          variantId: "Optional exact Shopify Storefront variant id.",
          maxSpendUsd: "Optional user spending policy enforced before checkout creation.",
        },
        returns: [
          "selected Shopify product variant",
          "Jiagon order pass",
          "Shopify checkout URL",
          "cart attributes carrying jiagon_order_id for paid-order receipt issuance after merchant integration",
        ],
      },
      paymentReceiptAdapters: {
        capability: "optional Merchant Take-Order Agent payment adapters, not the core Jiagon capability",
        endpoints: [
          {
            method: "POST",
            url: `${origin}/api/merchant/orders/{id}/action`,
            requires: "Merchant dashboard key; action is accept, preparing, paid_done, reject, or cancel.",
          },
          {
            method: "POST",
            url: `${origin}/api/webhooks/shopify/orders-paid`,
            requires: "Merchant-configured Shopify orders/paid webhook with valid HMAC.",
          },
          {
            method: "POST",
            url: `${origin}/api/webhooks/moonpay`,
            requires: "Merchant-configured MoonPay Commerce webhook with bearer token and HMAC signature.",
          },
        ],
        returns: [
          "payment-backed receipt issuance for an existing Jiagon order pass when orderId is present",
          "claimable receipt for a merchant-configured paid Shopify order when no Jiagon order pass is attached",
          "receipt passport claim URL, proof hash, and payment provider/status metadata",
        ],
      },
    },
    proofLevels,
    architecture: {
      source: "receipt-passport-api",
      credentialChain: "solana-devnet",
      storageLayer: "receipt metadata URI",
      flow: "Paid or merchant-verified commerce event -> claimable Jiagon receipt -> passport claim -> Bubblegum receipt cNFT -> agent proof/trust API -> purpose-bound dining deposit eligibility",
      adapters: "Personal Order Agent, Merchant Take-Order Agent, merchant dashboard, NFC/QR, Telegram, Shopify checkout, and MoonPay Commerce can create receipt memory but are not the primary API surface.",
    },
  };
}

export function openApiSpec(origin: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: product.title,
      description: product.description,
      version: product.version,
    },
    servers: [{ url: origin }],
    tags: [
      {
        name: "Agent",
        description: "Agent-readable recommendation and receipt proof data.",
      },
      {
        name: "Adapters",
        description: "Optional order, checkout, and payment-event adapters that feed the receipt passport.",
      },
    ],
    "x-capability-order": [
      "/api/agent/proofs/{receiptHash}",
      "/api/agent/merchants/{merchantId}/trust",
      "/api/agent/merchants/{merchantId}/capabilities",
      "/api/agent/merchants/{merchantId}/quote",
      "/api/agent/merchants/{merchantId}/orders",
      "/api/agent/credit-eligibility",
      "/api/agent/rerank",
      "/api/agent/recommendations",
      "/api/agent/orders",
      "/api/merchant/orders/{id}/action",
      "/api/agent/shopify/products",
      "/api/agent/shopify/orders",
      "/api/webhooks/shopify/orders-paid",
      "/api/webhooks/moonpay",
    ],
    paths: {
      "/api/agent": {
        get: {
          tags: ["Agent"],
          summary: "Discover Jiagon agent API endpoints.",
          operationId: "getJiagonAgentDocs",
          responses: {
            "200": {
              description: "Agent discovery metadata.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/AgentDiscovery" },
                },
              },
            },
          },
        },
      },
      "/api/agent/recommendations": {
        get: {
          tags: ["Agent"],
          summary: "Get receipt-backed local recommendations.",
          operationId: "getJiagonRecommendations",
          parameters: [
            {
              name: "query",
              in: "query",
              required: false,
              schema: { type: "string" },
              description: "Free text place, category, or local need. Example: coffee irvine.",
            },
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 5, default: 3 },
            },
          ],
          responses: {
            "200": {
              description: "Ranked recommendations with proof context.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/RecommendationResponse" },
                },
              },
            },
            "503": {
              description: "Receipt signal store unavailable.",
            },
          },
        },
      },
      "/api/agent/orders": {
        post: {
          tags: ["Adapters"],
          summary: "Optional adapter: hand a Personal Order Agent request to a Merchant Take-Order Agent.",
          operationId: "createAgentMerchantOrder",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AgentOrderRequest" },
              },
            },
          },
          responses: {
            "201": {
              description: "Adapter order pass created for merchant fulfillment.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/AgentOrderResponse" },
                },
              },
            },
            "400": {
              description: "Invalid JSON body, unknown merchant, or demo order cap exceeded.",
            },
            "409": {
              description: "Order exceeds user agent spending policy.",
            },
            "413": {
              description: "Order payload exceeds the body size cap.",
            },
            "415": {
              description: "Request content type must be application/json.",
            },
            "422": {
              description: "Agent request needs clarification before an order can be created.",
            },
            "429": {
              description: "Agent order rate limit exceeded.",
            },
            "503": {
              description: "Order persistence failed after order creation.",
            },
          },
        },
      },
      "/api/agent/merchants/{merchantId}/capabilities": {
        get: {
          tags: ["Adapters"],
          summary: "Negotiator API: describe what a merchant adapter can quote and execute.",
          operationId: "getMerchantAgentCapabilities",
          parameters: [
            {
              name: "merchantId",
              in: "path",
              required: true,
              schema: { type: "string", examples: ["raposa-coffee", "raposa-shop", "solyd-cases"] },
            },
          ],
          responses: {
            "200": {
              description: "Merchant catalog, fulfillment mode, quote inputs, and action endpoints.",
            },
            "400": {
              description: "merchantId path parameter is missing or invalid.",
            },
            "404": {
              description: "Unknown merchant.",
            },
          },
        },
      },
      "/api/agent/merchants/{merchantId}/quote": {
        post: {
          tags: ["Adapters"],
          summary: "Negotiator API: quote feasibility before creating an order.",
          operationId: "quoteMerchantAgentOrder",
          parameters: [
            {
              name: "merchantId",
              in: "path",
              required: true,
              schema: { type: "string", examples: ["raposa-coffee", "raposa-shop", "solyd-cases"] },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/MerchantQuoteRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "Feasibility quote with item match, timing/shipping estimate, reasons, and alternatives.",
            },
            "400": {
              description: "Invalid JSON body or missing merchantId path parameter.",
            },
            "413": {
              description: "Quote payload exceeds the body size cap.",
            },
            "415": {
              description: "Request content type must be application/json.",
            },
            "404": {
              description: "Unknown merchant.",
            },
            "422": {
              description: "No catalog item matched the user intent.",
            },
          },
        },
      },
      "/api/agent/merchants/{merchantId}/orders": {
        post: {
          tags: ["Adapters"],
          summary: "Negotiator API: execute a merchant-scoped order after quote.",
          operationId: "createMerchantScopedAgentOrder",
          parameters: [
            {
              name: "merchantId",
              in: "path",
              required: true,
              schema: { type: "string", examples: ["raposa-coffee", "raposa-shop", "solyd-cases"] },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AgentOrderRequest" },
              },
            },
          },
          responses: {
            "201": {
              description: "Pickup order pass created after a feasible merchant quote.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/AgentOrderResponse" },
                },
              },
            },
            "202": {
              description: "Shipping or ecommerce checkout order accepted, but external checkout/payment adapter is still required.",
            },
            "400": {
              description: "Invalid JSON body or missing merchantId path parameter.",
            },
            "409": {
              description: "Merchant quote is infeasible; the agent must ask the user to accept an alternative before ordering.",
            },
            "413": {
              description: "Order payload exceeds the body size cap.",
            },
            "415": {
              description: "Request content type must be application/json.",
            },
            "404": {
              description: "Unknown merchant.",
            },
            "422": {
              description: "Quoted item cannot be converted into an order item.",
            },
            "503": {
              description: "Order persistence failed after quote validation.",
            },
          },
        },
      },
      "/api/agent/orders/{id}/verify-solana-pay": {
        post: {
          tags: ["Adapters"],
          summary: "Verify a configured Solana Pay SPL-token transaction and upgrade an existing agent order into a receipt.",
          operationId: "verifyAgentOrderSolanaPay",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", pattern: "^ord-[a-f0-9]{16}$" },
            },
          ],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SolanaPayVerificationRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "Solana Pay transaction verified or order was already receipted.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/SolanaPayVerificationResponse" },
                },
              },
            },
            "404": {
              description: "Order or confirmed reference transaction was not found.",
            },
            "401": {
              description: "Verifier token is required before Solana Pay verification or claim data access.",
            },
            "403": {
              description: "Verifier token is invalid.",
            },
            "422": {
              description: "SPL token setup is missing or referenced transaction does not match the order total.",
            },
            "503": {
              description: "Solana Pay testnet RPC or receipt issuance is not configured.",
            },
          },
        },
      },
      "/api/agent/shopify/products": {
        get: {
          tags: ["Adapters"],
          summary: "Optional adapter: search Shopify Storefront products for checkout creation.",
          operationId: "searchShopifyProductsForAgent",
          parameters: [
            {
              name: "query",
              in: "query",
              required: true,
              schema: { type: "string", examples: ["beanie"] },
            },
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 10, default: 5 },
            },
          ],
          responses: {
            "200": {
              description: "Shopify product variants available for agent checkout.",
            },
            "503": {
              description: "Shopify Storefront API is not configured.",
            },
          },
        },
      },
      "/api/agent/shopify/orders": {
        post: {
          tags: ["Adapters"],
          summary: "Optional adapter: create a Shopify checkout from a Personal Order Agent request.",
          operationId: "createShopifyAgentCheckout",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ShopifyAgentOrderRequest" },
              },
            },
          },
          responses: {
            "201": {
              description: "Adapter Jiagon order pass and Shopify checkout created.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ShopifyAgentOrderResponse" },
                },
              },
            },
            "422": {
              description: "No available Shopify variant matched the request and spending policy.",
            },
            "503": {
              description: "Shopify Storefront API is not configured.",
            },
          },
        },
      },
      "/api/merchant/orders/{id}/action": {
        post: {
          tags: ["Adapters"],
          summary: "Optional adapter: let a Merchant Take-Order Agent accept, reject, or mark an order paid and done.",
          operationId: "runMerchantTakeOrderAgentAction",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", pattern: "^ord-[a-f0-9]{16}$" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    action: {
                      type: "string",
                      enum: ["accept", "preparing", "paid_done", "reject", "cancel"],
                    },
                    actor: {
                      type: "string",
                      description: "Merchant staff or take-order agent identity.",
                    },
                  },
                  required: ["action"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Merchant-side action recorded; paid_done returns a claimable Jiagon receipt.",
            },
            "401": {
              description: "Invalid merchant dashboard key.",
            },
            "409": {
              description: "Order state cannot transition through the requested action.",
            },
          },
        },
      },
      "/api/webhooks/shopify/orders-paid": {
        post: {
          tags: ["Adapters"],
          summary: "Optional adapter: attach merchant-configured Shopify paid orders to Jiagon receipt memory.",
          operationId: "receiveShopifyPaidOrderReceiptAdapter",
          responses: {
            "200": {
              description: "Authenticated paid order accepted and converted into a claimable Jiagon receipt.",
            },
            "202": {
              description: "Authenticated webhook accepted but ignored because it is not a paid order Jiagon can parse.",
            },
            "401": {
              description: "Invalid Shopify HMAC signature.",
            },
            "503": {
              description: "Shopify webhook secret or receipt persistence is not configured.",
            },
          },
        },
      },
      "/api/webhooks/moonpay": {
        post: {
          tags: ["Adapters"],
          summary: "Optional adapter: attach merchant-configured MoonPay Commerce payments to Jiagon receipt memory.",
          operationId: "receiveMoonPayCommerceReceiptAdapter",
          responses: {
            "200": {
              description: "Authenticated successful payment accepted and attached to a Jiagon order receipt.",
            },
            "202": {
              description: "Authenticated webhook accepted but ignored because it is not a successful payment with a Jiagon orderId.",
            },
            "401": {
              description: "Invalid MoonPay bearer token or HMAC signature.",
            },
            "503": {
              description: "MoonPay shared token or receipt persistence is not configured.",
            },
          },
        },
      },
      "/api/agent/rerank": {
        post: {
          tags: ["Agent"],
          summary: "Rerank external place candidates with Jiagon receipt proof.",
          operationId: "rerankPlaceCandidatesWithJiagonProof",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RerankRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "Candidates ranked with Jiagon proof boosts.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/RerankResponse" },
                },
              },
            },
            "400": {
              description: "Invalid candidate request.",
            },
            "503": {
              description: "Receipt signal store unavailable.",
            },
          },
        },
      },
      "/api/agent/merchants/{merchantId}/trust": {
        get: {
          tags: ["Agent"],
          summary: "Get agent-readable merchant trust from verified commerce memory.",
          operationId: "getMerchantTrustProfile",
          parameters: [
            {
              name: "merchantId",
              in: "path",
              required: true,
              schema: { type: "string", examples: ["raposa-coffee"] },
            },
          ],
          responses: {
            "200": {
              description: "Merchant trust profile for agent recommendation and credit decisions.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/MerchantTrustResponse" },
                },
              },
            },
          },
        },
      },
      "/api/agent/proofs/{receiptHash}": {
        get: {
          tags: ["Agent"],
          summary: "Inspect a public receipt proof by receipt hash.",
          operationId: "getReceiptProof",
          parameters: [
            {
              name: "receiptHash",
              in: "path",
              required: true,
              schema: { type: "string", pattern: "^(0x)?[a-fA-F0-9]{64}$" },
            },
          ],
          responses: {
            "200": {
              description: "Public receipt proof with claim, mint, and credential status.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ReceiptProofResponse" },
                },
              },
            },
            "400": { description: "Invalid receipt hash." },
            "404": { description: "Receipt proof was not found." },
            "503": { description: "Receipt proof store unavailable." },
          },
        },
      },
      "/api/agent/credit-eligibility": {
        get: {
          tags: ["Agent"],
          summary: "Get purpose-bound credit eligibility for a Solana wallet.",
          operationId: "getPurposeBoundCreditEligibility",
          parameters: [
            {
              name: "owner",
              in: "query",
              required: true,
              schema: { type: "string" },
              description: "Solana wallet public key.",
            },
          ],
          responses: {
            "200": {
              description: "Purpose-bound credit eligibility from minted receipt credentials.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/CreditEligibilityResponse" },
                },
              },
            },
            "400": { description: "Missing or invalid Solana owner." },
            "503": { description: "Credit eligibility store unavailable." },
          },
        },
      },
      "/api/receipts/reviews": {
        get: {
          tags: ["Agent"],
          summary: "List published receipt-backed review signals.",
          operationId: "listPublishedReceiptReviews",
          parameters: [
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
            },
          ],
          responses: {
            "200": {
              description: "Published review signals and public credential metadata.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ReceiptReviewsResponse" },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        AgentDiscovery: {
          type: "object",
          properties: {
            name: { type: "string" },
            title: { type: "string" },
            description: { type: "string" },
            version: { type: "string" },
            homepage: { type: "string", format: "uri" },
            privacy: { type: "string" },
            humanDocs: { type: "string", format: "uri" },
            openapi: { type: "string", format: "uri" },
            wellKnown: { type: "string", format: "uri" },
            primaryUseCase: { type: "string" },
            capabilityOrder: { type: "array", items: { type: "string" } },
            adapterHandoff: { type: "object" },
            exampleUserIntent: { type: "string" },
            exampleProofCall: { $ref: "#/components/schemas/AgentExampleCall" },
            exampleTrustCall: { $ref: "#/components/schemas/AgentExampleCall" },
            exampleCreditEligibilityCall: { $ref: "#/components/schemas/AgentExampleCall" },
            exampleRerankCall: { $ref: "#/components/schemas/AgentExampleCall" },
            endpoints: { type: "object" },
            proofLevels: { type: "object" },
            architecture: { type: "object" },
            howAgentsUseThis: { type: "array", items: { type: "string" } },
            coffeeExample: { type: "object" },
            trustExample: { type: "object" },
            orderingExample: { type: "object" },
          },
        },
        AgentExampleCall: {
          type: "object",
          properties: {
            method: { type: "string", enum: ["GET", "POST"] },
            url: { type: "string" },
            body: { type: "object" },
          },
        },
        RecommendationResponse: {
          type: "object",
          properties: {
            query: { type: "string" },
            product: { type: "string" },
            dataSource: { type: "string", enum: ["postgres-merchant-signals", "empty"] },
            recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  branch: { type: "string" },
                  category: { type: "string" },
                  averageRating: { type: "number" },
                  verifiedVisits: { type: "integer" },
                  verifiedWallets: { type: "integer" },
                  proofLevel: { type: "object" },
                  reasons: { type: "array", items: { type: "string" } },
                  agentScore: { type: "number" },
                },
              },
            },
          },
        },
        RerankRequest: {
          type: "object",
          required: ["candidates"],
          properties: {
            query: { type: "string", examples: ["coffee irvine"] },
            candidates: {
              type: "array",
              minItems: 1,
              maxItems: 50,
              items: {
                type: "object",
                properties: {
                  provider: { type: "string", examples: ["google"] },
                  placeId: { type: "string", description: "Google place_id or equivalent provider id." },
                  name: { type: "string" },
                  branch: { type: "string" },
                  category: { type: "string" },
                  rating: { type: "number" },
                  distanceMeters: { type: "number" },
                  openNow: { type: "boolean" },
                },
              },
            },
          },
        },
        AgentOrderRequest: {
          type: "object",
          properties: {
            agentId: { type: "string", examples: ["seeker-demo-agent"] },
            userIntent: {
              type: "string",
              examples: ["I want a coffee. Keep it under $10 and use crypto pay if possible."],
              description: "Natural language order intent. Required when items is omitted.",
            },
            merchantId: { type: "string", examples: ["raposa-coffee"], default: "raposa-coffee" },
            items: {
              type: "array",
              description: "Optional structured menu items. When supplied, userIntent may be omitted.",
              items: {
                type: "object",
                properties: {
                  itemId: { type: "string", examples: ["iced-latte"] },
                  quantity: { type: "integer", minimum: 1, maximum: 20 },
                },
              },
            },
            maxSpendUsd: { type: "string", examples: ["10.00"] },
            paymentMode: { type: "string", enum: ["crypto_pay", "pay_at_counter", "helio_pay", "solana_pay"] },
          },
        },
        MerchantQuoteRequest: {
          type: "object",
          properties: {
            userIntent: {
              type: "string",
              examples: [
                "Get me an iced latte within 15 minutes under $10.",
                "Ship me Raposa whole bean Sunrise Blend under $25 this week.",
                "Find me a black MagSafe iPhone 16 case under $80 delivered this week.",
              ],
            },
            itemId: { type: "string", examples: ["iced-latte", "sunrise-blend-250g", "iphone-16-black-magsafe"] },
            maxSpendUsd: { type: "string", examples: ["10.00", "25.00", "80.00"] },
            deadlineMinutes: { type: "integer", minimum: 1, maximum: 1440 },
            readyBy: { type: "string", format: "date-time" },
            deliverByDays: { type: "integer", minimum: 1, maximum: 60 },
            quantity: { type: "integer", minimum: 1, maximum: 20 },
            fulfillment: { type: "string", examples: ["pickup", "shipping"] },
          },
        },
        AgentOrderResponse: {
          type: "object",
          properties: {
            product: { type: "string" },
            status: { type: "string", examples: ["order_pass_created"] },
            proofLevel: { type: "string", examples: ["order_intent_only"] },
            agent: { type: "object" },
            order: { type: "object" },
            pickup: { type: "object" },
            payment: { type: "object" },
            agentExecution: { type: "object" },
            staffDispatch: { type: "string", enum: ["sent", "skipped", "failed"] },
            urls: { type: "object" },
          },
        },
        SolanaPayVerificationRequest: {
          type: "object",
          properties: {
            signature: {
              type: "string",
              description: "Optional transaction signature. The server still scans the deterministic order reference.",
            },
            verifyToken: {
              type: "string",
              description: "Private verifier token returned only in the order creator's Solana Pay payment intent.",
            },
          },
        },
        SolanaPayVerificationResponse: {
          type: "object",
          properties: {
            accepted: { type: "boolean" },
            idempotent: { type: "boolean" },
            paymentProof: { type: "object" },
            claimToken: { type: ["string", "null"] },
            claimUrl: { type: ["string", "null"] },
            receipt: { type: ["object", "null"] },
            order: { type: "object" },
          },
        },
        ShopifyAgentOrderRequest: {
          type: "object",
          properties: {
            agentId: { type: "string", examples: ["shopify-demo-agent"] },
            userIntent: { type: "string", examples: ["Buy a beanie under $100 with Solana Pay."] },
            query: { type: "string", examples: ["beanie"] },
            variantId: { type: "string", description: "Optional Shopify Storefront variant id." },
            quantity: { type: "integer", minimum: 1, maximum: 20, default: 1 },
            maxSpendUsd: { type: "string", examples: ["100.00"] },
          },
        },
        ShopifyAgentOrderResponse: {
          type: "object",
          properties: {
            product: { type: "string" },
            status: { type: "string", examples: ["shopify_checkout_created"] },
            agent: { type: "object" },
            shopify: { type: "object" },
            order: { type: "object" },
            next: { type: "array", items: { type: "string" } },
          },
        },
        RerankResponse: {
          type: "object",
          properties: {
            query: { type: "string" },
            product: { type: "string" },
            usage: { type: "string" },
            ranked: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  placeId: { type: ["string", "null"] },
                  name: { type: "string" },
                  baseScore: { type: "number" },
                  jiagonBoost: { type: "number" },
                  agentScore: { type: "number" },
                  jiagonProof: { type: "object" },
                  reasons: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
        MerchantTrustResponse: {
          type: "object",
          properties: {
            product: { type: "string" },
            merchant: { type: "object" },
            agentTrust: {
              type: "object",
              properties: {
                score: { type: "integer", minimum: 0, maximum: 100 },
                label: { type: "string", enum: ["high", "medium", "early", "insufficient_data"] },
                shouldBoostRecommendation: { type: "boolean" },
                canUnlockReceiptGatedReview: { type: "boolean" },
                purposeBoundCreditEligible: { type: "boolean" },
              },
            },
            commerceMemory: { type: "object" },
            proofBoundary: { type: "object" },
            persistence: { type: "object" },
            nextAgentActions: { type: "array", items: { type: "string" } },
          },
        },
        ReceiptProofResponse: {
          type: "object",
          properties: {
            product: { type: "string" },
            usage: { type: "string" },
            configured: { type: "boolean" },
            proofBoundary: { type: "object" },
            proofLevel: { type: "object" },
            receipt: {
              type: "object",
              properties: {
                id: { type: "string" },
                merchantId: { type: "string" },
                receiptHash: { type: "string" },
                status: { type: "string" },
                mintStatus: { type: "string" },
                credentialId: { type: ["string", "null"] },
                credentialTx: { type: ["string", "null"] },
                solanaOwner: { type: ["string", "null"] },
                creditUnlockedCents: { type: "integer" },
              },
            },
          },
        },
        CreditEligibilityResponse: {
          type: "object",
          properties: {
            product: { type: "string" },
            owner: { type: "string" },
            usage: { type: "string" },
            proofBoundary: { type: "object" },
            purposeBoundCredit: {
              type: "object",
              properties: {
                eligible: { type: "boolean" },
                unlockedCreditCents: { type: "integer" },
                unlockedCreditUsd: { type: "string" },
                mintedReceiptCount: { type: "integer" },
                receiptIds: { type: "array", items: { type: "string" } },
                maxDemoCreditCents: { type: "integer" },
                allowedPurpose: { type: "string" },
              },
            },
            persistence: { type: "object" },
          },
        },
        ReceiptReviewsResponse: {
          type: "object",
          properties: {
            product: { type: "string" },
            privacy: { type: "string" },
            reviews: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  merchant: { type: "string" },
                  branch: { type: "string" },
                  rating: { type: "integer" },
                  proofLevel: { type: "string" },
                  publicProofId: { type: "string" },
                  credentialChain: { type: "string" },
                  credentialTx: { type: ["string", "null"] },
                  dataHash: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    "x-agent-example": {
      user: "I want coffee near Irvine. Recommend somewhere reliable.",
      call: `GET ${origin}/api/agent/recommendations?query=coffee%20irvine&limit=3`,
      rerankCall: `POST ${origin}/api/agent/rerank with Google Places candidates`,
      trustCall: `GET ${origin}/api/agent/merchants/raposa-coffee/trust`,
      receiptProofCall: `GET ${origin}/api/agent/proofs/{receiptHash}`,
      creditEligibilityCall: `GET ${origin}/api/agent/credit-eligibility?owner=${sampleSolanaOwner}`,
      decision: "Use Google or another place graph for candidates; use Jiagon agentScore, trust profile, receipt proof, and credit eligibility as verified commerce memory.",
    },
  };
}

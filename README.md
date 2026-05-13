# Jiagon

Jiagon is an agent service/API for the YC Call My Agent Hackathon. It gives
personal agents a narrow way to negotiate with supported merchants, create a
feasible order handoff, and leave receipt proof after fulfillment.

The product goal is narrow:

```txt
user asks for an outcome
-> Jiagon checks merchant capabilities
-> Jiagon quotes price / time / stock constraints
-> Jiagon creates the order handoff only if feasible
-> merchant fulfills
-> Jiagon leaves receipt proof
```

Live app: [jiagon.vercel.app](https://jiagon.vercel.app)

## Hackathon Positioning

Jiagon is not a coffee chatbot, POS replacement, payment processor, or lending
app. It is a merchant negotiator/doer agent exposed through API, CLI, and a
merchant terminal. The website is only a demo, debug, and support surface.

The receipt layer remains important, but for this YC demo it is the proof that
the agent did real work, not the headline.

## Service Flow

Primary Raposa Coffee flow:

```txt
User: "Get me an iced latte from Raposa under $10, ready in 15 minutes."
-> personal agent calls Jiagon
-> Jiagon quotes Raposa capability, item, total, and pickup ETA
-> if feasible, Jiagon creates an order pass
-> Raposa staff sees the order in the merchant terminal
-> staff marks Paid + Done
-> customer claims the receipt
```

Secondary SOLYD flow:

```txt
User: "Find me a black MagSafe iPhone case under $90 and ship this week."
-> Jiagon checks catalog, stock, price, and shipping estimate
-> if feasible, Jiagon returns checkout-adapter-required handoff
-> Shopify / MoonPay Commerce can later upgrade the receipt proof
```

## Core Surfaces

- `/api/agent` and `/openapi.json` — agent-readable discovery.
- `pnpm agent` — CLI path for the Call My Agent demo.
- `/merchant` — merchant terminal for order fulfillment and receipt issuance.
- `/agent-order` — demo/debug UI for natural language, quote, and order handoff.
- `/` — positioning page, not the product surface.

Demoted surfaces for this hackathon:

- `/passport` — receipt proof support surface, not the first-run product.
- `/credit` — future purpose-bound credit, not part of the YC demo spine.
- `/trust-api` — infrastructure surface, not the first-run demo.
- Solana Bubblegum, Shopify, MoonPay, Helio, and Solayer adapters — optional
  proof upgrades, not required for the core demo.

## Agent APIs

Quote first:

```bash
curl -X POST https://jiagon.vercel.app/api/agent/merchants/raposa-coffee/quote \
  -H "content-type: application/json" \
  -d '{
    "userIntent": "Get me an iced latte under $10, ready in 15 minutes",
    "maxSpendUsd": "10.00",
    "deadlineMinutes": 15
  }'
```

Create an order only when the quote is feasible:

```bash
curl -X POST https://jiagon.vercel.app/api/agent/merchants/raposa-coffee/orders \
  -H "content-type: application/json" \
  -d '{
    "agentId": "yc-demo-agent",
    "userIntent": "Get me an iced latte under $10, ready in 15 minutes",
    "maxSpendUsd": "10.00",
    "deadlineMinutes": 15,
    "paymentMode": "pay_at_counter"
  }'
```

CLI demo:

```bash
pnpm agent "Get me an iced latte from Raposa under 10 dollars, ready in 15 minutes"
pnpm agent "Find me a black MagSafe iPhone 16 case from SOLYD under $90 and ship this week"
```

## Negotiation Behavior

Jiagon should not blindly place orders.

It must:

- reject impossible budgets;
- reject impossible pickup / shipping windows;
- reject invalid quantities;
- check shipping inventory against requested quantity;
- suggest alternatives when possible;
- avoid claiming a receipt exists before fulfillment or payment proof.

## Proof Ladder

Jiagon separates facts from claims:

```txt
L0 order_intent_only
L1 merchant_accepted
L2 merchant_completed
L3 customer_claimed
L4 payment_backed
L5 payment_fulfillment_claim
```

For the Call My Agent demo, L0 to L3 is enough:

```txt
agent intent
-> merchant order handoff
-> staff fulfillment
-> claimable receipt
```

Payment-backed L4/L5 proof can come later through Shopify, MoonPay Commerce,
Solana Pay, or Helio.

## Local Development

```bash
pnpm install
pnpm dev
pnpm build
```

Optional local environment:

```bash
DATABASE_URL=postgres://...
JIAGON_MERCHANT_ISSUER_KEY=use-a-random-demo-merchant-key
JIAGON_MERCHANT_RECEIPT_SIGNING_SECRET=use-a-random-receipt-signing-secret
TELEGRAM_BOT_TOKEN=...
TELEGRAM_MERCHANT_CHAT_ID=...
```

Without `DATABASE_URL`, the app uses local demo memory. That is acceptable for
the hackathon demo, but persisted merchant queues need Postgres.

## Current Merchant Targets

| Merchant | Demo role | Status |
| --- | --- | --- |
| Raposa Coffee | pickup order negotiator | best live demo path |
| SOLYD | ecommerce stock / shipping negotiator | adapter mock until checkout webhook is connected |
| MUME Taipei | future dining deposit / premium booking | out of YC demo scope |

## What To Say

> Jiagon is a merchant negotiator agent. It helps personal agents get real-world
> purchases done by checking constraints, coordinating with merchants, and
> leaving receipt proof after fulfillment.

## What Not To Say

- "Jiagon is a POS replacement."
- "Jiagon is a lending app."
- "Jiagon mints every receipt onchain by default."
- "Jiagon can monitor arbitrary Shopify, MoonPay, or POS merchants without
  merchant approval."

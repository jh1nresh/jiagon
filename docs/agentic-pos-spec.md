# Jiagon Personal Agent Commerce Rail Spec

## Product Shape

Jiagon is a personal agent commerce rail for real-world merchants. The product starts with order intake, external wallet payment approval, merchant fulfillment, verified receipts, and credit memory for future purpose-bound dining deposits.

```text
personal agent receives intent
-> agent orders through Jiagon
-> agent/user approves external wallet payment
-> merchant fulfills
-> Jiagon issues verified receipt
-> receipt becomes passport memory
-> optional Bubblegum receipt credential
-> future agent uses credit memory
-> purpose-bound dining deposit
```

The goal is not to replace Square, Toast, or a full POS. The MVP proves that an agent-mediated purchase can become a merchant-fulfilled receipt memory object that future agents can use for underwriting.

## Current Demo Links

- Live app: https://jiagon.vercel.app
- Agent order demo: https://jiagon.vercel.app/agent-order
- Raposa NFC claim station: https://jiagon.vercel.app/tile/raposa-coffee
- Merchant dashboard: https://jiagon.vercel.app/merchant
- Passport: https://jiagon.vercel.app/passport
- Credit: https://jiagon.vercel.app/credit

## Product Boundary

In scope:

- Order intent from a personal agent API first; Telegram remains a pilot merchant terminal.
- Merchant-facing order queue.
- Agent-readable pickup result returned to the agent: merchant, pickup code, ETA, and user-facing instructions.
- Optional external Solana wallet payment request for the agent/user wallet. Helio is the hosted checkout path; official Solana Pay transfer URLs are the fallback.
- Merchant completion creates a claimable receipt.
- NFC/QR receipt claim after fulfillment.
- Claimed receipt can be minted and used for credit unlock.

Out of scope for the first pass:

- Automated payment verification.
- Inventory management.
- Tax, tips, refunds, tables, kitchen display, printer integrations.
- Payment settlement inside Telegram.

## Proof Ladder

Jiagon should preserve proof levels:

```text
L0 order_intent_only          agent requested an order
L1 merchant_accepted          merchant accepted the order
L2 merchant_completed         merchant marked fulfilled
L3 passport_claimed           receipt claimed by NFC / QR and bound to passport identity
L4 payment_backed             Solana Pay / Helio / card payment verified
L5 verified_purchase_memory   payment + fulfillment + passport claim
```

Early event pilots can use L2/L3. Credit scoring should weight L4/L5 higher when payment proof is available.

## MVP Sequence

### PR 1: Order Intake Core

- Add `POST /api/merchant/orders`.
- Add `GET /api/merchant/orders?merchantId=...` for queue consumers.
- Add durable merchant order store with database persistence and local memory fallback.
- Update `/tile/{merchant}` into a customer order page.
- Store source as `tile` now; later `telegram` can use the same API.

### PR 2: Merchant Queue

- Show pending orders inside `/merchant`.
- Add status actions: accept, complete, cancel.

### PR 3: Complete Order -> Claimable Receipt

- Add `POST /api/merchant/orders/{id}/complete`.
- Completion calls existing merchant receipt issuer.
- Merchant dashboard receives a claim URL and locally generated QR code.
- NFC is the receipt pickup surface: the physical card/sticker points customers to `/tile/{merchant}`, where they enter the pickup code and Jiagon resolves it to the completed order's one-time `/claim/{token}` link.
- QR/claim link remains the direct per-receipt fallback because each completed order has a unique claim token.

### PR 4: Telegram Entry

- Add `POST /api/telegram/webhook` for Telegram bot command integration.
- Telegram creates the same order payload as the agent API.
- Bot returns pickup code and tells the customer the order is not a receipt yet.
- Bot can post each new order into the merchant Telegram group.
- Merchant staff can tap `[Fulfilled]` in Telegram to complete the order and create the receipt claim link.

### PR 4.5: Personal Agent Ordering

- Add `POST /api/agent/orders`.
- A personal agent can send natural language or structured menu items.
- The endpoint enforces a max-spend policy before creating the order pass.
- The response returns pickup code, pickup estimate, merchant staff dispatch
  status, NFC claim station URL, receipt-memory path, and optional external Solana
  payment request details.
- The response also returns `agentExecution`, which separates what the agent
  returns from what it handled.
- Payment requests are not yet payment-proof oracles; until a webhook or
  transaction query verifies payment, merchant fulfillment remains the source of
  receipt proof.

### PR 5: Credit Connection Polish

- Passport shows order source and proof level.
- Credit page distinguishes order-intent, merchant-completed, passport-claimed, and payment-backed receipts.

### PR 6: Pilot Metrics + Memo

- L3 receipt record schema tracks `merchant_completed` through `status=completed` and `customer_claimed` through `receiptClaimedAt`.
- Pilot dashboard tracks QR opens, order starts, confirmed orders, merchant done, claimed receipts, reviews, and estimated GMV.
- Event credit memo summarizes orders, L2/L3 proof, receipt-gated review count, next proof upgrade, and suggested purpose-bound credit path after the event.

## Demo Flow

```text
User asks personal agent: get me a coffee under $10
-> agent calls POST /api/agent/orders with maxSpendUsd and paymentMode
-> Jiagon selects Raposa, creates the order, and prepares external wallet approval
-> Jiagon returns pickup location, pickup code, pickup ETA, and optional Solana payment request
-> merchant Telegram group receives the order
-> agent/user approves payment if configured, otherwise counter payment is fallback
-> merchant fulfills
-> Jiagon issues verified receipt
-> agent/user taps NFC receipt card at pickup
-> pickup code resolves the fulfilled order
-> Jiagon opens the matching /claim/{token}
-> receipt is bound to passport identity
-> Passport shows verified purchase memory
-> Bubblegum receipt cNFT can be minted
-> future agent can use credit memory for a purpose-bound dining deposit
-> event credit memo summarizes the pilot after Consensus
```

## Strongest Demo Script

Lead with one sentence:

```text
Jiagon lets a personal agent order from a real merchant, prepare payment approval,
verify fulfillment, and turn the receipt into credit memory for future
purpose-bound dining deposits.
```

Show the product in this order:

```text
1. /agent-order
   Use the default coffee prompt and choose agent wallet approval.
   The point: the user gives intent; the agent calls commerce infrastructure.

2. Payment
   Use Helio Solana checkout when HELIO_PAYLINK_ID is configured.
   If Helio is not configured, use the official Solana Pay devnet transfer URL.
   The point: this is an approval-bound payment request, not a Privy payment.

3. /merchant
   Staff sees the agent-created Raposa order and marks it fulfilled.
   The point: merchant fulfillment upgrades L0 order intent into L2 merchant
   completed receipt proof.

4. /tile/raposa-coffee
   The agent/user taps the NFC station, enters the pickup code, and claims the receipt.
   The point: physical presence plus passport claim upgrades the receipt to L3.

5. /passport and /credit
   Passport shows verified purchase memory. Credit shows the purpose-bound
   restaurant deposit policy that future agents can use.
   The point: this is undercollateralized credit constrained to a real purchase
   purpose, not open-ended cash borrowing.
```

The personal agent API is the product surface. Telegram remains the lightweight
merchant terminal for the pilot. NFC is the physical receipt-claim surface. The
backend primitive is agent order intent plus merchant fulfillment plus receipt
memory.

## Onsite Raposa Plan

First day on site:

- Ask Raposa whether they are comfortable with a small demo that does not touch their POS or payments.
- Explain the pilot loop: agent creates order, payment is approved externally or at the counter, staff marks fulfilled, and NFC claim turns the order into receipt memory.
- Confirm where an NFC sticker can sit: counter, pickup area, or a demo card carried by us.
- Test one staff-assisted order end to end with a small item.
- If the shop is busy, keep it as a self-contained demo with our own phone and NFC card, then ask only for feedback.

# Jiagon Agentic POS Spec

## Product Shape

Jiagon Agentic POS is the order-intake layer for real-world commerce. Jiagon remains the receipt passport and credit layer.

```text
personal agent order API / Telegram entry
-> merchant order queue
-> merchant fulfillment
-> NFC / QR receipt claim
-> Jiagon receipt passport
-> onchain receipt credential
-> credit passport update
-> purpose-bound credit
```

The goal is not to replace Square, Toast, or a full POS. The MVP proves that an agent-mediated order can become a merchant-issued, customer-claimed receipt that feeds Jiagon reputation and credit.

## Current Demo Links

- Vercel preview: https://jiagon-git-codex-nfc-receipt-claim-station-jhinreshs-projects.vercel.app
- Raposa NFC claim station: https://jiagon-git-codex-nfc-receipt-claim-station-jhinreshs-projects.vercel.app/tile/raposa-coffee
- Merchant dashboard: https://jiagon-git-codex-nfc-receipt-claim-station-jhinreshs-projects.vercel.app/merchant
- Passport: https://jiagon-git-codex-nfc-receipt-claim-station-jhinreshs-projects.vercel.app/passport

After PR 61 merges, replace these preview URLs with the production Vercel domain before writing NFC stickers.

## Product Boundary

In scope:

- Customer order intent from a personal agent API or Telegram.
- Merchant-facing order queue.
- Pickup code and pickup ETA returned to the agent.
- Optional Crypto Pay on Solana request for the agent/user wallet. Helio is the hosted Solana checkout path; direct Solana Pay is the fallback.
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
L0 order_intent_only          customer or agent requested an order
L1 merchant_accepted          merchant accepted the order
L2 merchant_completed         merchant marked fulfilled
L3 customer_claimed           customer claimed by NFC / QR with Privy
L4 payment_backed             Stripe / card / USDC payment verified
L5 payment_fulfillment_claim  payment + fulfillment + customer claim
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
- Telegram creates the same order payload as `/tile/{merchant}`.
- Bot returns pickup code and tells the customer to pay at the counter.
- Bot can post each new order into the merchant Telegram group.
- Merchant staff can tap `[Paid + Done]` in Telegram to complete the order and create the receipt claim link.

### PR 4.5: Personal Agent Ordering

- Add `POST /api/agent/orders`.
- A user's personal agent can send natural language or structured menu items.
- The endpoint enforces a max-spend policy before creating the order pass.
- The response returns pickup code, pickup estimate, merchant staff dispatch
  status, NFC claim station URL, and optional Crypto Pay on Solana request details.
- Crypto Pay test requests are not yet payment-proof oracles; until
  a webhook or transaction query verifies payment, staff still taps `Paid + Done`
  after fulfillment.

### PR 5: Credit Connection Polish

- Passport shows order source and proof level.
- Credit page distinguishes order-intent, merchant-completed, customer-claimed, and payment-backed receipts.

### PR 6: Pilot Metrics + Memo

- L3 receipt record schema tracks `merchant_completed` through `status=completed` and `customer_claimed` through `receiptClaimedAt`.
- Pilot dashboard tracks QR opens, order starts, confirmed orders, merchant done, claimed receipts, reviews, and estimated GMV.
- Event credit memo summarizes orders, L2/L3 proof, receipt-gated review count, next proof upgrade, and suggested purpose-bound credit path after the event.

## Demo Flow

```text
User asks personal agent: order one iced latte at Raposa Coffee
-> agent calls POST /api/agent/orders with maxSpendUsd and paymentMode
-> Jiagon returns pickup code, pickup ETA, and optional Crypto Pay on Solana request
-> merchant Telegram group receives the order
-> user pays through Crypto Pay if configured, otherwise pays normally at counter
-> staff taps Paid + Done
-> Jiagon issues claimable receipt
-> user taps NFC receipt card at pickup
-> user enters pickup code
-> Jiagon opens the matching /claim/{token}
-> user claims receipt with Privy
-> Passport shows merchant receipt
-> Bubblegum receipt cNFT can be minted
-> Credit unlock / draw / repay flow works
-> event credit memo summarizes the pilot after Consensus
```

## Strongest Demo Script

Lead with one sentence:

```text
Jiagon lets your personal agent buy from a real merchant, turns the fulfilled
payment into a Solana receipt passport, and uses that receipt history to unlock
purpose-bound credit.
```

Show the product in this order:

```text
1. /agent-order
   Choose Crypto Pay on Solana and call the API.
   The point: this is an agent calling commerce infrastructure, not a user
   filling out a checkout form.

2. Payment
   Use Helio Solana checkout when HELIO_PAYLINK_ID is configured.
   If Helio is not configured, use the direct Solana Pay devnet URL.
   The point: Helio and Solana Pay are one Crypto Pay rail for the demo.

3. /merchant
   Staff sees the agent-created Raposa order and taps Paid + Done.
   The point: merchant fulfillment upgrades L0 order intent into L2 merchant
   completed receipt proof.

4. /tile/raposa-coffee
   Customer taps the NFC station, enters the pickup code, and claims the receipt.
   The point: physical presence plus customer claim upgrades the receipt to L3.

5. /passport and /credit
   Passport shows the verified receipt. Credit shows purpose-bound restaurant
   deposit credit unlocked from receipt history.
   The point: this is undercollateralized credit constrained to a real purchase
   purpose, not open-ended cash borrowing.
```

The personal agent API is the cleanest agentic order surface. Telegram remains
the customer/staff pilot surface. NFC is optional for the payment-backed future,
but useful onsite as a physical presence and receipt-claim surface. The backend
primitive is order intent plus merchant-issued receipt.

## Onsite Raposa Plan

First day on site:

- Ask Raposa whether they are comfortable with a small demo that does not touch their POS or payments.
- Explain the customer loop: order in Telegram, pay normally at counter, staff taps Paid + Done, customer taps NFC and enters pickup code to claim a digital receipt.
- Confirm where an NFC sticker can sit: counter, pickup area, or a demo card carried by us.
- Test one staff-assisted order end to end with a small item.
- If the shop is busy, keep it as a self-contained demo with our own phone and NFC card, then ask only for feedback.

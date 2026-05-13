"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type MerchantId = "raposa-coffee" | "solyd-cases";
type PaymentMode = "crypto_pay" | "pay_at_counter";

type QuoteResponse = {
  ok?: boolean;
  error?: string;
  merchant?: {
    id: string;
    name: string;
    fulfillment: string;
  };
  quote?: {
    feasible: boolean;
    decision: string;
    item: {
      id: string;
      name: string;
      quantity: number;
      amountUsd: string;
      subtotalUsd: string;
    };
    constraints: {
      maxSpendUsd: string | null;
      deadlineMinutes: number | null;
      deliverByDays: number | null;
    };
    estimate: {
      queueDepth: number;
      queueConfigured: boolean;
      readyInMinutes: number | null;
      readyAt: string | null;
      shippingDays: number | null;
    };
    reasons: string[];
    alternatives: Array<{
      itemId: string;
      name: string;
      amountUsd: string;
      reason: string;
    }>;
  };
  next?: string;
};

type OrderResponse = {
  status?: string;
  proofLevel?: string;
  error?: string;
  quote?: QuoteResponse["quote"];
  order?: {
    id: string;
    pickupCode?: string;
    subtotalUsd: string;
    receiptClaimUrl?: string | null;
  };
  pickup?: {
    minutes: number | null;
    readyAt: string | null;
    label: string;
  };
  shipping?: {
    estimatedDays: number | null;
    deliveryWindowSatisfied: boolean;
  };
  payment?: {
    mode?: PaymentMode;
    status?: string;
    provider?: string;
    note?: string;
  };
  adapterHandoff?: {
    personalNegotiatorAgent?: {
      status: string;
      handled: string[];
    };
    merchantTakeOrderAgent?: {
      status: string;
      channels: string[];
    };
    receiptPassport?: {
      status: string;
      next: string;
    };
  };
  customerInstructions?: string[];
  urls?: {
    nfcStation?: string;
    pairPhoneForNfcClaim?: string;
  };
  next?: string;
};

const merchants: Record<MerchantId, {
  name: string;
  mode: string;
  defaultIntent: string;
  maxSpendUsd: string;
  deadlineMinutes: string;
  deliverByDays: string;
}> = {
  "raposa-coffee": {
    name: "Raposa Coffee",
    mode: "Pickup",
    defaultIntent: "Get me an iced latte from Raposa under $10, ready in 15 minutes.",
    maxSpendUsd: "10.00",
    deadlineMinutes: "15",
    deliverByDays: "",
  },
  "solyd-cases": {
    name: "SOLYD",
    mode: "Shipping",
    defaultIntent: "Find me a black MagSafe iPhone 16 case from SOLYD under $90 and ship it this week.",
    maxSpendUsd: "90.00",
    deadlineMinutes: "",
    deliverByDays: "7",
  },
};

const paymentModes: Array<{ id: PaymentMode; label: string; detail: string }> = [
  {
    id: "pay_at_counter",
    label: "Merchant payment",
    detail: "Best for the live cafe demo. Staff collects payment and marks fulfillment.",
  },
  {
    id: "crypto_pay",
    label: "Agent wallet intent",
    detail: "Prepares the route for Solana / checkout adapters when configured.",
  },
];

function requestBody(input: {
  merchantId: MerchantId;
  userIntent: string;
  maxSpendUsd: string;
  deadlineMinutes: string;
  deliverByDays: string;
  quantity: string;
  paymentMode: PaymentMode;
}) {
  return {
    agentId: "yc-demo-agent",
    userIntent: input.userIntent,
    maxSpendUsd: input.maxSpendUsd,
    quantity: Number(input.quantity) || 1,
    ...(input.deadlineMinutes ? { deadlineMinutes: Number(input.deadlineMinutes) } : {}),
    ...(input.deliverByDays ? { deliverByDays: Number(input.deliverByDays) } : {}),
    paymentMode: input.paymentMode,
  };
}

function statusText(value: string | undefined) {
  return value ? value.replace(/_/g, " ") : "not started";
}

export default function AgentOrderDemoPage() {
  const [merchantId, setMerchantId] = useState<MerchantId>("raposa-coffee");
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("pay_at_counter");
  const [userIntent, setUserIntent] = useState(merchants["raposa-coffee"].defaultIntent);
  const [maxSpendUsd, setMaxSpendUsd] = useState(merchants["raposa-coffee"].maxSpendUsd);
  const [deadlineMinutes, setDeadlineMinutes] = useState(merchants["raposa-coffee"].deadlineMinutes);
  const [deliverByDays, setDeliverByDays] = useState(merchants["raposa-coffee"].deliverByDays);
  const [quantity, setQuantity] = useState("1");
  const [busy, setBusy] = useState<"quote" | "order" | null>(null);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [order, setOrder] = useState<OrderResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const body = useMemo(
    () => requestBody({ merchantId, userIntent, maxSpendUsd, deadlineMinutes, deliverByDays, quantity, paymentMode }),
    [deadlineMinutes, deliverByDays, maxSpendUsd, merchantId, paymentMode, quantity, userIntent],
  );

  function chooseMerchant(nextMerchantId: MerchantId) {
    const merchant = merchants[nextMerchantId];
    setMerchantId(nextMerchantId);
    setUserIntent(merchant.defaultIntent);
    setMaxSpendUsd(merchant.maxSpendUsd);
    setDeadlineMinutes(merchant.deadlineMinutes);
    setDeliverByDays(merchant.deliverByDays);
    setQuote(null);
    setOrder(null);
    setError(null);
  }

  async function callJson<T>(path: string, nextBusy: "quote" | "order") {
    setBusy(nextBusy);
    setError(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as T & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Jiagon request failed.");
      return payload;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Jiagon request failed.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function getQuote() {
    setOrder(null);
    const payload = await callJson<QuoteResponse>(`/api/agent/merchants/${merchantId}/quote`, "quote");
    if (payload) setQuote(payload);
  }

  async function createOrder() {
    const payload = await callJson<OrderResponse>(`/api/agent/merchants/${merchantId}/orders`, "order");
    if (payload) {
      setOrder(payload);
      if (payload.quote) setQuote({ quote: payload.quote });
    }
  }

  const quoteFeasible = quote?.quote?.feasible === true;

  return (
    <main className="negotiator-page">
      <style>{`
        .negotiator-page {
          min-height: 100vh;
          padding: 28px clamp(18px, 4vw, 56px) 54px;
          background:
            radial-gradient(circle at 14% 0%, oklch(0.98 0.008 105) 0 260px, transparent 420px),
            linear-gradient(135deg, oklch(0.95 0.016 115) 0%, oklch(0.91 0.014 92) 58%, oklch(0.90 0.018 128) 100%);
        }
        .negotiator-shell { max-width: 1360px; margin: 0 auto; }
        .negotiator-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 18px;
          margin-bottom: 30px;
        }
        .negotiator-brand { display: flex; align-items: center; gap: 14px; }
        .negotiator-mark {
          width: 52px;
          height: 52px;
          position: relative;
          display: grid;
          place-items: center;
          border: 3px solid var(--verified);
          border-radius: 10px;
          background: var(--receipt);
          color: var(--verified);
          font-family: Georgia, serif;
          font-size: 36px;
          font-weight: 800;
          line-height: .9;
        }
        .negotiator-mark b {
          position: absolute;
          right: -7px;
          top: -7px;
          width: 22px;
          height: 22px;
          display: grid;
          place-items: center;
          border-radius: 999px;
          background: oklch(0.16 0.01 95);
          color: white;
          font-size: 13px;
          font-family: var(--ui);
        }
        .negotiator-wordmark {
          font-family: var(--display);
          font-size: 36px;
          line-height: .92;
          color: var(--verified);
        }
        .negotiator-sub,
        .negotiator-kicker,
        .negotiator-label {
          font-family: var(--mono);
          font-size: 10px;
          letter-spacing: .9px;
          text-transform: uppercase;
          color: var(--ink-muted);
        }
        .negotiator-sub { margin-top: 4px; }
        .negotiator-nav { display: flex; flex-wrap: wrap; gap: 8px; }
        .negotiator-nav a {
          min-height: 34px;
          display: inline-flex;
          align-items: center;
          padding: 0 12px;
          border-radius: 6px;
          border: .5px solid var(--rule);
          color: var(--ink-muted);
          background: oklch(0.985 0.005 95 / .76);
          text-decoration: none;
          font-size: 13px;
          font-weight: 800;
        }
        .negotiator-nav a:hover { color: var(--verified); background: var(--verified-soft); }
        .negotiator-hero {
          display: grid;
          grid-template-columns: minmax(340px, .88fr) minmax(420px, 1.12fr);
          gap: 18px;
          align-items: start;
        }
        .negotiator-card {
          border: .5px solid var(--rule);
          border-radius: 8px;
          background: var(--receipt);
          padding: 18px;
          box-shadow: 0 1px 0 rgba(24,24,24,.05), 0 8px 24px rgba(24,24,24,.045);
        }
        .negotiator-title {
          margin: 10px 0 0;
          font-family: var(--display);
          font-size: clamp(42px, 6vw, 78px);
          font-weight: 400;
          font-style: italic;
          line-height: .92;
          color: var(--ink);
        }
        .negotiator-copy {
          margin: 16px 0 0;
          color: var(--ink-muted);
          font-size: 16px;
          line-height: 1.55;
        }
        .negotiator-form { display: grid; gap: 14px; margin-top: 20px; }
        .negotiator-field { display: grid; gap: 7px; }
        .negotiator-field label {
          color: var(--ink);
          font-size: 13px;
          font-weight: 900;
        }
        .negotiator-field textarea,
        .negotiator-field input {
          width: 100%;
          border: .5px solid var(--rule);
          border-radius: 8px;
          background: var(--surface);
          color: var(--ink);
          font: inherit;
          padding: 12px;
          outline: none;
        }
        .negotiator-field textarea { min-height: 112px; resize: vertical; line-height: 1.5; }
        .negotiator-field textarea:focus,
        .negotiator-field input:focus { border-color: var(--verified); box-shadow: 0 0 0 3px var(--verified-soft); }
        .negotiator-button-grid,
        .negotiator-small-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }
        .negotiator-choice {
          border: .5px solid var(--rule);
          border-radius: 8px;
          background: var(--surface);
          color: var(--ink);
          padding: 12px;
          text-align: left;
          cursor: pointer;
        }
        .negotiator-choice[data-active="true"] {
          border-color: var(--verified);
          background: var(--verified-soft);
        }
        .negotiator-choice strong { display: block; font-size: 13px; }
        .negotiator-choice span {
          display: block;
          margin-top: 6px;
          color: var(--ink-muted);
          font-size: 11px;
          line-height: 1.35;
        }
        .negotiator-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
        .negotiator-primary,
        .negotiator-secondary {
          min-height: 46px;
          border-radius: 8px;
          font-weight: 900;
          cursor: pointer;
        }
        .negotiator-primary {
          border: .5px solid var(--verified);
          background: var(--verified);
          color: var(--panel-text);
        }
        .negotiator-secondary {
          border: .5px solid var(--rule);
          background: var(--surface);
          color: var(--ink);
        }
        .negotiator-primary:disabled,
        .negotiator-secondary:disabled { opacity: .58; cursor: wait; }
        .negotiator-code {
          margin: 0;
          padding: 14px;
          border-radius: 8px;
          background: oklch(0.21 0.026 135);
          color: var(--panel-text);
          font-family: var(--mono);
          font-size: 11px;
          line-height: 1.65;
          overflow: auto;
          white-space: pre-wrap;
        }
        .negotiator-result { display: grid; gap: 14px; }
        .negotiator-summary {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }
        .negotiator-stat {
          min-height: 88px;
          padding: 13px;
          border-radius: 8px;
          border: .5px solid var(--rule);
          background: var(--surface);
        }
        .negotiator-stat span {
          display: block;
          color: var(--ink-muted);
          font-family: var(--mono);
          font-size: 10px;
          letter-spacing: .6px;
          text-transform: uppercase;
        }
        .negotiator-stat strong {
          display: block;
          margin-top: 10px;
          color: var(--ink);
          font-size: 20px;
        }
        .negotiator-panel {
          border-radius: 8px;
          border: .5px solid var(--rule);
          background: var(--surface);
          padding: 14px;
        }
        .negotiator-pill {
          display: inline-flex;
          align-items: center;
          min-height: 28px;
          padding: 0 9px;
          border-radius: 6px;
          background: var(--verified-soft);
          color: var(--verified);
          font-family: var(--mono);
          font-size: 10px;
          font-weight: 900;
          letter-spacing: .4px;
          text-transform: uppercase;
        }
        .negotiator-link-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
        .negotiator-link {
          min-height: 40px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0 12px;
          border-radius: 8px;
          border: .5px solid var(--rule);
          background: var(--receipt);
          color: var(--ink);
          text-decoration: none;
          font-weight: 900;
          cursor: pointer;
        }
        .negotiator-link.primary { background: var(--verified); color: var(--panel-text); border-color: var(--verified); }
        .negotiator-empty {
          border: .5px dashed var(--rule);
          border-radius: 8px;
          padding: 18px;
          color: var(--ink-muted);
          line-height: 1.5;
        }
        .negotiator-list { display: grid; gap: 8px; margin: 10px 0 0; padding: 0; list-style: none; }
        .negotiator-list li {
          padding: 10px 12px;
          border-radius: 8px;
          background: oklch(0.985 0.005 95 / .7);
          color: var(--ink-muted);
          font-size: 13px;
          line-height: 1.45;
        }
        .negotiator-error {
          padding: 12px;
          border-radius: 8px;
          border: .5px solid oklch(0.67 0.15 35);
          background: oklch(0.96 0.045 45);
          color: oklch(0.42 0.12 35);
          font-weight: 800;
        }
        @media (max-width: 980px) {
          .negotiator-top,
          .negotiator-hero { display: block; }
          .negotiator-nav { margin-top: 18px; }
          .negotiator-card + .negotiator-card { margin-top: 18px; }
          .negotiator-summary,
          .negotiator-button-grid,
          .negotiator-small-grid,
          .negotiator-actions { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="negotiator-shell">
        <header className="negotiator-top">
          <div className="negotiator-brand">
            <div className="negotiator-mark">J<b>✓</b></div>
            <div>
              <div className="negotiator-wordmark">Jiagon</div>
              <div className="negotiator-sub">Call My Agent demo</div>
            </div>
          </div>
          <nav className="negotiator-nav" aria-label="Agent negotiator demo">
            <Link href="/">Service</Link>
            <Link href="/api/agent">Agent API</Link>
            <Link href="/merchant">Merchant Terminal</Link>
          </nav>
        </header>

        <section className="negotiator-hero">
          <div className="negotiator-card">
            <div className="negotiator-kicker">Agent request console</div>
            <h1 className="negotiator-title">Quote first. Order only if feasible.</h1>
            <p className="negotiator-copy">
              This page is a thin operator surface for the same APIs an agent calls.
              Use it to test budget, pickup time, stock, and handoff behavior before
              showing the merchant terminal.
            </p>

            <div className="negotiator-form">
              <div className="negotiator-field">
                <label>Merchant target</label>
                <div className="negotiator-button-grid">
                  {(Object.keys(merchants) as MerchantId[]).map((id) => (
                    <button
                      className="negotiator-choice"
                      data-active={merchantId === id}
                      key={id}
                      type="button"
                      onClick={() => chooseMerchant(id)}
                    >
                      <strong>{merchants[id].name}</strong>
                      <span>{merchants[id].mode}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="negotiator-field">
                <label htmlFor="agent-intent">User intent</label>
                <textarea
                  id="agent-intent"
                  value={userIntent}
                  onChange={(event) => setUserIntent(event.target.value)}
                />
              </div>

              <div className="negotiator-small-grid">
                <div className="negotiator-field">
                  <label htmlFor="agent-max">Max spend</label>
                  <input
                    id="agent-max"
                    inputMode="decimal"
                    value={maxSpendUsd}
                    onChange={(event) => setMaxSpendUsd(event.target.value)}
                  />
                </div>
                <div className="negotiator-field">
                  <label htmlFor="agent-quantity">Quantity</label>
                  <input
                    id="agent-quantity"
                    inputMode="numeric"
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                  />
                </div>
              </div>

              <div className="negotiator-small-grid">
                <div className="negotiator-field">
                  <label htmlFor="agent-deadline">Pickup deadline minutes</label>
                  <input
                    id="agent-deadline"
                    inputMode="numeric"
                    value={deadlineMinutes}
                    onChange={(event) => setDeadlineMinutes(event.target.value)}
                    placeholder="15"
                  />
                </div>
                <div className="negotiator-field">
                  <label htmlFor="agent-delivery">Delivery days</label>
                  <input
                    id="agent-delivery"
                    inputMode="numeric"
                    value={deliverByDays}
                    onChange={(event) => setDeliverByDays(event.target.value)}
                    placeholder="7"
                  />
                </div>
              </div>

              <div className="negotiator-field">
                <label>Payment route</label>
                <div className="negotiator-button-grid">
                  {paymentModes.map((mode) => (
                    <button
                      className="negotiator-choice"
                      data-active={paymentMode === mode.id}
                      key={mode.id}
                      type="button"
                      onClick={() => setPaymentMode(mode.id)}
                    >
                      <strong>{mode.label}</strong>
                      <span>{mode.detail}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="negotiator-actions">
                <button className="negotiator-secondary" type="button" disabled={busy !== null} onClick={getQuote}>
                  {busy === "quote" ? "Checking..." : "Quote"}
                </button>
                <button
                  className="negotiator-primary"
                  type="button"
                  disabled={busy !== null || quoteFeasible === false}
                  onClick={createOrder}
                >
                  {busy === "order" ? "Creating..." : "Create order"}
                </button>
              </div>

              <pre className="negotiator-code">{JSON.stringify(body, null, 2)}</pre>
            </div>
          </div>

          <div className="negotiator-card negotiator-result">
            <div>
              <div className="negotiator-kicker">Negotiator result</div>
              {error && <div className="negotiator-error">{error}</div>}
            </div>

            {!quote && !order && !error && (
              <div className="negotiator-empty">
                Start with a quote. The important behavior is refusal: Jiagon should not create
                an order unless the merchant constraints can actually be met.
              </div>
            )}

            {quote?.quote && (
              <section className="negotiator-panel" aria-label="Quote">
                <span className="negotiator-pill">{quote.quote.feasible ? "feasible" : "needs negotiation"}</span>
                <div className="negotiator-summary" style={{ marginTop: 12 }}>
                  <div className="negotiator-stat">
                    <span>Item</span>
                    <strong>{quote.quote.item.name}</strong>
                  </div>
                  <div className="negotiator-stat">
                    <span>Total</span>
                    <strong>${quote.quote.item.subtotalUsd}</strong>
                  </div>
                  <div className="negotiator-stat">
                    <span>ETA</span>
                    <strong>
                      {quote.quote.estimate.readyInMinutes !== null
                        ? `${quote.quote.estimate.readyInMinutes} min`
                        : quote.quote.estimate.shippingDays !== null
                          ? `${quote.quote.estimate.shippingDays} days`
                          : "pending"}
                    </strong>
                  </div>
                </div>
                <ul className="negotiator-list">
                  {quote.quote.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
                {quote.quote.alternatives.length > 0 && (
                  <>
                    <div className="negotiator-label" style={{ marginTop: 14 }}>Alternatives</div>
                    <ul className="negotiator-list">
                      {quote.quote.alternatives.map((alternative) => (
                        <li key={alternative.itemId}>
                          {alternative.name} · ${alternative.amountUsd} · {alternative.reason}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            )}

            {order && (
              <section className="negotiator-panel" aria-label="Order">
                <span className="negotiator-pill">{statusText(order.status)}</span>
                <div className="negotiator-summary" style={{ marginTop: 12 }}>
                  <div className="negotiator-stat">
                    <span>Order</span>
                    <strong>{order.order?.pickupCode || order.order?.id?.slice(0, 8) || "created"}</strong>
                  </div>
                  <div className="negotiator-stat">
                    <span>Payment</span>
                    <strong>{statusText(order.payment?.status)}</strong>
                  </div>
                  <div className="negotiator-stat">
                    <span>Proof</span>
                    <strong>{statusText(order.proofLevel)}</strong>
                  </div>
                </div>
                <ul className="negotiator-list">
                  {(order.customerInstructions || []).map((instruction) => (
                    <li key={instruction}>{instruction}</li>
                  ))}
                </ul>
                <div className="negotiator-link-row">
                  {order.urls?.nfcStation && <a className="negotiator-link" href={order.urls.nfcStation}>Claim station</a>}
                  {order.urls?.pairPhoneForNfcClaim && (
                    <a className="negotiator-link primary" href={order.urls.pairPhoneForNfcClaim}>Receipt claim</a>
                  )}
                  <Link className="negotiator-link" href="/merchant">Open merchant terminal</Link>
                </div>
              </section>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

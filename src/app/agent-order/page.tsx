"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { HelioCheckout, type HelioEmbedConfig } from "@heliofi/checkout-react";

type PaymentMode = "crypto_pay" | "pay_at_counter";

type AgentOrderResponse = {
  status?: string;
  proofLevel?: string;
  order?: {
    id: string;
    pickupCode: string;
    subtotalUsd: string;
    receiptClaimUrl?: string | null;
  };
  pickup?: {
    label: string;
    readyAt: string;
  };
  payment?: {
    mode?: PaymentMode;
    status?: string;
    provider?: string;
    url?: string;
    checkout?: HelioEmbedConfig;
    missing?: string[];
    note?: string;
    network?: string;
  };
  paymentProof?: {
    rail?: string;
    currentLevel?: string;
    verifiedPayment?: boolean;
    nextUpgrade?: string;
  };
  agentExecution?: {
    userSaid?: string;
    agentHandled?: string[];
    userVisibleResult?: string[];
    paymentApproval?: string;
    merchantTerminal?: string;
    receiptAutomation?: string;
    futureCreditUse?: string;
  };
  creditPath?: string[];
  staffDispatch?: string;
  customerInstructions?: string[];
  urls?: {
    nfcStation?: string;
    pairPhoneForNfcClaim?: string;
  };
  next?: string;
  error?: string;
  menu?: Array<{
    id: string;
    name: string;
    amountUsd: string;
  }>;
};

const paymentModes: Array<{ id: PaymentMode; label: string; detail: string }> = [
  {
    id: "crypto_pay",
    label: "Crypto Pay on Solana",
    detail: "Uses Helio Solana checkout when configured, with direct Solana Pay as fallback.",
  },
  {
    id: "pay_at_counter",
    label: "Counter fallback",
    detail: "Manual pilot path when no test payment route is configured.",
  },
];

function jiagonRequestBody(paymentMode: PaymentMode, userIntent: string, maxSpendUsd: string) {
  return {
    agentId: "seeker-demo-agent",
    userIntent,
    merchantId: "raposa-coffee",
    maxSpendUsd,
    paymentMode,
  };
}

function paymentStatusCopy(payment?: AgentOrderResponse["payment"]) {
  if (!payment) return "No order yet";
  if (payment.status === "checkout_config_created") return "Crypto Pay checkout ready";
  if (payment.status === "payment_request_created") return "Crypto Pay fallback ready";
  if (payment.status === "setup_required") return `Setup required: ${(payment.missing || []).join(", ")}`;
  if (payment.status === "blocked") return "Blocked by testnet guard";
  return payment.status || "Payment handled at counter";
}

export default function AgentOrderDemoPage() {
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("crypto_pay");
  const [userIntent, setUserIntent] = useState("I want a coffee. Keep it under $10 and use crypto pay if possible.");
  const [maxSpendUsd, setMaxSpendUsd] = useState("10.00");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AgentOrderResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requestBody = useMemo(
    () => jiagonRequestBody(paymentMode, userIntent, maxSpendUsd),
    [maxSpendUsd, paymentMode, userIntent],
  );
  const helioConfig = result?.payment?.checkout;
  const canOpenSolanaPay = Boolean(result?.payment?.url);

  async function createOrder() {
    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/agent/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const payload = await response.json() as AgentOrderResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Agent order request failed.");
      }
      setResult(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Agent order request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="agent-order-page">
      <style>{`
        .agent-order-page {
          min-height: 100vh;
          padding: 28px clamp(18px, 4vw, 56px) 54px;
          background:
            radial-gradient(circle at 14% 0%, oklch(0.98 0.008 105) 0 260px, transparent 420px),
            linear-gradient(135deg, oklch(0.95 0.016 115) 0%, oklch(0.91 0.014 92) 58%, oklch(0.90 0.018 128) 100%);
        }
        .agent-order-shell { max-width: 1360px; margin: 0 auto; }
        .agent-order-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 18px;
          margin-bottom: 30px;
        }
        .agent-order-brand { display: flex; align-items: center; gap: 14px; }
        .agent-order-mark {
          width: 52px;
          height: 52px;
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
        .agent-order-wordmark {
          font-family: var(--display);
          font-size: 36px;
          line-height: .92;
          color: var(--verified);
        }
        .agent-order-sub,
        .agent-order-kicker,
        .agent-order-label {
          font-family: var(--mono);
          font-size: 10px;
          letter-spacing: .9px;
          text-transform: uppercase;
          color: var(--ink-muted);
        }
        .agent-order-sub { margin-top: 4px; }
        .agent-order-nav { display: flex; flex-wrap: wrap; gap: 8px; }
        .agent-order-nav a {
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
        .agent-order-nav a:hover { color: var(--verified); background: var(--verified-soft); }
        .agent-order-hero {
          display: grid;
          grid-template-columns: minmax(340px, .86fr) minmax(420px, 1.14fr);
          gap: 18px;
          align-items: start;
        }
        .agent-order-card {
          border: .5px solid var(--rule);
          border-radius: 8px;
          background: var(--receipt);
          padding: 18px;
          box-shadow: 0 1px 0 rgba(24,24,24,.05), 0 8px 24px rgba(24,24,24,.045);
        }
        .agent-order-title {
          margin: 10px 0 0;
          font-family: var(--display);
          font-size: clamp(42px, 6vw, 78px);
          font-weight: 400;
          font-style: italic;
          line-height: .92;
          color: var(--ink);
        }
        .agent-order-copy {
          margin: 16px 0 0;
          color: var(--ink-muted);
          font-size: 16px;
          line-height: 1.55;
        }
        .agent-order-form { display: grid; gap: 14px; margin-top: 20px; }
        .agent-order-field { display: grid; gap: 7px; }
        .agent-order-field label {
          color: var(--ink);
          font-size: 13px;
          font-weight: 900;
        }
        .agent-order-field textarea,
        .agent-order-field input {
          width: 100%;
          border: .5px solid var(--rule);
          border-radius: 8px;
          background: var(--surface);
          color: var(--ink);
          font: inherit;
          padding: 12px;
          outline: none;
        }
        .agent-order-field textarea { min-height: 112px; resize: vertical; line-height: 1.5; }
        .agent-order-field textarea:focus,
        .agent-order-field input:focus { border-color: var(--verified); box-shadow: 0 0 0 3px var(--verified-soft); }
        .agent-order-mode-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
        .agent-order-mode {
          border: .5px solid var(--rule);
          border-radius: 8px;
          background: var(--surface);
          color: var(--ink);
          padding: 12px;
          text-align: left;
          cursor: pointer;
        }
        .agent-order-mode[data-active="true"] {
          border-color: var(--verified);
          background: var(--verified-soft);
        }
        .agent-order-mode strong { display: block; font-size: 13px; }
        .agent-order-mode span {
          display: block;
          margin-top: 6px;
          color: var(--ink-muted);
          font-size: 11px;
          line-height: 1.35;
        }
        .agent-order-primary {
          min-height: 46px;
          border: .5px solid var(--verified);
          border-radius: 8px;
          background: var(--verified);
          color: var(--panel-text);
          font-weight: 900;
          cursor: pointer;
        }
        .agent-order-primary:disabled { opacity: .58; cursor: wait; }
        .agent-order-code {
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
        .agent-order-script {
          margin-top: 16px;
          display: grid;
          gap: 8px;
        }
        .agent-order-bubble {
          max-width: 92%;
          padding: 12px 14px;
          border-radius: 8px;
          border: .5px solid var(--rule);
          background: var(--surface);
          color: var(--ink);
          line-height: 1.45;
        }
        .agent-order-bubble.agent {
          margin-left: auto;
          background: var(--verified);
          border-color: var(--verified);
          color: var(--panel-text);
        }
        .agent-order-handoff {
          display: grid;
          grid-template-columns: minmax(0, .92fr) minmax(0, 1.08fr);
          gap: 10px;
        }
        .agent-order-handoff-panel {
          padding: 14px;
          border-radius: 8px;
          border: .5px solid var(--rule);
          background: var(--surface);
        }
        .agent-order-result { display: grid; gap: 14px; }
        .agent-order-summary {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
        }
        .agent-order-stat {
          min-height: 88px;
          padding: 13px;
          border-radius: 8px;
          border: .5px solid var(--rule);
          background: var(--surface);
        }
        .agent-order-stat span {
          display: block;
          color: var(--ink-muted);
          font-family: var(--mono);
          font-size: 10px;
          letter-spacing: .6px;
          text-transform: uppercase;
        }
        .agent-order-stat strong {
          display: block;
          margin-top: 10px;
          color: var(--ink);
          font-size: 20px;
        }
        .agent-order-payment {
          min-height: 214px;
          border-radius: 8px;
          border: .5px solid var(--rule);
          background: var(--surface);
          padding: 14px;
        }
        .agent-order-payment-top {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
          margin-bottom: 12px;
        }
        .agent-order-pill {
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
        .agent-order-link-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
        .agent-order-link {
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
        .agent-order-link.primary { background: var(--verified); color: var(--panel-text); border-color: var(--verified); }
        .agent-order-empty {
          border: .5px dashed var(--rule);
          border-radius: 8px;
          padding: 18px;
          color: var(--ink-muted);
          line-height: 1.5;
        }
        .agent-order-list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
        .agent-order-list li {
          padding: 10px 12px;
          border-radius: 8px;
          background: oklch(0.985 0.005 95 / .7);
          color: var(--ink-muted);
          font-size: 13px;
          line-height: 1.45;
        }
        .agent-order-error {
          padding: 12px;
          border-radius: 8px;
          border: .5px solid oklch(0.67 0.15 35);
          background: oklch(0.96 0.045 45);
          color: oklch(0.42 0.12 35);
          font-weight: 800;
        }
        @media (max-width: 980px) {
          .agent-order-top,
          .agent-order-hero { display: block; }
          .agent-order-nav { margin-top: 18px; }
          .agent-order-card + .agent-order-card { margin-top: 18px; }
          .agent-order-handoff,
          .agent-order-summary,
          .agent-order-mode-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="agent-order-shell">
        <header className="agent-order-top">
          <div className="agent-order-brand">
            <div className="agent-order-mark">J</div>
            <div>
              <div className="agent-order-wordmark">Jiagon</div>
              <div className="agent-order-sub">Agentic POS demo</div>
            </div>
          </div>
          <nav className="agent-order-nav" aria-label="Agent order demo">
            <Link href="/">Home</Link>
            <Link href="/merchant">Merchant</Link>
            <Link href="/tile/raposa-coffee">NFC Station</Link>
            <Link href="/passport">Passport</Link>
            <Link href="/credit">Credit</Link>
          </nav>
        </header>

        <section className="agent-order-hero">
          <div className="agent-order-card">
            <div className="agent-order-kicker">User intent &rarr; agent-run checkout</div>
            <h1 className="agent-order-title">Say coffee. Let the agent handle the POS.</h1>
            <p className="agent-order-copy">
              This is the flow to demo: the user only states intent. A personal agent
              calls Jiagon, creates the Raposa order, prepares payment approval, tracks
              pickup, and stores the receipt for future dining credit.
            </p>
            <div className="agent-order-script" aria-label="Agentic POS conversation">
              <div className="agent-order-bubble">I want a coffee. Keep it under $10.</div>
              <div className="agent-order-bubble agent">
                I found Raposa Coffee, prepared payment, and will tell you where to pick it up.
              </div>
            </div>

            <div className="agent-order-form">
              <div className="agent-order-field">
                <label htmlFor="agent-intent">User tells their agent</label>
                <textarea
                  id="agent-intent"
                  value={userIntent}
                  onChange={(event) => setUserIntent(event.target.value)}
                />
              </div>

              <div className="agent-order-field">
                <label htmlFor="agent-max">Max spend</label>
                <input
                  id="agent-max"
                  inputMode="decimal"
                  value={maxSpendUsd}
                  onChange={(event) => setMaxSpendUsd(event.target.value)}
                />
              </div>

              <div className="agent-order-field">
                <label>Payment route</label>
                <div className="agent-order-mode-grid">
                  {paymentModes.map((mode) => (
                    <button
                      className="agent-order-mode"
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

              <button className="agent-order-primary" type="button" disabled={busy} onClick={createOrder}>
                {busy ? "Agent is handling order..." : "Let agent order coffee"}
              </button>

              <pre className="agent-order-code">{JSON.stringify(requestBody, null, 2)}</pre>
            </div>
          </div>

          <div className="agent-order-card agent-order-result">
            <div>
              <div className="agent-order-kicker">Agent result</div>
              {error && <div className="agent-order-error">{error}</div>}
            </div>

            {!result && !error && (
              <div className="agent-order-empty">
                Start the agent run to see what the user receives: pickup location,
                approval step, ready time, receipt claim path, and future credit use.
              </div>
            )}

            {result && (
              <>
                <div className="agent-order-summary">
                  <div className="agent-order-stat">
                    <span>Pickup code</span>
                    <strong>{result.order?.pickupCode || "..."}</strong>
                  </div>
                  <div className="agent-order-stat">
                    <span>Total</span>
                    <strong>${result.order?.subtotalUsd || "0.00"}</strong>
                  </div>
                  <div className="agent-order-stat">
                    <span>Pickup</span>
                    <strong>{result.pickup?.label || "..."}</strong>
                  </div>
                  <div className="agent-order-stat">
                    <span>Staff</span>
                    <strong>{result.staffDispatch || "..."}</strong>
                  </div>
                </div>

                <section className="agent-order-payment">
                  <div className="agent-order-payment-top">
                    <div>
                      <div className="agent-order-label">Payment</div>
                      <strong>{paymentStatusCopy(result.payment)}</strong>
                    </div>
                    <span className="agent-order-pill">{result.payment?.network || "demo"}</span>
                  </div>

                  {helioConfig && (
                    <HelioCheckout
                      config={{
                        ...helioConfig,
                        customTexts: {
                          mainButtonTitle: "Pay Raposa order",
                          payButtonTitle: "Pay on Solana",
                        },
                        theme: { themeMode: "light" },
                      }}
                    />
                  )}

                  {canOpenSolanaPay && (
                    <div className="agent-order-link-row">
                      <a className="agent-order-link primary" href={result.payment?.url}>
                        Open Solana Pay fallback
                      </a>
                      <button
                        className="agent-order-link"
                        type="button"
                        onClick={() => navigator.clipboard.writeText(result.payment?.url || "")}
                      >
                        Copy solana URL
                      </button>
                    </div>
                  )}

                  {!helioConfig && !canOpenSolanaPay && (
                    <p className="agent-order-copy">
                      {result.payment?.note || "Payment is handled at the counter."}
                    </p>
                  )}
                </section>

                {result.agentExecution && (
                  <section className="agent-order-handoff">
                    <div className="agent-order-handoff-panel">
                      <div className="agent-order-label">What the user sees</div>
                      <ul className="agent-order-list">
                        {(result.agentExecution.userVisibleResult || []).map((item, index) => (
                          <li key={`visible-${index}-${item}`}>{item}</li>
                        ))}
                      </ul>
                      {result.agentExecution.paymentApproval && (
                        <p className="agent-order-copy">{result.agentExecution.paymentApproval}</p>
                      )}
                    </div>
                    <div className="agent-order-handoff-panel">
                      <div className="agent-order-label">What the agent handled</div>
                      <ul className="agent-order-list">
                        {(result.agentExecution.agentHandled || []).map((item, index) => (
                          <li key={`handled-${index}-${item}`}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  </section>
                )}

                <section>
                  <div className="agent-order-label">Receipt to credit path</div>
                  <ul className="agent-order-list">
                    {(result.creditPath || []).map((step, index) => (
                      <li key={`credit-${index}-${step}`}>{step}</li>
                    ))}
                  </ul>
                </section>

                <section>
                  <div className="agent-order-label">Customer instructions</div>
                  <ul className="agent-order-list">
                    {(result.customerInstructions || []).map((instruction, index) => (
                      <li key={`instruction-${index}-${instruction}`}>{instruction}</li>
                    ))}
                  </ul>
                  <div className="agent-order-link-row">
                    {result.urls?.nfcStation && (
                      <Link className="agent-order-link" href={result.urls.nfcStation}>
                        Open NFC station
                      </Link>
                    )}
                    {result.urls?.pairPhoneForNfcClaim && (
                      <Link className="agent-order-link" href={result.urls.pairPhoneForNfcClaim}>
                        Pair phone for claim
                      </Link>
                    )}
                    <Link className="agent-order-link" href="/merchant">
                      Open merchant queue
                    </Link>
                  </div>
                </section>

                <pre className="agent-order-code">{JSON.stringify(result, null, 2)}</pre>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

import Link from "next/link";

const demoCurl = `curl -X POST https://jiagon.vercel.app/api/agent/orders \\
  -H "content-type: application/json" \\
  -d '{
    "agentId": "seeker-demo-agent",
    "userIntent": "Order one iced latte at Raposa Coffee",
    "merchantId": "raposa-coffee",
    "maxSpendUsd": "10.00",
    "paymentMode": "crypto_pay"
  }'`;

const flow = [
  ["01", "Agent order", "Personal agent calls /api/agent/orders."],
  ["02", "Order pass", "Jiagon returns pickup code, ETA, and payment intent."],
  ["03", "Staff queue", "Raposa receives the order and taps Paid + Done."],
  ["04", "Receipt passport", "Customer claims and mints a Bubblegum receipt cNFT."],
  ["05", "Purpose credit", "Receipt history unlocks restaurant-deposit credit."],
];

function JiagonMark() {
  return (
    <div className="home-mark" aria-label="Jiagon">
      <span>J</span>
      <i />
      <b>✓</b>
    </div>
  );
}

function StatusPill({ children }: { children: string }) {
  return <span className="home-pill">{children}</span>;
}

export default function Home() {
  return (
    <main className="home-shell">
      <style>{`
        .home-shell {
          min-height: 100vh;
          padding: 28px clamp(18px, 4vw, 56px) 56px;
          background:
            radial-gradient(circle at 18% 0%, oklch(0.98 0.008 105) 0 280px, transparent 420px),
            linear-gradient(135deg, oklch(0.95 0.016 115) 0%, oklch(0.91 0.014 92) 58%, oklch(0.90 0.018 128) 100%);
        }
        .home-inner { max-width: 1380px; margin: 0 auto; }
        .home-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
          margin-bottom: 42px;
        }
        .home-brand { display: flex; align-items: center; gap: 14px; }
        .home-wordmark {
          font-family: var(--display);
          font-size: 42px;
          line-height: .9;
          color: var(--verified);
        }
        .home-sub, .home-kicker, .home-label {
          font-family: var(--mono);
          font-size: 10px;
          letter-spacing: .9px;
          text-transform: uppercase;
          color: var(--ink-muted);
        }
        .home-sub { margin-top: 5px; }
        .home-nav {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          padding: 6px;
          border: .5px solid var(--rule);
          border-radius: 8px;
          background: oklch(0.985 0.005 95 / .72);
          backdrop-filter: blur(16px);
        }
        .home-nav a {
          min-height: 34px;
          display: inline-flex;
          align-items: center;
          padding: 0 12px;
          border-radius: 6px;
          color: var(--ink-muted);
          font-size: 13px;
          font-weight: 700;
          text-decoration: none;
        }
        .home-nav a:hover { background: var(--verified-soft); color: var(--verified); }
        .home-hero {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(360px, 520px);
          gap: 18px;
          align-items: stretch;
        }
        .home-title {
          max-width: 860px;
          margin: 10px 0 0;
          font-family: var(--display);
          font-size: clamp(48px, 8vw, 98px);
          line-height: .9;
          font-weight: 400;
          font-style: italic;
          color: var(--ink);
        }
        .home-copy {
          max-width: 720px;
          margin: 18px 0 0;
          color: var(--ink-muted);
          font-size: 17px;
          line-height: 1.55;
        }
        .home-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 26px; }
        .home-button {
          min-height: 44px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0 16px;
          border-radius: 8px;
          border: .5px solid var(--verified);
          background: var(--verified);
          color: var(--panel-text);
          font-weight: 800;
          text-decoration: none;
        }
        .home-button.secondary { background: var(--surface); color: var(--ink); border-color: var(--rule); }
        .home-card {
          border: .5px solid var(--rule);
          border-radius: 8px;
          background: var(--receipt);
          padding: 18px;
          box-shadow: 0 1px 0 rgba(24,24,24,.05), 0 8px 24px rgba(24,24,24,.045);
        }
        .home-card.dark { background: var(--panel); color: var(--panel-text); border-color: oklch(0.34 0.03 135); }
        .home-grid {
          display: grid;
          grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr);
          gap: 18px;
          margin-top: 18px;
        }
        .home-panel-title {
          margin: 8px 0 0;
          font-family: var(--display);
          font-style: italic;
          font-weight: 400;
          font-size: 34px;
          line-height: .95;
        }
        .home-flow { display: grid; gap: 10px; margin-top: 16px; }
        .home-step {
          display: grid;
          grid-template-columns: 42px 1fr;
          gap: 12px;
          padding: 12px;
          border: .5px solid var(--rule);
          border-radius: 8px;
          background: oklch(0.985 0.005 95 / .64);
        }
        .home-step code {
          font-family: var(--mono);
          color: var(--verified);
          font-size: 11px;
        }
        .home-step strong { display: block; font-size: 14px; }
        .home-step span { display: block; color: var(--ink-muted); font-size: 13px; line-height: 1.4; margin-top: 3px; }
        .home-code {
          margin: 14px 0 0;
          padding: 16px;
          border-radius: 8px;
          border: .5px solid oklch(0.38 0.03 135);
          background: oklch(0.21 0.026 135);
          color: var(--panel-text);
          font-family: var(--mono);
          font-size: 12px;
          line-height: 1.7;
          overflow: auto;
          white-space: pre-wrap;
        }
        .home-pill-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
        .home-pill {
          display: inline-flex;
          align-items: center;
          min-height: 28px;
          padding: 0 9px;
          border-radius: 6px;
          border: .5px solid color-mix(in oklch, var(--verified) 34%, var(--rule));
          background: var(--verified-soft);
          color: var(--verified);
          font-family: var(--mono);
          font-size: 10px;
          font-weight: 800;
          letter-spacing: .3px;
          text-transform: uppercase;
        }
        .home-mark {
          width: 56px;
          height: 56px;
          position: relative;
          display: grid;
          place-items: center;
          flex: 0 0 auto;
          border: 3px solid var(--verified);
          border-radius: 10px;
          background: var(--receipt);
          color: var(--verified);
          font-family: Georgia, serif;
          font-size: 39px;
          font-weight: 800;
          line-height: .9;
          box-shadow: 0 10px 24px rgba(24,58,38,.10);
        }
        .home-mark span { transform: translateY(-2px); }
        .home-mark i {
          position: absolute;
          left: 14%;
          right: 28%;
          bottom: 13%;
          border-bottom: 3px dotted var(--verified);
        }
        .home-mark b {
          position: absolute;
          top: 6%;
          right: 5%;
          width: 24%;
          height: 24%;
          display: grid;
          place-items: center;
          border-radius: 999px;
          background: var(--ink);
          color: var(--receipt);
          font-family: var(--ui);
          font-size: 10px;
        }
        @media (max-width: 920px) {
          .home-top, .home-hero, .home-grid { grid-template-columns: 1fr; display: grid; }
          .home-nav { justify-content: start; }
        }
      `}</style>
      <div className="home-inner">
        <header className="home-top">
          <div className="home-brand">
            <JiagonMark />
            <div>
              <div className="home-wordmark">Jiagon</div>
              <div className="home-sub">Solana receipt-backed credit</div>
            </div>
          </div>
          <nav className="home-nav" aria-label="Primary">
            <Link href="/agent-order">Agent Order</Link>
            <Link href="/merchant">Merchant</Link>
            <Link href="/tile/raposa-coffee">NFC Station</Link>
            <Link href="/passport">Passport</Link>
            <Link href="/credit">Credit</Link>
            <Link href="/api/agent">Agent API</Link>
          </nav>
        </header>

        <section className="home-hero">
          <div>
            <div className="home-kicker">Agentic POS &rarr; Bubblegum receipt &rarr; purpose-bound credit</div>
            <h1 className="home-title">Personal agents can order. Receipts unlock credit.</h1>
            <p className="home-copy">
              Jiagon lets a user&apos;s agent place a real merchant order, routes it into the
              staff queue, mints the fulfilled receipt on Solana, and uses that receipt history
              to unlock restaurant-deposit credit.
            </p>
            <div className="home-actions">
              <Link className="home-button" href="/agent-order">Try agent order demo</Link>
              <Link className="home-button" href="/merchant">Open staff queue</Link>
              <Link className="home-button secondary" href="/tile/raposa-coffee">Open Raposa NFC station</Link>
            </div>
          </div>
          <section className="home-card">
            <div className="home-label">Live demo spine</div>
            <div className="home-flow">
              {flow.map(([id, title, body]) => (
                <div className="home-step" key={id}>
                  <code>{id}</code>
                  <div>
                    <strong>{title}</strong>
                    <span>{body}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </section>

        <section className="home-grid">
          <section className="home-card dark">
            <div className="home-label">Agent-callable order API</div>
            <h2 className="home-panel-title">Use the API as the POS entry point.</h2>
            <pre className="home-code">{demoCurl}</pre>
          </section>
          <section className="home-card">
            <div className="home-label">Credit boundary</div>
            <h2 className="home-panel-title">Credit is purpose-bound, not open cash.</h2>
            <p className="home-copy">
              The first lending use case is a restaurant deposit: amount-capped, recipient-bound,
              category-bound, expiring, and backed by verified receipt history.
            </p>
            <div className="home-pill-row">
              <StatusPill>Solana-first</StatusPill>
              <StatusPill>Bubblegum cNFT</StatusPill>
              <StatusPill>Receipt Passport</StatusPill>
              <StatusPill>Credit PDA</StatusPill>
              <StatusPill>Devnet USDC</StatusPill>
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}

import Link from "next/link";

const quoteCurl = `curl -X POST https://jiagon.vercel.app/api/agent/merchants/raposa-coffee/quote \\
  -H "content-type: application/json" \\
  -d '{"userIntent":"Get me an iced latte under $10, ready in 15 minutes","maxSpendUsd":"10.00","deadlineMinutes":15}'`;

const orderCurl = `curl -X POST https://jiagon.vercel.app/api/agent/merchants/raposa-coffee/orders \\
  -H "content-type: application/json" \\
  -d '{"agentId":"yc-demo-agent","userIntent":"Get me an iced latte under $10, ready in 15 minutes","maxSpendUsd":"10.00","deadlineMinutes":15,"paymentMode":"pay_at_counter"}'`;

const cliCommands = `pnpm agent "Get me an iced latte from Raposa under 10 dollars, ready in 15 minutes"
pnpm agent "Find me a black MagSafe iPhone 16 case from SOLYD under $90 and ship this week"`;

const serviceRows = [
  ["1", "Quote", "Check merchant capability, budget, pickup window, stock, and alternatives."],
  ["2", "Order", "Create the merchant handoff only when the quote is feasible."],
  ["3", "Fulfill", "Staff accepts, prepares, and marks Paid + Done in the terminal."],
  ["4", "Prove", "Jiagon returns a claimable receipt after the work is completed."],
];

const surfaces = [
  ["/api/agent", "Agent API", "Discovery and endpoint map for personal agents."],
  ["pnpm agent", "CLI", "Fastest live demo path for Call My Agent."],
  ["/merchant", "Merchant terminal", "Staff queue for accepting and completing orders."],
  ["/agent-order", "Request console", "Thin debug UI for quote and order calls."],
];

export default function Home() {
  return (
    <main className="service-home">
      <style>{`
        .service-home {
          min-height: 100vh;
          padding: 24px clamp(18px, 4vw, 48px) 48px;
          background: oklch(0.96 0.009 100);
          color: var(--ink);
        }
        .service-shell {
          max-width: 1180px;
          margin: 0 auto;
        }
        .service-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
          padding-bottom: 18px;
          border-bottom: .5px solid var(--rule);
        }
        .service-brand {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .service-mark {
          width: 44px;
          height: 44px;
          display: grid;
          place-items: center;
          border: 2px solid var(--verified);
          border-radius: 8px;
          background: var(--receipt);
          color: var(--verified);
          font-family: Georgia, serif;
          font-size: 30px;
          font-weight: 800;
          line-height: 1;
        }
        .service-wordmark {
          font-family: var(--display);
          font-size: 32px;
          line-height: .9;
          color: var(--verified);
        }
        .service-sub,
        .service-label,
        .service-kicker {
          font-family: var(--mono);
          font-size: 10px;
          letter-spacing: .8px;
          text-transform: uppercase;
          color: var(--ink-muted);
        }
        .service-sub { margin-top: 5px; }
        .service-nav {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 8px;
        }
        .service-nav a,
        .service-link {
          min-height: 34px;
          display: inline-flex;
          align-items: center;
          padding: 0 11px;
          border: .5px solid var(--rule);
          border-radius: 7px;
          background: var(--receipt);
          color: var(--ink);
          font-size: 13px;
          font-weight: 850;
          text-decoration: none;
        }
        .service-summary {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(320px, .6fr);
          gap: 22px;
          align-items: start;
          padding: 34px 0 26px;
          border-bottom: .5px solid var(--rule);
        }
        .service-title {
          max-width: 720px;
          margin: 8px 0 0;
          font-size: clamp(34px, 5vw, 56px);
          line-height: 1;
          letter-spacing: 0;
          color: var(--ink);
        }
        .service-copy {
          max-width: 720px;
          margin: 14px 0 0;
          color: var(--ink-muted);
          font-size: 16px;
          line-height: 1.55;
        }
        .service-runbook {
          display: grid;
          gap: 8px;
          border: .5px solid var(--rule);
          border-radius: 8px;
          background: var(--receipt);
          padding: 12px;
        }
        .service-runbook div {
          display: grid;
          grid-template-columns: 28px 1fr;
          gap: 10px;
          align-items: start;
          padding: 9px;
          border-radius: 7px;
          background: var(--surface);
        }
        .service-runbook code {
          font-family: var(--mono);
          color: var(--verified);
          font-size: 11px;
        }
        .service-runbook strong {
          display: block;
          font-size: 14px;
        }
        .service-runbook span {
          display: block;
          margin-top: 3px;
          color: var(--ink-muted);
          font-size: 13px;
          line-height: 1.4;
        }
        .service-grid {
          display: grid;
          grid-template-columns: minmax(0, .82fr) minmax(0, 1.18fr);
          gap: 18px;
          margin-top: 22px;
        }
        .service-panel {
          border: .5px solid var(--rule);
          border-radius: 8px;
          background: var(--receipt);
          padding: 16px;
        }
        .service-panel h2 {
          margin: 7px 0 0;
          font-size: 22px;
          line-height: 1.1;
          color: var(--ink);
        }
        .service-table {
          display: grid;
          gap: 8px;
          margin-top: 14px;
        }
        .service-row {
          display: grid;
          grid-template-columns: 120px 1fr;
          gap: 12px;
          padding: 11px;
          border: .5px solid var(--rule);
          border-radius: 7px;
          background: var(--surface);
        }
        .service-row strong {
          font-size: 13px;
          color: var(--ink);
        }
        .service-row span {
          color: var(--ink-muted);
          font-size: 13px;
          line-height: 1.4;
        }
        .service-code {
          margin: 12px 0 0;
          padding: 13px;
          border-radius: 7px;
          background: oklch(0.21 0.026 135);
          color: var(--panel-text);
          font-family: var(--mono);
          font-size: 11px;
          line-height: 1.65;
          overflow: auto;
          white-space: pre-wrap;
        }
        .service-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 18px;
        }
        @media (max-width: 900px) {
          .service-top,
          .service-summary { display: block; }
          .service-nav,
          .service-runbook { margin-top: 16px; }
          .service-grid,
          .service-row { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="service-shell">
        <header className="service-top">
          <div className="service-brand">
            <div className="service-mark">J</div>
            <div>
              <div className="service-wordmark">Jiagon</div>
              <div className="service-sub">Agent service for merchant orders</div>
            </div>
          </div>
          <nav className="service-nav" aria-label="Jiagon service navigation">
            <Link href="/api/agent">Agent API</Link>
            <Link href="/agent-order">Request Console</Link>
            <Link href="/merchant">Merchant Terminal</Link>
          </nav>
        </header>

        <section className="service-summary">
          <div>
            <div className="service-kicker">YC Call My Agent Hackathon</div>
            <h1 className="service-title">Merchant order API for personal agents.</h1>
            <p className="service-copy">
              Jiagon is not a consumer website. It is a service contract that lets an agent
              quote merchant constraints, create a feasible handoff, and leave proof after
              the merchant completes the work.
            </p>
            <div className="service-actions">
              <Link className="service-link" href="/api/agent">Inspect API</Link>
              <Link className="service-link" href="/merchant">Open terminal</Link>
            </div>
          </div>

          <div className="service-runbook" aria-label="Service flow">
            {serviceRows.map(([number, title, body]) => (
              <div key={number}>
                <code>{number}</code>
                <span>
                  <strong>{title}</strong>
                  {body}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="service-grid">
          <div className="service-panel">
            <div className="service-kicker">Core surfaces</div>
            <h2>Use the API, CLI, and merchant terminal.</h2>
            <div className="service-table">
              {surfaces.map(([path, title, body]) => (
                <div className="service-row" key={path}>
                  <strong>{path}</strong>
                  <span>{title}: {body}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="service-panel">
            <div className="service-kicker">Smoke commands</div>
            <h2>Quote first. Order only if feasible.</h2>
            <pre className="service-code">{quoteCurl}</pre>
            <pre className="service-code">{orderCurl}</pre>
            <pre className="service-code">{cliCommands}</pre>
          </div>
        </section>
      </div>
    </main>
  );
}

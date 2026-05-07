import Link from "next/link";

const policy = [
  ["Bounded purpose", "Dining deposits only in the MVP, not free-form borrowing."],
  ["Bounded recipient", "Funds should move to merchant escrow or an approved merchant account."],
  ["Bounded amount", "Credit is capped by verified receipt memory and repayment history."],
  ["Proof weighted", "L4 payment-backed receipts count more than L2/L3 pilot attestations."],
];

export default function CreditPage() {
  return (
    <main className="credit-page">
      <style>{`
        .credit-page {
          min-height:100vh; padding:28px clamp(18px,4vw,56px) 56px;
          background:linear-gradient(135deg, oklch(0.95 0.016 115), oklch(0.90 0.018 128));
        }
        .credit-shell{max-width:1180px;margin:0 auto}
        .credit-nav{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:34px}
        .credit-nav a{min-height:34px;display:inline-flex;align-items:center;padding:0 12px;border:.5px solid var(--rule);border-radius:6px;background:var(--receipt);color:var(--ink-muted);text-decoration:none;font-weight:800;font-size:13px}
        .credit-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,.82fr);gap:18px;align-items:stretch}
        .credit-card{border:.5px solid var(--rule);border-radius:8px;background:var(--receipt);padding:18px;box-shadow:0 8px 24px rgba(24,24,24,.045)}
        .credit-card.dark{background:var(--panel);color:var(--panel-text);border-color:oklch(0.34 0.03 135)}
        .credit-kicker{font-family:var(--mono);font-size:10px;letter-spacing:.9px;text-transform:uppercase;color:var(--ink-muted)}
        .credit-card.dark .credit-kicker{color:oklch(0.82 0.02 130)}
        .credit-title{max-width:760px;margin:10px 0 0;font-family:var(--display);font-style:italic;font-size:clamp(44px,7vw,82px);line-height:.92;font-weight:400;color:var(--ink)}
        .credit-card.dark .credit-title{color:var(--panel-text)}
        .credit-copy{margin:16px 0 0;color:var(--ink-muted);font-size:16px;line-height:1.55}
        .credit-card.dark .credit-copy{color:oklch(0.88 0.014 120)}
        .credit-list{display:grid;gap:10px;margin-top:16px}
        .credit-rule{display:grid;gap:4px;border:.5px solid var(--rule);border-radius:8px;background:oklch(0.985 0.005 95 / .68);padding:12px}
        .credit-rule strong{color:var(--ink)}
        .credit-rule span{color:var(--ink-muted);font-size:13px;line-height:1.45}
        .credit-flow{margin-top:16px;padding:16px;border-radius:8px;background:oklch(0.21 0.026 135);color:var(--panel-text);font-family:var(--mono);font-size:12px;line-height:1.75;white-space:pre-wrap;overflow:auto}
        .credit-cta{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}
        .credit-cta a{min-height:42px;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;padding:0 14px;border:.5px solid var(--verified);background:var(--verified);color:var(--panel-text);text-decoration:none;font-weight:900}
        .credit-cta a.secondary{background:var(--receipt);color:var(--ink);border-color:var(--rule)}
        @media(max-width:860px){.credit-grid{grid-template-columns:1fr}}
      `}</style>
      <div className="credit-shell">
        <nav className="credit-nav" aria-label="Credit">
          <Link href="/">Home</Link>
          <Link href="/agent-order">Agent Order</Link>
          <Link href="/passport">Passport</Link>
          <Link href="/merchant">Merchant</Link>
        </nav>
        <section className="credit-grid">
          <div className="credit-card dark">
            <div className="credit-kicker">Purpose-bound dining credit</div>
            <h1 className="credit-title">Future agents use credit memory, not open cash.</h1>
            <p className="credit-copy">
              The lending wedge is a restaurant deposit: the agent can request a bounded draw only when verified receipt
              memory supports it, and funds should go to a merchant-controlled destination.
            </p>
            <pre className="credit-flow">{`verified receipt memory
-> credit policy check
-> purpose = dining deposit
-> recipient = approved merchant escrow
-> amount = capped
-> repayment restores line`}</pre>
            <div className="credit-cta">
              <Link href="/agent-order">Create agent order</Link>
              <Link className="secondary" href="/passport">Open passport</Link>
            </div>
          </div>
          <div className="credit-card">
            <div className="credit-kicker">Policy rails</div>
            <div className="credit-list">
              {policy.map(([title, body]) => (
                <div className="credit-rule" key={title}>
                  <strong>{title}</strong>
                  <span>{body}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

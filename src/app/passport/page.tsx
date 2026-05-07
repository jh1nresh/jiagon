import Link from "next/link";

const memorySignals = [
  ["Agent order", "Intent, merchant, spend cap, and payment route are preserved."],
  ["Merchant fulfillment", "Staff confirmation upgrades intent into real-world completion."],
  ["Receipt credential", "Claimed receipts can be minted as Solana Bubblegum cNFTs."],
  ["Credit memory", "Agents can read verified history without treating API tolls as purchase proof."],
];

export default function PassportPage() {
  return (
    <main className="passport-page">
      <style>{`
        .passport-page {
          min-height: 100vh;
          padding: 28px clamp(18px, 4vw, 56px) 56px;
          background: linear-gradient(135deg, oklch(0.95 0.016 115), oklch(0.90 0.018 128));
        }
        .passport-shell { max-width: 1180px; margin: 0 auto; }
        .passport-nav { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:34px; }
        .passport-nav a {
          min-height:34px; display:inline-flex; align-items:center; padding:0 12px;
          border:.5px solid var(--rule); border-radius:6px; background:var(--receipt);
          color:var(--ink-muted); text-decoration:none; font-weight:800; font-size:13px;
        }
        .passport-hero {
          display:grid; grid-template-columns:minmax(0,1fr) minmax(320px,.75fr);
          gap:18px; align-items:stretch;
        }
        .passport-card {
          border:.5px solid var(--rule); border-radius:8px; background:var(--receipt);
          padding:18px; box-shadow:0 8px 24px rgba(24,24,24,.045);
        }
        .passport-kicker {
          font-family:var(--mono); font-size:10px; letter-spacing:.9px; text-transform:uppercase;
          color:var(--ink-muted);
        }
        .passport-title {
          max-width:760px; margin:10px 0 0; font-family:var(--display); font-style:italic;
          font-size:clamp(44px,7vw,82px); line-height:.92; font-weight:400; color:var(--ink);
        }
        .passport-copy { margin:16px 0 0; color:var(--ink-muted); font-size:16px; line-height:1.55; }
        .passport-list { display:grid; gap:10px; margin-top:16px; }
        .passport-signal {
          display:grid; gap:4px; border:.5px solid var(--rule); border-radius:8px;
          background:oklch(0.985 0.005 95 / .68); padding:12px;
        }
        .passport-signal strong { color:var(--ink); }
        .passport-signal span { color:var(--ink-muted); font-size:13px; line-height:1.45; }
        .passport-cta { display:flex; flex-wrap:wrap; gap:10px; margin-top:24px; }
        .passport-cta a {
          min-height:42px; display:inline-flex; align-items:center; justify-content:center;
          border-radius:8px; padding:0 14px; border:.5px solid var(--verified);
          background:var(--verified); color:var(--panel-text); text-decoration:none; font-weight:900;
        }
        .passport-cta a.secondary { background:var(--receipt); color:var(--ink); border-color:var(--rule); }
        @media(max-width:860px){.passport-hero{grid-template-columns:1fr}}
      `}</style>
      <div className="passport-shell">
        <nav className="passport-nav" aria-label="Passport">
          <Link href="/">Home</Link>
          <Link href="/agent-order">Agent Order</Link>
          <Link href="/merchant">Merchant</Link>
          <Link href="/credit">Credit</Link>
        </nav>
        <section className="passport-hero">
          <div className="passport-card">
            <div className="passport-kicker">Verified purchase memory</div>
            <h1 className="passport-title">Passport is the memory layer for agents.</h1>
            <p className="passport-copy">
              Jiagon Passport is not just receipt storage. It is the private memory layer that lets future agents reason
              over merchant-fulfilled purchases, payment references, receipt credentials, and credit eligibility.
            </p>
            <div className="passport-cta">
              <Link href="/tile/raposa-coffee">Open NFC station</Link>
              <Link className="secondary" href="/credit">View credit memory</Link>
            </div>
          </div>
          <div className="passport-card">
            <div className="passport-kicker">Agent-readable signals</div>
            <div className="passport-list">
              {memorySignals.map(([title, body]) => (
                <div className="passport-signal" key={title}>
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

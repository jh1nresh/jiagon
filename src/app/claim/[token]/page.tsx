"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { PrivyProvider, usePrivy, type PrivyClientConfig } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";

type ClaimReceipt = {
  id: string;
  merchantName: string;
  location: string | null;
  receiptNumber: string;
  amountUsd: string;
  currency: string;
  category: string;
  purpose: string;
  status: string;
  receiptHash: string;
  signature: string | null;
  signatureAlgorithm: string;
  issuedAt: string;
  claimedAt?: string | null;
  mintStatus?: "ready" | "prepared" | "minted" | string;
  credentialId?: string;
  credentialChain?: string;
  standard?: string;
  dataHash?: string;
  storageUri?: string;
  solanaOwner?: string;
  credentialTx?: string | null;
  explorerUrl?: string | null;
  assetExplorerUrl?: string | null;
  creditImpact?: {
    eligible?: boolean;
    unlockedCreditUsd?: number;
    reason?: string;
  };
};

type MintReceiptResponse = {
  status?: string;
  mode?: string;
  credentialId?: string;
  credentialChain?: string;
  standard?: string;
  dataHash?: string;
  storageUri?: string;
  solanaOwner?: string;
  credentialTx?: string | null;
  explorerUrl?: string | null;
  assetExplorerUrl?: string | null;
  note?: string;
  creditImpact?: ClaimReceipt["creditImpact"];
};

const privyConfig: PrivyClientConfig = {
  loginMethods: ["wallet", "email", "google"],
  appearance: {
    theme: "light" as const,
    accentColor: "#A9573D" as const,
    showWalletLoginFirst: true,
    walletChainType: "solana-only" as const,
          walletList: ["phantom", "solflare", "backpack", "jupiter", "detected_solana_wallets", "wallet_connect_qr_solana"],
  },
  embeddedWallets: {
    solana: { createOnLogin: "off" as const },
    showWalletUIs: false,
  },
  externalWallets: {
    solana: { connectors: toSolanaWalletConnectors({ shouldAutoConnect: false }) },
  },
};

function shortHash(value?: string | null) {
  if (!value) return "not signed";
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

function getPrimaryWallet(user: unknown) {
  const typedUser = user as {
    wallet?: { address?: string };
    linkedAccounts?: Array<{ type?: string; address?: string }>;
  } | null;

  return typedUser?.wallet?.address || typedUser?.linkedAccounts?.find((account) => account.type === "wallet")?.address || null;
}

function getUserLabel(user: unknown, walletAddress?: string | null) {
  const typedUser = user as {
    id?: string;
    email?: { address?: string };
    google?: { email?: string };
    linkedAccounts?: Array<{ email?: string; phoneNumber?: string }>;
  } | null;
  return (
    typedUser?.email?.address ||
    typedUser?.google?.email ||
    typedUser?.linkedAccounts?.find((account) => account.email)?.email ||
    typedUser?.linkedAccounts?.find((account) => account.phoneNumber)?.phoneNumber ||
    walletAddress ||
    typedUser?.id ||
    null
  );
}

function mergeStoredMerchantReceipt(receipt: ClaimReceipt, privyUserId?: string | null, updates: Partial<ClaimReceipt> = {}) {
  const storageKey = "jiagon:merchant-receipts";
  const accountUserStorageKey = "jiagon:account-user-id";
  let current: unknown = [];
  try {
    const stored = window.localStorage.getItem(storageKey);
    current = stored ? JSON.parse(stored) : [];
  } catch {
    current = [];
  }
  const receipts = Array.isArray(current) ? current : [];
  const existing = receipts.find((item) => {
    const record = item && typeof item === "object" ? item as { id?: unknown } : null;
    return record?.id === receipt.id;
  });
  const existingReceipt = existing && typeof existing === "object" ? existing as Record<string, unknown> : null;
  const nextReceipt = {
    ...existingReceipt,
    ...receipt,
    ...updates,
    source: "merchant-issued",
    mintStatus:
      typeof updates.mintStatus === "string"
        ? updates.mintStatus
        : typeof receipt.mintStatus === "string"
          ? receipt.mintStatus
          : typeof existingReceipt?.mintStatus === "string"
            ? existingReceipt.mintStatus
            : "ready",
    creditImpact:
      updates.creditImpact && typeof updates.creditImpact === "object"
        ? updates.creditImpact
        : receipt.creditImpact && typeof receipt.creditImpact === "object"
          ? receipt.creditImpact
          : existingReceipt?.creditImpact && typeof existingReceipt.creditImpact === "object"
            ? existingReceipt.creditImpact
        : {
            eligible: false,
            unlockedCreditUsd: 0,
            reason: "Merchant-issued receipt must be minted as a Bubblegum cNFT before credit unlock.",
          },
  };
  const merged = [
    nextReceipt,
    ...receipts.filter((item) => {
      const record = item && typeof item === "object" ? item as { id?: unknown } : null;
      return record?.id !== receipt.id;
    }),
  ].slice(0, 250);
  try {
    if (privyUserId) {
      window.localStorage.setItem(accountUserStorageKey, privyUserId);
    }
    window.localStorage.setItem(storageKey, JSON.stringify(merged));
  } catch {
    // Local cache is best-effort; the backend claim already succeeded.
  }
}

function ClaimContent({ token }: { token: string }) {
  const { ready, authenticated, user, login, getAccessToken } = usePrivy();
  const [receipt, setReceipt] = useState<ClaimReceipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [minting, setMinting] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [mintResult, setMintResult] = useState<MintReceiptResponse | null>(null);
  const [solanaOwner, setSolanaOwner] = useState("");
  const [error, setError] = useState("");

  const wallet = useMemo(() => getPrimaryWallet(user), [user]);
  const userLabel = useMemo(() => getUserLabel(user, wallet), [user, wallet]);
  const receiptClaimed = claimed || receipt?.status === "claimed";
  const receiptMinted = receipt?.mintStatus === "minted" || mintResult?.status === "minted";
  const receiptPrepared = receipt?.mintStatus === "prepared" || mintResult?.status === "prepared";
  const creditUnlocked = Boolean(receipt?.creditImpact?.eligible || mintResult?.creditImpact?.eligible);

  useEffect(() => {
    let cancelled = false;
    async function loadReceipt() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/merchant/receipts/${encodeURIComponent(token)}`, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error || "Receipt was not found.");
        if (!cancelled) setReceipt(payload.receipt);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Receipt was not found.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadReceipt();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    try {
      setSolanaOwner(window.localStorage.getItem("jiagon:solana-owner") || "");
    } catch {
      setSolanaOwner("");
    }
  }, []);

  const claimReceipt = async () => {
    if (!authenticated) {
      await login();
      return;
    }

    setClaiming(true);
    setError("");
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error("Privy access token is required.");
      const response = await fetch(`/api/merchant/receipts/${encodeURIComponent(token)}/claim`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ wallet, userLabel }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Unable to claim receipt.");
      setReceipt(payload.receipt);
      mergeStoredMerchantReceipt(payload.receipt, (user as { id?: string } | null)?.id);
      setClaimed(true);
      setMintResult(null);
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : "Unable to claim receipt.");
    } finally {
      setClaiming(false);
    }
  };

  const mintReceipt = async () => {
    if (!authenticated) {
      await login();
      return;
    }
    if (!receipt) return;

    setMinting(true);
    setError("");
    setMintResult(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error("Privy access token is required.");
      const owner = solanaOwner.trim();
      const response = await fetch("/api/solana/merchant-receipts/mint", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          receiptId: receipt.id,
          receipt,
          solanaOwner: owner,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Unable to mint Bubblegum receipt credential.");
      try {
        if (owner) {
          window.localStorage.setItem("jiagon:solana-owner", owner);
        }
      } catch {
        // Solana owner cache is best-effort; the accepted mint response is authoritative.
      }

      const updates: Partial<ClaimReceipt> = {
        mintStatus: payload.status === "minted" ? "minted" : "prepared",
        credentialId: payload.credentialId,
        credentialChain: payload.credentialChain,
        standard: payload.standard,
        dataHash: payload.dataHash,
        storageUri: payload.storageUri,
        solanaOwner: payload.solanaOwner,
        credentialTx: payload.credentialTx || null,
        explorerUrl: payload.explorerUrl || null,
        assetExplorerUrl: payload.assetExplorerUrl || null,
        creditImpact: payload.creditImpact || receipt.creditImpact,
      };
      const nextReceipt = { ...receipt, ...updates };
      setReceipt(nextReceipt);
      setMintResult(payload);
      mergeStoredMerchantReceipt(nextReceipt, (user as { id?: string } | null)?.id, updates);
    } catch (mintError) {
      setError(mintError instanceof Error ? mintError.message : "Unable to mint Bubblegum receipt credential.");
    } finally {
      setMinting(false);
    }
  };

  return (
    <main className="claim-page">
      <style>{claimStyles}</style>
      <section className="claim-shell">
        <header className="claim-header">
          <a className="claim-brand" href="/">
            <img src="/jiagon-logo-mark.png" alt="" />
            <span>Jiagon</span>
          </a>
          <a className="claim-nav" href="/merchant">Merchant dashboard</a>
        </header>

        <section className="claim-card">
          <div className="claim-kicker">Receipt claim</div>
          <h1>{loading ? "Loading receipt." : receipt ? "Claim this receipt." : "Receipt unavailable."}</h1>
          <p>
            Merchant-issued receipts become wallet-bound Jiagon passport entries. Minting to Bubblegum cNFT is the next
            step after claim.
          </p>

          <div className="claim-flow" aria-label="Receipt credit flow">
            <div className={receipt ? "is-active" : ""}>
              <span>1</span>
              <strong>Review receipt</strong>
              <small>merchant signed</small>
            </div>
            <div className={receiptClaimed ? "is-active" : ""}>
              <span>2</span>
              <strong>Claim passport</strong>
              <small>Privy account</small>
            </div>
            <div className={receiptMinted || receiptPrepared ? "is-active" : ""}>
              <span>3</span>
              <strong>Mint cNFT</strong>
              <small>{creditUnlocked ? "credit unlocked" : receiptPrepared ? "prepared only" : "unlock credit"}</small>
            </div>
          </div>

          {receipt && (
            <div className="claim-receipt">
              <div>
                <span>Merchant</span>
                <strong>{receipt.merchantName}</strong>
              </div>
              <div>
                <span>Amount</span>
                <strong>
                  ${receipt.amountUsd} {receipt.currency}
                </strong>
              </div>
              <div>
                <span>Purpose</span>
                <strong>{receipt.purpose}</strong>
              </div>
              <div>
                <span>Receipt id</span>
                <strong>{receipt.receiptNumber}</strong>
              </div>
              <div>
                <span>Hash</span>
                <strong>{shortHash(receipt.receiptHash)}</strong>
              </div>
              <div>
                <span>Signature</span>
                <strong>{shortHash(receipt.signature)}</strong>
              </div>
            </div>
          )}

          {error && <div className="claim-error">{error}</div>}
          {claimed && (
            <div className="claim-success">
              Receipt claimed into your Jiagon account. Mint the Bubblegum receipt credential here to unlock deposit
              credit when onchain minting is configured.
            </div>
          )}
          {receiptClaimed && (
            <div className="claim-mint-panel">
              <div>
                <span>Solana receipt owner</span>
                <strong>{receiptMinted ? "Receipt credential minted" : receiptPrepared ? "Receipt credential prepared" : "Ready for Bubblegum"}</strong>
                <p>
                  {creditUnlocked
                    ? `This receipt unlocked $${receipt?.creditImpact?.unlockedCreditUsd || mintResult?.creditImpact?.unlockedCreditUsd || 25} of purpose-bound credit.`
                    : receiptPrepared
                      ? "Prepared is not an onchain mint. Configure the Bubblegum tree and minter to unlock credit."
                      : "Paste a Solana owner public key, or use the configured demo owner if available."}
                </p>
              </div>
              {!receiptMinted && (
                <input
                  value={solanaOwner}
                  onChange={(event) => setSolanaOwner(event.target.value)}
                  placeholder="Solana owner public key"
                  aria-label="Solana receipt owner"
                />
              )}
              {mintResult?.note && <small>{mintResult.note}</small>}
              <div className="claim-mint-actions">
                <button type="button" disabled={!ready || loading || minting || !receipt || receiptMinted} onClick={mintReceipt}>
                  {minting ? "Minting receipt..." : receiptMinted ? "Minted" : receiptPrepared ? "Retry real mint" : "Mint Bubblegum receipt"}
                </button>
                {creditUnlocked ? <a href="/credit">Open Credit</a> : <a href="/passport">Open Passport</a>}
              </div>
            </div>
          )}

          <div className="claim-actions">
            <button type="button" disabled={!ready || loading || !receipt || claiming || receipt?.status !== "issued"} onClick={claimReceipt}>
              {!ready
                ? "Loading Privy"
                : !authenticated
                  ? "Log in to claim"
                  : claiming
                    ? "Claiming receipt..."
                    : receipt?.status === "claimed"
                      ? "Already claimed"
                      : "Claim receipt"}
            </button>
            <a href="/passport">Open Passport</a>
          </div>
        </section>
      </section>
    </main>
  );
}

export default function ClaimReceiptPage() {
  const params = useParams<{ token?: string | string[] }>();
  const token = Array.isArray(params.token) ? params.token[0] : params.token || "";
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  if (!appId) {
    return (
      <main className="claim-page">
        <style>{claimStyles}</style>
        <section className="claim-shell">
          <section className="claim-card">
            <div className="claim-kicker">Receipt claim</div>
            <h1>Privy is not configured.</h1>
            <p>Set NEXT_PUBLIC_PRIVY_APP_ID to claim merchant-issued receipts into a wallet-bound Jiagon account.</p>
          </section>
        </section>
      </main>
    );
  }

  return (
    <PrivyProvider appId={appId} config={privyConfig}>
      <ClaimContent token={token} />
    </PrivyProvider>
  );
}

const claimStyles = `
.claim-page{min-height:100vh;background:radial-gradient(circle at 18% 0%,oklch(0.98 0.008 105) 0 260px,transparent 430px),linear-gradient(135deg,oklch(0.945 0.016 115) 0%,oklch(0.91 0.014 92) 58%,oklch(0.90 0.018 128) 100%);color:var(--ink);padding:24px clamp(18px,4vw,56px) 48px}.claim-shell{max-width:980px;margin:0 auto}.claim-header{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:54px}.claim-brand{display:flex;align-items:center;gap:10px;color:var(--verified);text-decoration:none}.claim-brand img{width:54px;height:60px;object-fit:contain;filter:drop-shadow(0 10px 20px rgba(24,58,38,.10))}.claim-brand span{font-family:var(--display);font-size:34px;line-height:.9}.claim-nav{min-height:36px;display:inline-flex;align-items:center;border:.5px solid var(--rule);border-radius:8px;background:oklch(0.992 0.004 100 / .75);padding:0 12px;color:var(--ink-muted);font-size:13px;font-weight:800;text-decoration:none}.claim-card{border:.5px solid var(--rule);border-radius:12px;background:oklch(0.992 0.004 100 / .88);box-shadow:0 22px 80px rgba(24,58,38,.10);padding:clamp(20px,4vw,34px)}.claim-kicker{font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--ink-muted)}.claim-card h1{max-width:720px;margin:10px 0 0;font-family:var(--display);font-style:italic;font-weight:400;font-size:clamp(50px,7vw,84px);line-height:.9;color:var(--ink)}.claim-card p{max-width:680px;margin:16px 0 0;color:var(--ink-muted);font-size:16px;line-height:1.55}.claim-flow{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:22px}.claim-flow div{border:.5px solid var(--rule);border-radius:10px;background:var(--receipt);padding:12px;display:grid;gap:5px}.claim-flow div.is-active{background:var(--verified-soft);border-color:color-mix(in oklch,var(--verified) 26%,var(--rule))}.claim-flow span{width:24px;height:24px;border-radius:999px;display:grid;place-items:center;background:var(--bg);font-family:var(--mono);font-size:10px;font-weight:900;color:var(--ink)}.claim-flow strong{font-size:13px;color:var(--ink)}.claim-flow small{font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:.6px;color:var(--ink-muted)}.claim-receipt{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border:.5px solid var(--rule);border-radius:10px;overflow:hidden;margin-top:24px}.claim-receipt div{display:grid;gap:6px;padding:14px;border-right:.5px solid var(--rule);border-bottom:.5px solid var(--rule);background:oklch(0.985 0.005 95 / .74)}.claim-receipt div:nth-child(3n){border-right:none}.claim-receipt div:nth-last-child(-n+3){border-bottom:none}.claim-receipt span{font-family:var(--mono);font-size:9.5px;text-transform:uppercase;letter-spacing:.7px;color:var(--ink-muted)}.claim-receipt strong{min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:14px;color:var(--ink)}.claim-mint-panel{display:grid;gap:12px;margin-top:16px;border:.5px solid color-mix(in oklch,var(--verified) 28%,var(--rule));border-radius:10px;background:oklch(0.975 0.014 130 / .78);padding:14px}.claim-mint-panel span{font-family:var(--mono);font-size:9.5px;text-transform:uppercase;letter-spacing:.7px;color:var(--ink-muted)}.claim-mint-panel strong{display:block;margin-top:4px;font-size:16px;color:var(--ink)}.claim-mint-panel p{margin:6px 0 0;font-size:13px;line-height:1.45}.claim-mint-panel input{width:100%;min-height:44px;border:.5px solid var(--rule);border-radius:8px;background:var(--receipt);padding:0 12px;color:var(--ink);font:700 13px var(--ui)}.claim-mint-panel small{display:block;color:var(--ink-muted);font-size:12px;line-height:1.45}.claim-mint-actions{display:flex;flex-wrap:wrap;gap:10px}.claim-mint-actions button,.claim-mint-actions a{min-height:42px;display:inline-flex;align-items:center;justify-content:center;border-radius:9px;padding:0 14px;font-family:var(--ui);font-size:13px;font-weight:900;text-decoration:none}.claim-mint-actions button{border:none;background:var(--verified);color:var(--panel-text);cursor:pointer;box-shadow:0 10px 28px rgba(0,96,48,.14)}.claim-mint-actions button:disabled{opacity:.52;cursor:not-allowed}.claim-mint-actions a{border:.5px solid var(--rule);background:var(--receipt);color:var(--ink)}.claim-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}.claim-actions button,.claim-actions a{min-height:46px;display:inline-flex;align-items:center;justify-content:center;border-radius:10px;padding:0 16px;font-family:var(--ui);font-size:14px;font-weight:900;text-decoration:none}.claim-actions button{border:none;background:var(--verified);color:var(--panel-text);cursor:pointer;box-shadow:0 10px 28px rgba(0,96,48,.16)}.claim-actions button:disabled{opacity:.52;cursor:not-allowed}.claim-actions a{border:.5px solid var(--rule);background:var(--receipt);color:var(--ink)}.claim-error,.claim-success{margin-top:14px;border-radius:8px;padding:11px 12px;font-size:13px;font-weight:750}.claim-error{border:.5px solid oklch(0.76 .08 32);background:oklch(0.96 .03 42);color:oklch(0.38 .08 36)}.claim-success{border:.5px solid color-mix(in oklch,var(--verified) 32%,var(--rule));background:var(--verified-soft);color:var(--verified)}@media(max-width:760px){.claim-header{align-items:flex-start}.claim-flow{grid-template-columns:1fr}.claim-receipt{grid-template-columns:1fr}.claim-receipt div{border-right:none}.claim-receipt div:nth-last-child(-n+3){border-bottom:.5px solid var(--rule)}.claim-receipt div:last-child{border-bottom:none}}
`;

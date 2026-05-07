"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { fallbackMenu, merchantProfileForId } from "@/lib/merchantCatalog";

type MerchantOrderResponse = {
  order?: {
    id: string;
    pickupCode: string;
    status: string;
    subtotalUsd: string;
    proofLevel: string;
  };
  error?: string;
};

type MerchantReceiptClaimLookupResponse = {
  claimable?: boolean;
  claimUrl?: string;
  status?: string;
  message?: string;
  order?: {
    pickupCode: string;
    status: string;
    subtotalUsd: string;
    receiptClaimedAt?: string | null;
  };
  error?: string;
};

type ClaimOrder = NonNullable<MerchantReceiptClaimLookupResponse["order"]>;

function clampQuantity(value: string) {
  const parsed = Number.parseInt(value || "1", 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(Math.max(parsed, 1), 20);
}

function cleanReceiptPass(value: string | null) {
  return (value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, "")
    .slice(0, 16);
}

export default function TilePage() {
  const params = useParams<{ merchant?: string | string[] }>();
  const searchParams = useSearchParams();
  const merchantId = Array.isArray(params.merchant) ? params.merchant[0] : params.merchant || "raposa-coffee";
  const merchant = useMemo(() => {
    const profile = merchantProfileForId(merchantId);
    return {
      ...profile,
      name: searchParams.get("merchantName") || profile.name,
      location: searchParams.get("location") || profile.location,
      category: searchParams.get("category") || profile.category,
      purpose: searchParams.get("purpose") || profile.purpose,
    };
  }, [merchantId, searchParams]);
  const [selectedItemId, setSelectedItemId] = useState(merchant.menu[0]?.id || fallbackMenu[0].id);
  const [quantity, setQuantity] = useState(1);
  const [customerLabel, setCustomerLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [pickupCode, setPickupCode] = useState("");
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimMessage, setClaimMessage] = useState("");
  const [pairedPass, setPairedPass] = useState("");
  const [autoClaimAttempted, setAutoClaimAttempted] = useState(false);
  const [lookupOrder, setLookupOrder] = useState<ClaimOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [order, setOrder] = useState<MerchantOrderResponse["order"] | null>(null);
  const selectedItem = merchant.menu.find((item) => item.id === selectedItemId) || merchant.menu[0] || fallbackMenu[0];
  const subtotal = (Number(selectedItem.amountUsd) * quantity).toFixed(2);
  const isNfcStation = searchParams.get("station") === "raposa-counter" || searchParams.get("nfc") === "1";
  const activePass = cleanReceiptPass(pickupCode || pairedPass);
  const stationState = claimBusy
    ? "Checking"
    : isNfcStation && !activePass
      ? "Pair needed"
      : isNfcStation
        ? "NFC active"
        : activePass
          ? "Phone paired"
          : "Pair phone";
  const receiptState = lookupOrder?.receiptClaimedAt
    ? "Claimed"
    : lookupOrder?.status === "completed"
      ? "Receipt ready"
      : lookupOrder
        ? "Waiting payment"
        : activePass
          ? "Not checked"
          : "No pass";

  const issueUrl = useMemo(() => {
    const query = new URLSearchParams({
      merchantId,
      merchantName: merchant.name,
      location: merchant.location,
      category: merchant.category,
      purpose: merchant.purpose,
    });
    return `/merchant?${query.toString()}`;
  }, [merchant.category, merchant.location, merchant.name, merchant.purpose, merchantId]);

  async function recordPilotEvent(eventName: "qr_opened" | "order_started") {
    try {
      await fetch("/api/merchant/pilot-events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          merchantId,
          eventName,
          source: eventName === "qr_opened" ? "tile-open" : "tile-order",
        }),
      });
    } catch {
      // Pilot metrics should never block customer ordering.
    }
  }

  useEffect(() => {
    void recordPilotEvent("qr_opened");
    // Record only when the tile/NFC landing page changes merchant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchantId]);

  useEffect(() => {
    const storageKey = `jiagon:receipt-pass:${merchantId}`;
    const urlPass = cleanReceiptPass(
      searchParams.get("pass") || searchParams.get("receiptPass") || searchParams.get("pickupCode"),
    );
    if (urlPass) {
      window.localStorage.setItem(storageKey, urlPass);
      setPickupCode(urlPass);
      setPairedPass(urlPass);
      setLookupOrder(null);
      setAutoClaimAttempted(false);
      setClaimMessage(
        isNfcStation
          ? "NFC station detected. Checking your paired Order Pass..."
          : "Order Pass paired with this phone. Tap the Raposa NFC station after staff confirms payment.",
      );
      return;
    }

    const storedPass = cleanReceiptPass(window.localStorage.getItem(storageKey));
    if (storedPass) {
      setPickupCode(storedPass);
      setPairedPass(storedPass);
      setLookupOrder(null);
      setAutoClaimAttempted(false);
      setClaimMessage(
        isNfcStation
          ? "NFC station detected. Checking your paired Order Pass..."
          : "Found your paired Order Pass on this phone. Tap the Raposa NFC station after payment to claim.",
      );
      return;
    }

    window.localStorage.removeItem(storageKey);
    setPickupCode("");
    setPairedPass("");
    setLookupOrder(null);
    setAutoClaimAttempted(false);
    setClaimMessage("");
  }, [isNfcStation, merchantId, searchParams]);

  function clearPairedPass() {
    window.localStorage.removeItem(`jiagon:receipt-pass:${merchantId}`);
    setPickupCode("");
    setPairedPass("");
    setLookupOrder(null);
    setAutoClaimAttempted(false);
    setClaimMessage("Ready for another Order Pass.");
  }

  const lookupReceiptClaimByCode = useCallback(async (code: string, options: { auto?: boolean } = {}) => {
    const cleanedCode = cleanReceiptPass(code);
    if (!cleanedCode) {
      setClaimMessage("Enter your Order Pass from Telegram.");
      setLookupOrder(null);
      return;
    }

    setClaimBusy(true);
    setClaimMessage("");
    setError("");

    try {
      const query = new URLSearchParams({
        merchantId,
        pickupCode: cleanedCode,
      });
      const response = await fetch(`/api/merchant/orders/claim?${query.toString()}`, { cache: "no-store" });
      const payload = await response.json() as MerchantReceiptClaimLookupResponse;
      if (!response.ok && response.status !== 404) {
        throw new Error(payload.error || "Unable to find receipt.");
      }
      setLookupOrder(payload.order || null);
      if (payload.claimable && payload.claimUrl) {
        window.location.assign(payload.claimUrl);
        return;
      }
      setClaimMessage(
        (isNfcStation && payload.order?.status !== "completed"
          ? "Waiting for Raposa to confirm counter payment. Tap NFC again after staff taps Paid + Done."
          : payload.message) ||
          (options.auto
            ? "Your Order Pass is paired. Ask staff to confirm payment and tap Paid + Done, then tap NFC again."
            : "Receipt is not ready yet. Ask staff to tap Paid + Done."),
      );
    } catch (lookupError) {
      setError(lookupError instanceof Error ? lookupError.message : "Unable to find receipt.");
      setLookupOrder(null);
    } finally {
      setClaimBusy(false);
    }
  }, [isNfcStation, merchantId]);

  useEffect(() => {
    if (!isNfcStation || !pairedPass || autoClaimAttempted) return;
    setAutoClaimAttempted(true);
    void lookupReceiptClaimByCode(pairedPass, { auto: true });
  }, [autoClaimAttempted, isNfcStation, lookupReceiptClaimByCode, pairedPass]);

  async function lookupReceiptClaim(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanedCode = cleanReceiptPass(pickupCode);
    if (cleanedCode) {
      window.localStorage.setItem(`jiagon:receipt-pass:${merchantId}`, cleanedCode);
      setPairedPass(cleanedCode);
      setPickupCode(cleanedCode);
    }
    if (!isNfcStation) {
      setClaimMessage("Order Pass paired with this phone. Tap the Raposa NFC station to claim after staff confirms payment.");
      return;
    }
    await lookupReceiptClaimByCode(cleanedCode);
  }

  async function submitOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setOrder(null);

    try {
      void recordPilotEvent("order_started");
      const response = await fetch("/api/merchant/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          merchantId,
          merchantName: merchant.name,
          location: merchant.location,
          source: "tile",
          customerLabel,
          notes,
          items: [
            {
              id: selectedItem.id,
              name: selectedItem.name,
              quantity,
              unitAmountUsd: selectedItem.amountUsd,
            },
          ],
        }),
      });
      const payload = await response.json() as MerchantOrderResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Order failed.");
      }
      if (!payload.order) {
        throw new Error("Order response is missing.");
      }
      setOrder(payload.order);
      setNotes("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Order failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="tile-page">
      <style>{tileStyles}</style>
      <section className="tile-shell">
        <header className="tile-header">
          <a className="tile-brand" href="/passport">
            <img src="/jiagon-logo-mark.png" alt="" />
            <span>Jiagon</span>
          </a>
          <a className="tile-nav" href="/passport">Passport</a>
        </header>

        <section className="tile-card">
          <div className="tile-kicker">NFC / Telegram order tile</div>
          <h1>{isNfcStation ? "Tap to claim." : "Pair for NFC."}</h1>
          <p>
            {isNfcStation
              ? `This NFC station is for receipt pickup at ${merchant.name}. After staff confirms payment and taps Paid + Done, Jiagon checks the paired Order Pass and opens the verified receipt claim.`
              : `This page pairs an Order Pass with this phone. It does not claim a receipt. After paying at ${merchant.name}, tap the physical NFC station to pick up the verified receipt.`}
          </p>

          <div className="tile-grid">
            <div>
              <span>Merchant</span>
              <strong>{merchant.name}</strong>
            </div>
            <div>
              <span>Location</span>
              <strong>{merchant.location}</strong>
            </div>
            <div>
              <span>Station</span>
              <strong>{stationState}</strong>
            </div>
            <div>
              <span>Receipt</span>
              <strong>{receiptState}</strong>
            </div>
          </div>

          <div className="tile-status">
            <div>
              <span>{isNfcStation ? "NFC station" : "Phone pairing"}</span>
              <strong>
                {isNfcStation
                  ? activePass
                    ? "Order Pass detected"
                    : "Pair your phone first"
                  : activePass
                    ? "Phone ready for NFC pickup"
                    : "Pair an Order Pass"}
              </strong>
              <p>
                {isNfcStation
                  ? activePass
                    ? "Jiagon will open the receipt claim only after Raposa confirms payment."
                    : "Open the pairing link from Telegram first, then tap this NFC station again."
                  : "This link only stores the Order Pass on this phone. The receipt pickup still requires the physical NFC station."}
              </p>
            </div>
            {activePass ? (
              <button type="button" onClick={clearPairedPass}>
                Use another pass
              </button>
            ) : null}
          </div>

          <form className="tile-claim" onSubmit={lookupReceiptClaim}>
            <div>
              <span>Order Pass</span>
              <strong>{pickupCode.trim() || "A______"}</strong>
            </div>
            <label className="tile-field">
              <span>Order Pass from Telegram</span>
              <input
                value={pickupCode}
                onChange={(event) => setPickupCode(event.target.value.toUpperCase())}
                placeholder="A0K92Q"
                maxLength={16}
              />
            </label>
            {claimMessage ? <p className="tile-alert success">{claimMessage}</p> : null}
            <button className="tile-submit" type="submit" disabled={claimBusy || pickupCode.trim().length < 2}>
              {claimBusy ? "Checking..." : isNfcStation ? "Check receipt" : "Pair phone"}
            </button>
          </form>

          <form className="tile-order" onSubmit={submitOrder}>
            <div className="tile-section-label">Demo order fallback</div>
            <div className="tile-order-head">
              <div>
                <span>Order</span>
                <strong>${subtotal}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong>{order ? order.status : "Ready"}</strong>
              </div>
            </div>

            <div className="tile-menu">
              {merchant.menu.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={selectedItem.id === item.id ? "selected" : ""}
                  onClick={() => setSelectedItemId(item.id)}
                >
                  <span>{item.name}</span>
                  <strong>${item.amountUsd}</strong>
                </button>
              ))}
            </div>

            <label className="tile-field">
              <span>Quantity</span>
              <input
                type="number"
                min="1"
                max="20"
                value={quantity}
                onChange={(event) => setQuantity(clampQuantity(event.target.value))}
              />
            </label>
            <label className="tile-field">
              <span>Name or table</span>
              <input
                value={customerLabel}
                onChange={(event) => setCustomerLabel(event.target.value)}
                placeholder="Alex / Table 4"
                maxLength={80}
              />
            </label>
            <label className="tile-field">
              <span>Notes</span>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Less ice, pickup time, allergy notes"
                maxLength={280}
              />
            </label>

            {error ? <p className="tile-alert error">{error}</p> : null}
            {order ? (
              <p className="tile-alert success">
                Order Pass #{order.pickupCode} is pending counter payment confirmation. Show this pass at pickup; receipt proof upgrades after staff taps Paid + Done.
              </p>
            ) : null}

            <button className="tile-submit" type="submit" disabled={busy}>
              {busy ? "Sending order..." : "Send order"}
            </button>
          </form>

          <div className="tile-actions">
            <a href={issueUrl}>Merchant receipt issuer</a>
            <a href="/merchant">Open dashboard</a>
          </div>
        </section>
      </section>
    </main>
  );
}

const tileStyles = `
.tile-page{min-height:100vh;background:radial-gradient(circle at 14% 0%,oklch(0.98 0.008 105) 0 260px,transparent 430px),linear-gradient(135deg,oklch(0.945 0.016 115) 0%,oklch(0.91 0.014 92) 58%,oklch(0.90 0.018 128) 100%);color:var(--ink);padding:24px clamp(18px,4vw,56px) 48px}.tile-shell{max-width:1040px;margin:0 auto}.tile-header{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:44px}.tile-brand{display:flex;align-items:center;gap:10px;color:var(--verified);text-decoration:none}.tile-brand img{width:54px;height:60px;object-fit:contain;filter:drop-shadow(0 10px 20px rgba(24,58,38,.10))}.tile-brand span{font-family:var(--display);font-size:34px;line-height:.9}.tile-nav{min-height:36px;display:inline-flex;align-items:center;border:.5px solid var(--rule);border-radius:8px;background:oklch(0.992 0.004 100 / .75);padding:0 12px;color:var(--ink-muted);font-size:13px;font-weight:800;text-decoration:none}.tile-card{border:.5px solid var(--rule);border-radius:12px;background:oklch(0.992 0.004 100 / .88);box-shadow:0 22px 80px rgba(24,58,38,.10);padding:clamp(22px,4vw,36px)}.tile-kicker{font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--ink-muted)}.tile-card h1{margin:10px 0 0;font-family:var(--display);font-style:italic;font-weight:400;font-size:clamp(56px,8vw,96px);line-height:.88;color:var(--ink)}.tile-card p{max-width:760px;margin:16px 0 0;color:var(--ink-muted);font-size:16px;line-height:1.55}.tile-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:.5px solid var(--rule);border-radius:10px;overflow:hidden;margin-top:24px}.tile-grid div{display:grid;gap:6px;padding:14px;border-right:.5px solid var(--rule);background:oklch(0.985 0.005 95 / .76)}.tile-grid div:last-child{border-right:none}.tile-grid span,.tile-order-head span,.tile-field span,.tile-claim span,.tile-status span{font-family:var(--mono);font-size:9.5px;text-transform:uppercase;letter-spacing:.7px;color:var(--ink-muted)}.tile-grid strong{font-size:14px;color:var(--ink)}.tile-status{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-top:14px;border:.5px solid color-mix(in oklch,var(--verified) 24%,var(--rule));border-radius:10px;background:linear-gradient(135deg,oklch(0.97 0.025 145 / .82),oklch(0.992 0.004 100 / .84));padding:14px 16px}.tile-status div{min-width:0}.tile-status strong{display:block;margin-top:5px;font-size:18px;color:var(--ink)}.tile-status p{margin:7px 0 0;max-width:620px;font-size:13px;line-height:1.45}.tile-status button{flex:0 0 auto;min-height:38px;border:.5px solid color-mix(in oklch,var(--verified) 35%,var(--rule));border-radius:8px;background:oklch(0.996 0.003 100 / .85);padding:0 12px;color:var(--verified);font-size:13px;font-weight:900;cursor:pointer}.tile-claim{display:grid;grid-template-columns:minmax(140px,.36fr) minmax(0,1fr) auto;gap:12px;align-items:end;margin-top:24px;border:.5px solid color-mix(in oklch,var(--verified) 30%,var(--rule));border-radius:10px;background:oklch(0.96 0.026 145 / .58);padding:16px}.tile-claim>div{display:grid;gap:6px}.tile-claim strong{font-size:28px;line-height:1;color:var(--ink)}.tile-order{display:grid;gap:14px;margin-top:24px;border:.5px solid var(--rule);border-radius:10px;background:oklch(0.985 0.006 105 / .8);padding:16px}.tile-section-label{font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:var(--ink-muted)}.tile-order-head{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.tile-order-head div{display:grid;gap:4px;border:.5px solid var(--rule);border-radius:8px;background:oklch(0.996 0.003 100 / .8);padding:12px}.tile-order-head strong{font-size:22px;color:var(--ink)}.tile-menu{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.tile-menu button{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;text-align:left;border:.5px solid var(--rule);border-radius:8px;background:var(--receipt);min-height:54px;padding:10px 12px;color:var(--ink);cursor:pointer}.tile-menu button.selected{border-color:oklch(0.45 0.12 145);box-shadow:inset 0 0 0 1px oklch(0.45 0.12 145 / .35);background:oklch(0.95 0.032 145)}.tile-menu span{font-size:14px;font-weight:850}.tile-menu strong{font-size:13px;color:var(--verified)}.tile-field{display:grid;gap:7px}.tile-field input,.tile-field textarea{width:100%;border:.5px solid var(--rule);border-radius:8px;background:oklch(0.996 0.003 100);color:var(--ink);font:inherit;font-size:15px;padding:11px 12px;outline:none}.tile-field textarea{min-height:78px;resize:vertical}.tile-alert{border-radius:8px;padding:10px 12px!important;margin:0!important;font-size:13px!important;line-height:1.45!important}.tile-alert.error{border:.5px solid oklch(0.62 0.16 28 / .35);background:oklch(0.96 0.035 32);color:oklch(0.36 0.11 28)}.tile-alert.success{border:.5px solid oklch(0.54 0.12 145 / .32);background:oklch(0.95 0.032 145);color:var(--verified)}.tile-submit{min-height:48px;border:none;border-radius:10px;background:var(--verified);color:var(--panel-text);font-weight:950;font-size:14px;cursor:pointer;box-shadow:0 10px 28px rgba(0,96,48,.16)}.tile-submit:disabled{cursor:wait;opacity:.72}.tile-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}.tile-actions a{min-height:42px;display:inline-flex;align-items:center;justify-content:center;border-radius:10px;padding:0 14px;font-size:13px;font-weight:900;text-decoration:none}.tile-actions a:first-child{border:.5px solid var(--rule);background:var(--receipt);color:var(--ink)}.tile-actions a:last-child{border:.5px solid var(--rule);background:oklch(0.992 0.004 100 / .75);color:var(--ink)}@media(max-width:760px){.tile-header{align-items:flex-start}.tile-grid,.tile-claim,.tile-order-head,.tile-menu{grid-template-columns:1fr}.tile-grid div{border-right:none;border-bottom:.5px solid var(--rule)}.tile-grid div:last-child{border-bottom:none}.tile-status{align-items:flex-start;flex-direction:column}.tile-status button{width:100%}}
`;

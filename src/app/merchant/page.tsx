"use client";

import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import type { DemoReadinessResponse } from "@/lib/demoReadiness";

type IssuedReceiptResponse = {
  mode: string;
  persistence: {
    configured: boolean;
    persisted: boolean;
    error?: string;
  };
  claimUrl: string;
  receipt: {
    id: string;
    merchantId: string;
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
  };
};

type MerchantOrderItem = {
  id: string;
  name: string;
  quantity: number;
  unitAmountCents: number;
};

type MerchantOrderStatus = "pending" | "accepted" | "completed" | "cancelled";
type MerchantOrderPaymentStatus = "waiting_counter_payment" | "merchant_attested_paid" | "cancelled";

type MerchantOrder = {
  id: string;
  pickupCode: string;
  merchantId: string;
  merchantName: string;
  location: string | null;
  customerLabel: string | null;
  source: "tile" | "telegram" | "web" | "agent";
  status: MerchantOrderStatus;
  items: MerchantOrderItem[];
  subtotalCents: number;
  subtotalUsd: string;
  paymentProvider: "external_pos";
  paymentStatus: MerchantOrderPaymentStatus;
  notes: string | null;
  proofLevel: string;
  receiptId: string | null;
  receiptClaimUrl: string | null;
  receiptHash: string | null;
  receiptIssuedAt: string | null;
  receiptClaimedAt: string | null;
  receiptClaimedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

type PilotMetrics = {
  merchantId: string;
  qrOpened: number;
  orderStarted: number;
  orderConfirmed: number;
  merchantDone: number;
  receiptClaimed: number;
  reviewSubmitted: number;
  estimatedGmvUsd: string;
};

type CreditMemo = {
  merchantId: string;
  merchantName: string;
  title: string;
  telegramOrders: number;
  merchantCompleted: number;
  customerClaimed: number;
  receiptGatedReviews: number;
  estimatedGmvUsd: string;
  proofLevel: string;
  suggestedNextProofUpgrade: string;
  suggestedPurposeCredit: string;
  note: string;
};

type MerchantOrdersResponse = {
  mode?: string;
  orders?: MerchantOrder[];
  order?: MerchantOrder;
  claimUrl?: string;
  receipt?: {
    id: string;
    receiptHash: string;
    claimUrl: string;
  } | null;
  error?: string;
};

type PilotMetricsResponse = {
  metrics?: PilotMetrics;
  error?: string;
};

type CreditMemoResponse = {
  memo?: CreditMemo;
  error?: string;
};

const defaultMerchant = {
  merchantName: "Raposa Coffee",
  merchantId: "raposa-coffee",
  location: "Miami Beach",
  amountUsd: "6.50",
  category: "Cafe",
  purpose: "cafe_purchase",
  receiptNumber: "RAP-001",
  issuedBy: "Jiagon demo merchant",
  memo: "Merchant-issued receipt for Jiagon receipt passport demo.",
};

function merchantFromQuery() {
  if (typeof window === "undefined") return defaultMerchant;
  const search = new URLSearchParams(window.location.search);
  return {
    ...defaultMerchant,
    merchantName: search.get("merchantName") || defaultMerchant.merchantName,
    merchantId: search.get("merchantId") || defaultMerchant.merchantId,
    location: search.get("location") || defaultMerchant.location,
    category: search.get("category") || defaultMerchant.category,
    purpose: search.get("purpose") || defaultMerchant.purpose,
  };
}

function shortHash(value?: string | null) {
  if (!value) return "not signed";
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

function orderLineItems(items: MerchantOrderItem[]) {
  return items.map((item) => `${item.quantity}x ${item.name}`).join(", ");
}

function statusLabel(status: MerchantOrderStatus) {
  if (status === "accepted") return "Accepted";
  if (status === "completed") return "Completed";
  if (status === "cancelled") return "Cancelled";
  return "Pending";
}

function paymentStatusLabel(status: MerchantOrderPaymentStatus) {
  if (status === "merchant_attested_paid") return "Paid via counter POS";
  if (status === "cancelled") return "Cancelled";
  return "Waiting counter payment";
}

export default function MerchantPage() {
  const [form, setForm] = useState(merchantFromQuery);
  const [issuerKey, setIssuerKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<IssuedReceiptResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [qrUrl, setQrUrl] = useState("");
  const [orders, setOrders] = useState<MerchantOrder[]>([]);
  const [ordersMode, setOrdersMode] = useState("");
  const [ordersBusy, setOrdersBusy] = useState(false);
  const [ordersError, setOrdersError] = useState("");
  const [orderActionId, setOrderActionId] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState<MerchantOrderStatus | "all">("pending");
  const [orderQrUrls, setOrderQrUrls] = useState<Record<string, string>>({});
  const [copiedOrderId, setCopiedOrderId] = useState("");
  const [pilotMetrics, setPilotMetrics] = useState<PilotMetrics | null>(null);
  const [creditMemo, setCreditMemo] = useState<CreditMemo | null>(null);
  const [pilotBusy, setPilotBusy] = useState(false);
  const [pilotError, setPilotError] = useState("");
  const [demoReadiness, setDemoReadiness] = useState<DemoReadinessResponse | null>(null);
  const [readinessBusy, setReadinessBusy] = useState(false);
  const [readinessError, setReadinessError] = useState("");

  const canSubmit = useMemo(() => {
    return form.merchantName.trim().length >= 2 && Number(form.amountUsd) > 0 && !busy;
  }, [busy, form.amountUsd, form.merchantName]);
  const merchantSetup = useMemo(() => {
    const merchantId = form.merchantId.trim() || "merchant";
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    const profile = new URLSearchParams({
      merchantName: form.merchantName.trim() || defaultMerchant.merchantName,
      location: form.location.trim() || defaultMerchant.location,
      category: form.category.trim() || defaultMerchant.category,
      purpose: form.purpose.trim() || defaultMerchant.purpose,
    });
    const dashboard = new URLSearchParams({
      merchantId,
      merchantName: form.merchantName.trim() || defaultMerchant.merchantName,
      location: form.location.trim() || defaultMerchant.location,
      category: form.category.trim() || defaultMerchant.category,
      purpose: form.purpose.trim() || defaultMerchant.purpose,
    });

    return {
      merchantId,
      dashboardUrl: `${origin}/merchant?${dashboard.toString()}`,
      customerTileUrl: `${origin}/tile/${encodeURIComponent(merchantId)}?${profile.toString()}`,
      nfcStationUrl: `${origin}/tile/${encodeURIComponent(merchantId)}?nfc=1&${profile.toString()}`,
    };
  }, [form.category, form.location, form.merchantId, form.merchantName, form.purpose]);

  const update = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const orderHeaders = () => ({
    ...(issuerKey.trim() ? { "x-jiagon-merchant-key": issuerKey.trim() } : {}),
  });

  const loadOrders = async () => {
    setOrdersBusy(true);
    setOrdersError("");

    try {
      const query = new URLSearchParams({
        merchantId: form.merchantId,
        limit: "25",
      });
      if (orderStatusFilter !== "all") query.set("status", orderStatusFilter);

      const response = await fetch(`/api/merchant/orders?${query.toString()}`, {
        headers: orderHeaders(),
      });
      const payload = await response.json() as MerchantOrdersResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Unable to load merchant orders.");
      }
      setOrders(payload.orders || []);
      setOrdersMode(payload.mode || "");
    } catch (loadError) {
      setOrders([]);
      setOrdersMode("");
      setOrdersError(loadError instanceof Error ? loadError.message : "Unable to load merchant orders.");
    } finally {
      setOrdersBusy(false);
    }
  };

  const loadPilotSummary = async () => {
    setPilotBusy(true);
    setPilotError("");

    try {
      const query = new URLSearchParams({
        merchantId: form.merchantId,
      });
      const memoQuery = new URLSearchParams({
        merchantId: form.merchantId,
        merchantName: form.merchantName,
      });

      const [metricsResponse, memoResponse] = await Promise.all([
        fetch(`/api/merchant/pilot-metrics?${query.toString()}`, {
          headers: orderHeaders(),
        }),
        fetch(`/api/merchant/credit-memo?${memoQuery.toString()}`, {
          headers: orderHeaders(),
        }),
      ]);
      const [metricsPayload, memoPayload] = await Promise.all([
        metricsResponse.json() as Promise<PilotMetricsResponse>,
        memoResponse.json() as Promise<CreditMemoResponse>,
      ]);

      if (!metricsResponse.ok) {
        throw new Error(metricsPayload.error || "Unable to load pilot metrics.");
      }
      if (!memoResponse.ok) {
        throw new Error(memoPayload.error || "Unable to load credit memo.");
      }

      setPilotMetrics(metricsPayload.metrics || null);
      setCreditMemo(memoPayload.memo || null);
    } catch (loadError) {
      setPilotMetrics(null);
      setCreditMemo(null);
      setPilotError(loadError instanceof Error ? loadError.message : "Unable to load pilot summary.");
    } finally {
      setPilotBusy(false);
    }
  };

  const loadDemoReadiness = async () => {
    setReadinessBusy(true);
    setReadinessError("");

    try {
      const response = await fetch("/api/demo-readiness", { cache: "no-store", headers: orderHeaders() });
      const payload = await response.json() as DemoReadinessResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Unable to load demo readiness.");
      }
      setDemoReadiness(payload);
    } catch (loadError) {
      setDemoReadiness(null);
      setReadinessError(loadError instanceof Error ? loadError.message : "Unable to load demo readiness.");
    } finally {
      setReadinessBusy(false);
    }
  };

  const updateOrderStatus = async (orderId: string, status: MerchantOrderStatus) => {
    if (status === "completed") {
      await completeOrder(orderId);
      return;
    }

    setOrderActionId(`${orderId}:${status}`);
    setOrdersError("");

    try {
      const response = await fetch(`/api/merchant/orders/${encodeURIComponent(orderId)}/status`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          ...orderHeaders(),
        },
        body: JSON.stringify({ status }),
      });
      const payload = await response.json() as MerchantOrdersResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Unable to update merchant order.");
      }
      if (payload.order) {
        const updatedOrder = payload.order;
        setOrders((current) => {
          const nextOrders = current.map((order) => (order.id === updatedOrder.id ? updatedOrder : order));
          return orderStatusFilter === "all" || updatedOrder.status === orderStatusFilter
            ? nextOrders
            : nextOrders.filter((order) => order.id !== updatedOrder.id);
        });
        void loadPilotSummary();
      }
    } catch (actionError) {
      setOrdersError(actionError instanceof Error ? actionError.message : "Unable to update merchant order.");
    } finally {
      setOrderActionId("");
    }
  };

  const completeOrder = async (orderId: string) => {
    setOrderActionId(`${orderId}:completed`);
    setOrdersError("");
    setCopiedOrderId("");

    try {
      const response = await fetch(`/api/merchant/orders/${encodeURIComponent(orderId)}/complete`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...orderHeaders(),
        },
        body: JSON.stringify({ issuedBy: form.issuedBy }),
      });
      const payload = await response.json() as MerchantOrdersResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Unable to complete merchant order.");
      }
      if (payload.order) {
        const updatedOrder = payload.order;
        setOrderStatusFilter("all");
        setOrders((current) => {
          const exists = current.some((order) => order.id === updatedOrder.id);
          return exists
            ? current.map((order) => (order.id === updatedOrder.id ? updatedOrder : order))
            : [updatedOrder, ...current];
        });
        void loadPilotSummary();
      }
    } catch (actionError) {
      setOrdersError(actionError instanceof Error ? actionError.message : "Unable to complete merchant order.");
    } finally {
      setOrderActionId("");
    }
  };

  const issueReceipt = async () => {
    setBusy(true);
    setError("");
    setCopied(false);
    setIssued(null);

    try {
      const response = await fetch("/api/merchant/receipts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(issuerKey.trim() ? { "x-jiagon-merchant-key": issuerKey.trim() } : {}),
        },
        body: JSON.stringify(form),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.persistence?.error || payload?.error || "Unable to issue receipt.");
      }
      setIssued(payload);
    } catch (issueError) {
      setError(issueError instanceof Error ? issueError.message : "Unable to issue receipt.");
    } finally {
      setBusy(false);
    }
  };

  const copyClaimLink = async () => {
    if (!issued?.claimUrl) return;
    await navigator.clipboard.writeText(issued.claimUrl);
    setCopied(true);
  };

  const copyOrderClaimLink = async (order: MerchantOrder) => {
    if (!order.receiptClaimUrl) return;
    await navigator.clipboard.writeText(order.receiptClaimUrl);
    setCopiedOrderId(order.id);
  };

  useEffect(() => {
    let cancelled = false;
    if (!issued?.claimUrl) {
      setQrUrl("");
      return () => {
        cancelled = true;
      };
    }

    QRCode.toDataURL(issued.claimUrl, {
      width: 220,
      margin: 1,
      errorCorrectionLevel: "M",
      color: {
        dark: "#183a26",
        light: "#ffffff",
      },
    })
      .then((dataUrl) => {
        if (!cancelled) setQrUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setQrUrl("");
      });

    return () => {
      cancelled = true;
    };
  }, [issued?.claimUrl]);

  useEffect(() => {
    loadOrders();
    loadPilotSummary();
    loadDemoReadiness();
    // The first load intentionally uses the initial query-derived merchant profile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    const ordersWithClaims = orders.filter((order) => order.receiptClaimUrl);
    if (ordersWithClaims.length === 0) {
      setOrderQrUrls({});
      return () => {
        cancelled = true;
      };
    }

    Promise.allSettled(
      ordersWithClaims.map(async (order) => {
        const dataUrl = await QRCode.toDataURL(order.receiptClaimUrl || "", {
          width: 144,
          margin: 1,
          errorCorrectionLevel: "M",
          color: {
            dark: "#183a26",
            light: "#ffffff",
          },
        });
        return [order.id, dataUrl] as const;
      }),
    )
      .then((results) => {
        if (cancelled) return;
        const entries = results
          .filter((result): result is PromiseFulfilledResult<readonly [string, string]> => result.status === "fulfilled")
          .map((result) => result.value);
        setOrderQrUrls(Object.fromEntries(entries));
      });

    return () => {
      cancelled = true;
    };
  }, [orders]);

  const tileUrl = issued ? `${window.location.origin}/tile/${encodeURIComponent(issued.receipt.merchantId)}` : "";

  return (
    <main className="merchant-page">
      <style>{merchantStyles}</style>
      <style>{merchantEnhancementStyles}</style>
      <section className="merchant-shell">
        <header className="merchant-header">
          <a className="merchant-brand" href="/">
            <img src="/jiagon-logo-mark.png" alt="" />
            <span>Jiagon</span>
          </a>
          <nav>
            <a href="/">Receipts</a>
            <a href="/credit">Credit</a>
          </nav>
        </header>

        <div className="merchant-grid">
          <section className="merchant-copy">
            <div className="merchant-kicker">Merchant dashboard</div>
            <h1>Issue a wallet-bound receipt.</h1>
            <p>
              Create a merchant-issued receipt without POS integration. Jiagon returns a one-time claim link that a
              customer can claim into their receipt passport in the next step.
            </p>
            <div className="merchant-flow">
              <span>Issue receipt</span>
              <span>Claim link</span>
              <span>Passport ready</span>
            </div>
          </section>

          <section className="merchant-card">
            <div className="merchant-form-grid">
              <label>
                <span>Merchant</span>
                <input value={form.merchantName} onChange={(event) => update("merchantName", event.target.value)} />
              </label>
              <label>
                <span>Merchant slug</span>
                <input value={form.merchantId} onChange={(event) => update("merchantId", event.target.value)} />
              </label>
              <label>
                <span>Amount USD</span>
                <input inputMode="decimal" value={form.amountUsd} onChange={(event) => update("amountUsd", event.target.value)} />
              </label>
              <label>
                <span>Receipt id</span>
                <input value={form.receiptNumber} onChange={(event) => update("receiptNumber", event.target.value)} />
              </label>
              <label>
                <span>Category</span>
                <input value={form.category} onChange={(event) => update("category", event.target.value)} />
              </label>
              <label>
                <span>Purpose</span>
                <input value={form.purpose} onChange={(event) => update("purpose", event.target.value)} />
              </label>
              <label>
                <span>Location</span>
                <input value={form.location} onChange={(event) => update("location", event.target.value)} />
              </label>
              <label>
                <span>Issued by</span>
                <input value={form.issuedBy} onChange={(event) => update("issuedBy", event.target.value)} />
              </label>
              <label className="merchant-wide">
                <span>Memo</span>
                <textarea value={form.memo} onChange={(event) => update("memo", event.target.value)} />
              </label>
              <label className="merchant-wide">
                <span>Issuer key</span>
                <input
                  type="password"
                  autoComplete="off"
                  placeholder="Required outside local demo mode"
                  value={issuerKey}
                  onChange={(event) => setIssuerKey(event.target.value)}
                />
              </label>
            </div>

            {error && <div className="merchant-error">{error}</div>}

            <button className="merchant-primary" type="button" disabled={!canSubmit} onClick={issueReceipt}>
              {busy ? "Issuing receipt..." : "Issue receipt"}
            </button>
          </section>
        </div>

        <section className="merchant-readiness-panel">
          <div className="merchant-readiness-top">
            <div>
              <div className="merchant-kicker">Demo readiness</div>
              <h2>Consensus operator checks</h2>
              <p>
                Verify the live demo can run from Telegram order to Bubblegum receipt mint and devnet credit draw before
                standing at the counter.
              </p>
            </div>
            <button type="button" onClick={loadDemoReadiness} disabled={readinessBusy}>
              {readinessBusy ? "Checking..." : "Refresh checks"}
            </button>
          </div>
          {readinessError && <div className="merchant-error">{readinessError}</div>}
          <div className="merchant-readiness-summary">
            <span>{demoReadiness?.overall?.ready ? "Ready" : "Needs setup"}</span>
            <strong>
              {`${demoReadiness?.overall?.readyCount ?? 0}/${demoReadiness?.overall?.total ?? 0}`}
            </strong>
          </div>
          <div className="merchant-readiness-grid">
            {(demoReadiness?.checks || []).map((check) => (
              <article className="merchant-readiness-card" data-status={check.status} key={check.id}>
                <div>
                  <span>{check.label}</span>
                  <strong>{check.status === "ready" ? "Ready" : check.status === "blocked" ? "Blocked" : "Missing setup"}</strong>
                </div>
                <p>{check.detail}</p>
                <code>{check.mode}</code>
                {check.diagnostics?.length ? (
                  <ul>
                    {check.diagnostics.map((item, index) => (
                      <li key={`${check.id}-${index}`}>
                        {item.label}: {item.value}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {check.missingCount > 0 && <small>{check.missingCount} setup item{check.missingCount === 1 ? "" : "s"} missing</small>}
              </article>
            ))}
            {!demoReadiness?.checks?.length && !readinessError && (
              <article className="merchant-readiness-card" data-status="missing">
                <div>
                  <span>Checks</span>
                  <strong>{readinessBusy ? "Loading" : "Not loaded"}</strong>
                </div>
                <p>Refresh to inspect Telegram, Bubblegum, and devnet credit vault configuration.</p>
              </article>
            )}
          </div>
        </section>

        <section className="merchant-setup-panel">
          <div>
            <div className="merchant-kicker">Merchant onboarding</div>
            <h2>Set up a pilot without code changes</h2>
            <p>
              Use these URLs for a new cafe or restaurant pilot. Put the NFC station URL on a sticker, use the customer
              tile for Telegram or QR ordering, and keep this dashboard open for Paid + Done.
            </p>
          </div>
          <div className="merchant-setup-grid">
            {[
              ["Dashboard", merchantSetup.dashboardUrl],
              ["Customer tile", merchantSetup.customerTileUrl],
              ["NFC station", merchantSetup.nfcStationUrl],
            ].map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <code>{value}</code>
              </div>
            ))}
          </div>
          <div className="merchant-setup-flow">
            <span>1. Configure merchant</span>
            <span>2. Share tile</span>
            <span>3. Write NFC station URL</span>
            <span>4. Staff taps Paid + Done</span>
          </div>
        </section>

        <section className="merchant-order-panel">
          <div className="merchant-order-top">
            <div>
              <div className="merchant-kicker">Agentic POS queue</div>
              <h2>Incoming orders</h2>
              <p>
                Orders from NFC tiles or Telegram start as L0 intent. Accept or complete them to upgrade the merchant
                proof level before the receipt-claim step.
              </p>
            </div>
            <div className="merchant-order-controls">
              <label>
                <span>Merchant slug</span>
                <input value={form.merchantId} onChange={(event) => update("merchantId", event.target.value)} />
              </label>
              <label>
                <span>Status</span>
                <select
                  value={orderStatusFilter}
                  onChange={(event) => setOrderStatusFilter(event.target.value as MerchantOrderStatus | "all")}
                >
                  <option value="pending">Pending</option>
                  <option value="accepted">Accepted</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="all">All</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => {
                  void loadOrders();
                  void loadPilotSummary();
                }}
                disabled={ordersBusy || pilotBusy}
              >
                {ordersBusy || pilotBusy ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          <div className="merchant-pilot-grid">
            <div>
              <span>QR opens</span>
              <strong>{pilotMetrics?.qrOpened ?? 0}</strong>
            </div>
            <div>
              <span>Orders</span>
              <strong>{pilotMetrics?.orderConfirmed ?? 0}</strong>
            </div>
            <div>
              <span>Paid + Done</span>
              <strong>{pilotMetrics?.merchantDone ?? 0}</strong>
            </div>
            <div>
              <span>Claimed</span>
              <strong>{pilotMetrics?.receiptClaimed ?? 0}</strong>
            </div>
            <div>
              <span>Reviews</span>
              <strong>{pilotMetrics?.reviewSubmitted ?? 0}</strong>
            </div>
            <div>
              <span>GMV</span>
              <strong>${pilotMetrics?.estimatedGmvUsd ?? "0.00"}</strong>
            </div>
          </div>

          {creditMemo && (
            <section className="merchant-credit-memo">
              <div>
                <div className="merchant-kicker">Event credit memo</div>
                <h3>{creditMemo.proofLevel}</h3>
                <p>{creditMemo.note}</p>
              </div>
              <div className="merchant-credit-memo-grid">
                <div>
                  <span>Next proof</span>
                  <strong>{creditMemo.suggestedNextProofUpgrade}</strong>
                </div>
                <div>
                  <span>Purpose credit</span>
                  <strong>{creditMemo.suggestedPurposeCredit}</strong>
                </div>
              </div>
            </section>
          )}

          {ordersError && <div className="merchant-error">{ordersError}</div>}
          {pilotError && <div className="merchant-error">{pilotError}</div>}

          <div className="merchant-order-list">
            {orders.length === 0 ? (
              <div className="merchant-empty">
                <strong>No orders found</strong>
                <span>Open /tile/{form.merchantId || "raposa-coffee"} and send an order to populate this queue.</span>
              </div>
            ) : (
              orders.map((order) => {
                const canAccept = order.status === "pending";
                const canComplete = order.status === "pending" || order.status === "accepted";
                const canCancel = order.status === "pending" || order.status === "accepted";
                return (
                  <article className="merchant-order-row" key={order.id}>
                    <div className="merchant-order-main">
                      <div>
                        <span className={`merchant-status ${order.status}`}>{statusLabel(order.status)}</span>
                        <span className="merchant-pickup-code">#{order.pickupCode}</span>
                        <span className="merchant-pickup-code">{order.source}</span>
                        <strong>{order.customerLabel || "Walk-in customer"}</strong>
                      </div>
                      <p>{orderLineItems(order.items)}</p>
                      {order.notes && <p className="merchant-order-note">{order.notes}</p>}
                      <p className="merchant-order-note">{paymentStatusLabel(order.paymentStatus)}</p>
                    </div>
                    <div className="merchant-order-meta">
                      <span>${order.subtotalUsd}</span>
                      <code>{order.proofLevel}</code>
                      {order.receiptClaimedAt && <code>customer_claimed</code>}
                      <small>{new Date(order.createdAt).toLocaleString()}</small>
                    </div>
                    <div className="merchant-order-actions">
                      {canAccept && (
                        <button
                          type="button"
                          disabled={Boolean(orderActionId)}
                          onClick={() => updateOrderStatus(order.id, "accepted")}
                        >
                          {orderActionId === `${order.id}:accepted` ? "Accepting..." : "Accept"}
                        </button>
                      )}
                      {canComplete && (
                        <button
                          type="button"
                          disabled={Boolean(orderActionId)}
                          onClick={() => updateOrderStatus(order.id, "completed")}
                        >
                          {orderActionId === `${order.id}:completed` ? "Completing..." : "Paid + Done"}
                        </button>
                      )}
                      {canCancel && (
                        <button
                          type="button"
                          disabled={Boolean(orderActionId)}
                          onClick={() => updateOrderStatus(order.id, "cancelled")}
                        >
                          {orderActionId === `${order.id}:cancelled` ? "Cancelling..." : "Cancel"}
                        </button>
                      )}
                    </div>
                    {order.receiptClaimUrl && (
                      <div className="merchant-order-claim">
                        {orderQrUrls[order.id] ? (
                          <img src={orderQrUrls[order.id]} alt="QR code for this completed order receipt claim link" />
                        ) : (
                          <div className="merchant-order-qr-placeholder">QR</div>
                        )}
                        <div>
                          <span>Claimable receipt</span>
                          <code>{order.receiptClaimUrl}</code>
                          <div className="merchant-order-claim-actions">
                            <button type="button" onClick={() => copyOrderClaimLink(order)}>
                              {copiedOrderId === order.id ? "Copied" : "Copy claim link"}
                            </button>
                            <a href={order.receiptClaimUrl} target="_blank" rel="noreferrer">Open claim</a>
                          </div>
                          {order.receiptClaimedAt && (
                            <small>Claimed {new Date(order.receiptClaimedAt).toLocaleString()}</small>
                          )}
                        </div>
                      </div>
                    )}
                  </article>
                );
              })
            )}
          </div>

          {ordersMode && <div className="merchant-queue-mode">Storage: {ordersMode}</div>}
        </section>

        {issued && (
          <section className="merchant-result">
            <div>
              <div className="merchant-kicker">One-time claim link</div>
              <h2>{issued.receipt.merchantName}</h2>
              <p>
                ${issued.receipt.amountUsd} {issued.receipt.category} receipt issued. Claim flow is the next atomic PR.
              </p>
            </div>
            <div className="merchant-claim">
              <code>{issued.claimUrl}</code>
              <button type="button" onClick={copyClaimLink}>
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
            <div className="merchant-qr-wrap">
              {qrUrl ? (
                <img src={qrUrl} alt="QR code for the one-time receipt claim link" />
              ) : (
                <div className="merchant-qr-placeholder">QR</div>
              )}
              <div>
                <div className="merchant-kicker">NFC tile URL</div>
                <code>{tileUrl}</code>
                <p>NFC cards use the fixed tile URL. The QR claims this specific issued receipt.</p>
              </div>
            </div>
            <div className="merchant-proof-grid">
              <div>
                <span>Status</span>
                <strong>{issued.receipt.status}</strong>
              </div>
              <div>
                <span>Storage</span>
                <strong>{issued.mode}</strong>
              </div>
              <div>
                <span>Receipt hash</span>
                <strong>{shortHash(issued.receipt.receiptHash)}</strong>
              </div>
              <div>
                <span>Signature</span>
                <strong>{shortHash(issued.receipt.signature)}</strong>
              </div>
            </div>
            {issued.persistence.error && <div className="merchant-error">{issued.persistence.error}</div>}
          </section>
        )}
      </section>
    </main>
  );
}

const merchantStyles = `
.merchant-page{min-height:100vh;background:radial-gradient(circle at 12% 0%,oklch(0.98 0.008 105) 0 260px,transparent 430px),linear-gradient(135deg,oklch(0.945 0.016 115) 0%,oklch(0.91 0.014 92) 58%,oklch(0.90 0.018 128) 100%);color:var(--ink);padding:24px clamp(18px,4vw,56px) 48px}.merchant-shell{max-width:1160px;margin:0 auto}.merchant-header{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:44px}.merchant-brand{display:flex;align-items:center;gap:10px;color:var(--verified);text-decoration:none}.merchant-brand img{width:54px;height:60px;object-fit:contain;filter:drop-shadow(0 10px 20px rgba(24,58,38,.10))}.merchant-brand span{font-family:var(--display);font-size:34px;line-height:.9}.merchant-header nav{display:flex;gap:8px}.merchant-header nav a{min-height:36px;display:inline-flex;align-items:center;border:.5px solid var(--rule);border-radius:8px;background:oklch(0.992 0.004 100 / .75);padding:0 12px;color:var(--ink-muted);font-size:13px;font-weight:800;text-decoration:none}.merchant-grid{display:grid;grid-template-columns:minmax(0,.9fr) minmax(420px,1fr);gap:28px;align-items:start}.merchant-copy{padding-top:26px}.merchant-kicker{font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--ink-muted)}.merchant-copy h1{max-width:520px;margin:10px 0 0;font-family:var(--display);font-style:italic;font-weight:400;font-size:clamp(52px,7vw,86px);line-height:.9;color:var(--ink)}.merchant-copy p{max-width:520px;margin:18px 0 0;color:var(--ink-muted);font-size:16px;line-height:1.55}.merchant-flow{display:flex;flex-wrap:wrap;gap:8px;margin-top:24px}.merchant-flow span{border:.5px solid var(--rule);border-radius:999px;background:oklch(0.992 0.004 100 / .72);padding:8px 10px;font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.7px;color:var(--verified)}.merchant-card,.merchant-result,.merchant-order-panel,.merchant-readiness-panel{border:.5px solid var(--rule);border-radius:12px;background:oklch(0.992 0.004 100 / .86);box-shadow:0 22px 80px rgba(24,58,38,.10);padding:18px}.merchant-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.merchant-form-grid label{display:grid;gap:6px}.merchant-form-grid span,.merchant-order-controls span{font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.75px;color:var(--ink-muted)}.merchant-form-grid input,.merchant-form-grid textarea,.merchant-order-controls input,.merchant-order-controls select{width:100%;border:.5px solid var(--rule);border-radius:8px;background:var(--receipt);color:var(--ink);padding:11px 12px;font-family:var(--ui);font-size:14px;outline:none}.merchant-form-grid textarea{min-height:78px;resize:vertical}.merchant-form-grid input:focus,.merchant-form-grid textarea:focus,.merchant-order-controls input:focus,.merchant-order-controls select:focus{border-color:color-mix(in oklch,var(--verified) 48%,var(--rule));box-shadow:0 0 0 3px color-mix(in oklch,var(--verified-soft) 64%,transparent)}.merchant-wide{grid-column:1/-1}.merchant-primary{width:100%;min-height:48px;margin-top:14px;border:none;border-radius:10px;background:var(--verified);color:var(--panel-text);font-family:var(--ui);font-size:14px;font-weight:900;cursor:pointer;box-shadow:0 10px 28px rgba(0,96,48,.16)}.merchant-primary:disabled{opacity:.52;cursor:not-allowed}.merchant-error{margin-top:12px;border:.5px solid oklch(0.76 .08 32);border-radius:8px;background:oklch(0.96 .03 42);color:oklch(0.38 .08 36);padding:10px 12px;font-size:13px;font-weight:750}.merchant-result,.merchant-order-panel,.merchant-readiness-panel{margin-top:26px;display:grid;gap:16px}.merchant-result h2,.merchant-order-panel h2,.merchant-readiness-panel h2{margin:6px 0 0;font-family:var(--display);font-style:italic;font-weight:400;font-size:38px;line-height:.95;color:var(--ink)}.merchant-result p,.merchant-order-panel p,.merchant-readiness-panel p{margin:8px 0 0;color:var(--ink-muted);font-size:14px}.merchant-claim{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}.merchant-claim code{min-height:44px;display:flex;align-items:center;overflow:auto;border:.5px solid var(--rule);border-radius:8px;background:var(--surface-raised);padding:0 12px;color:var(--ink);font-family:var(--mono);font-size:11px}.merchant-claim button{border:none;border-radius:8px;background:var(--verified);color:var(--panel-text);padding:0 14px;font-weight:850;cursor:pointer}.merchant-qr-wrap{display:grid;grid-template-columns:180px minmax(0,1fr);gap:14px;align-items:center;border:.5px solid var(--rule);border-radius:10px;background:var(--surface-raised);padding:12px}.merchant-qr-wrap img,.merchant-qr-placeholder{width:180px;height:180px;border-radius:8px;background:white}.merchant-qr-placeholder{display:grid;place-items:center;border:.5px dashed var(--rule);font-family:var(--mono);font-size:13px;color:var(--ink-muted)}.merchant-qr-wrap code{display:block;margin-top:8px;overflow:auto;border:.5px solid var(--rule);border-radius:8px;background:var(--receipt);padding:10px;font-family:var(--mono);font-size:11px;color:var(--ink)}.merchant-qr-wrap p{margin:9px 0 0;color:var(--ink-muted);font-size:13px;line-height:1.45}.merchant-proof-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:.5px solid var(--rule);border-radius:10px;overflow:hidden}.merchant-proof-grid div{display:grid;gap:5px;padding:12px;border-right:.5px solid var(--rule);background:oklch(0.985 0.005 95 / .76)}.merchant-proof-grid div:last-child{border-right:none}.merchant-proof-grid span{font-family:var(--mono);font-size:9.5px;text-transform:uppercase;letter-spacing:.7px;color:var(--ink-muted)}.merchant-proof-grid strong{min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:13px;color:var(--ink)}.merchant-order-top{display:grid;grid-template-columns:minmax(0,1fr) minmax(340px,.8fr);gap:18px;align-items:end}.merchant-order-controls{display:grid;grid-template-columns:minmax(0,1fr) 150px auto;gap:10px;align-items:end}.merchant-order-controls label{display:grid;gap:6px}.merchant-order-controls button,.merchant-order-actions button{min-height:42px;border:.5px solid var(--rule);border-radius:8px;background:var(--receipt);color:var(--ink);padding:0 12px;font-weight:900;cursor:pointer}.merchant-order-controls button{background:var(--verified);color:var(--panel-text);border:none}.merchant-order-controls button:disabled,.merchant-order-actions button:disabled{opacity:.58;cursor:not-allowed}.merchant-order-list{display:grid;gap:10px}.merchant-empty{display:grid;gap:5px;border:.5px dashed var(--rule);border-radius:10px;background:oklch(0.985 0.005 95 / .62);padding:18px}.merchant-empty strong{font-size:15px;color:var(--ink)}.merchant-empty span{font-size:13px;color:var(--ink-muted)}.merchant-order-row{display:grid;grid-template-columns:minmax(0,1.35fr) 190px minmax(210px,.7fr);gap:12px;align-items:center;border:.5px solid var(--rule);border-radius:10px;background:oklch(0.985 0.005 95 / .76);padding:12px}.merchant-order-main{display:grid;gap:7px}.merchant-order-main>div{display:flex;align-items:center;gap:8px}.merchant-order-main strong{font-size:16px;color:var(--ink)}.merchant-order-main p{margin:0;color:var(--ink-muted);font-size:13px;line-height:1.4}.merchant-order-note{color:var(--ink)!important}.merchant-status{display:inline-flex;align-items:center;min-height:24px;border-radius:999px;padding:0 8px;font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.7px;background:oklch(0.93 0.018 95);color:var(--ink-muted)}.merchant-status.accepted{background:oklch(0.95 0.032 145);color:var(--verified)}.merchant-status.completed{background:oklch(0.93 0.05 150);color:var(--verified)}.merchant-status.cancelled{background:oklch(0.94 0.024 38);color:oklch(0.42 0.09 36)}.merchant-order-meta{display:grid;gap:5px}.merchant-order-meta span{font-size:22px;font-weight:950;color:var(--ink)}.merchant-order-meta code{overflow:hidden;text-overflow:ellipsis;border:.5px solid var(--rule);border-radius:7px;background:var(--receipt);padding:6px 7px;font-family:var(--mono);font-size:10px;color:var(--verified)}.merchant-order-meta small{font-size:11px;color:var(--ink-muted)}.merchant-order-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}.merchant-order-actions button:nth-child(2){background:var(--verified);color:var(--panel-text);border:none}.merchant-queue-mode{justify-self:end;font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.7px;color:var(--ink-muted)}.merchant-order-claim{grid-column:1/-1;display:grid;grid-template-columns:116px minmax(0,1fr);gap:12px;align-items:center;border:.5px solid var(--rule);border-radius:10px;background:oklch(0.96 0.026 145 / .72);padding:10px}.merchant-order-claim img,.merchant-order-qr-placeholder{width:116px;height:116px;border-radius:8px;background:white}.merchant-order-qr-placeholder{display:grid;place-items:center;border:.5px dashed var(--rule);font-family:var(--mono);font-size:12px;color:var(--ink-muted)}.merchant-order-claim span{font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.75px;color:var(--verified)}.merchant-order-claim code{display:block;margin-top:7px;overflow:auto;border:.5px solid var(--rule);border-radius:8px;background:var(--receipt);padding:9px;font-family:var(--mono);font-size:11px;color:var(--ink)}.merchant-order-claim-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:9px}.merchant-order-claim-actions button,.merchant-order-claim-actions a{min-height:36px;display:inline-flex;align-items:center;border:.5px solid var(--rule);border-radius:8px;background:var(--receipt);color:var(--ink);padding:0 11px;font-size:12px;font-weight:900;text-decoration:none;cursor:pointer}.merchant-order-claim-actions a{background:var(--verified);color:var(--panel-text);border:none}@media(max-width:900px){.merchant-header{align-items:flex-start}.merchant-grid,.merchant-order-top,.merchant-order-controls,.merchant-order-row{grid-template-columns:1fr}.merchant-copy{padding-top:0}.merchant-form-grid,.merchant-claim,.merchant-qr-wrap,.merchant-proof-grid{grid-template-columns:1fr}.merchant-order-actions{justify-content:flex-start}.merchant-proof-grid div{border-right:none;border-bottom:.5px solid var(--rule)}.merchant-proof-grid div:last-child{border-bottom:none}}
`;

const merchantEnhancementStyles = `
.merchant-pilot-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));border:.5px solid var(--rule);border-radius:10px;overflow:hidden;background:oklch(0.985 0.005 95 / .68)}
.merchant-pilot-grid div{display:grid;gap:5px;padding:12px;border-right:.5px solid var(--rule)}
.merchant-pilot-grid div:last-child{border-right:none}
.merchant-pilot-grid span,.merchant-credit-memo-grid span{font-family:var(--mono);font-size:9.5px;text-transform:uppercase;letter-spacing:.7px;color:var(--ink-muted)}
.merchant-pilot-grid strong{font-size:23px;line-height:1;color:var(--ink)}
.merchant-credit-memo{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,.85fr);gap:14px;align-items:center;border:.5px solid var(--rule);border-radius:10px;background:oklch(0.96 0.026 145 / .58);padding:14px}
.merchant-credit-memo h3{margin:5px 0 0;font-family:var(--mono);font-size:14px;letter-spacing:.3px;color:var(--verified)}
.merchant-credit-memo p{margin:7px 0 0!important}
.merchant-credit-memo-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.merchant-credit-memo-grid div{display:grid;gap:5px;border:.5px solid var(--rule);border-radius:8px;background:var(--receipt);padding:10px}
.merchant-credit-memo-grid strong{font-size:13px;line-height:1.35;color:var(--ink)}
.merchant-order-main>div{flex-wrap:wrap}
.merchant-pickup-code{display:inline-flex;align-items:center;min-height:24px;border-radius:999px;padding:0 8px;font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.5px;background:var(--verified);color:var(--panel-text)}
.merchant-order-claim small{display:block;margin-top:8px;font-size:11px;color:var(--verified)}
.merchant-readiness-top{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;align-items:start}
.merchant-readiness-top button{min-height:40px;border:none;border-radius:8px;background:var(--verified);color:var(--panel-text);padding:0 13px;font-weight:900;cursor:pointer}
.merchant-readiness-top button:disabled{opacity:.58;cursor:not-allowed}
.merchant-readiness-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;border:.5px solid var(--rule);border-radius:10px;background:oklch(0.985 0.005 95 / .68);padding:12px}
.merchant-readiness-summary span{font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.75px;color:var(--ink-muted)}
.merchant-readiness-summary strong{font-size:22px;color:var(--ink)}
.merchant-readiness-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.merchant-readiness-card{display:grid;gap:10px;border:.5px solid var(--rule);border-radius:10px;background:oklch(0.985 0.005 95 / .72);padding:12px}
.merchant-readiness-card[data-status=ready]{border-color:color-mix(in oklch,var(--verified) 32%,var(--rule));background:oklch(0.96 0.026 145 / .58)}
.merchant-readiness-card[data-status=blocked]{border-color:oklch(0.76 .08 32);background:oklch(0.96 .03 42 / .72)}
.merchant-readiness-card span{font-family:var(--mono);font-size:9.5px;text-transform:uppercase;letter-spacing:.7px;color:var(--ink-muted)}
.merchant-readiness-card strong{display:block;margin-top:4px;font-size:15px;color:var(--ink)}
.merchant-readiness-card p{margin:0!important;font-size:13px!important;line-height:1.45}
.merchant-readiness-card code{overflow:auto;border:.5px solid var(--rule);border-radius:7px;background:var(--receipt);padding:7px;font-family:var(--mono);font-size:10px;color:var(--verified)}
.merchant-readiness-card ul{margin:0;padding-left:17px;color:var(--ink-muted);font-family:var(--mono);font-size:10px;line-height:1.55}
.merchant-setup-panel{margin-top:26px;display:grid;gap:16px;border:.5px solid var(--rule);border-radius:12px;background:oklch(0.992 0.004 100 / .86);box-shadow:0 22px 80px rgba(24,58,38,.10);padding:18px}
.merchant-setup-panel h2{margin:6px 0 0;font-family:var(--display);font-style:italic;font-weight:400;font-size:38px;line-height:.95;color:var(--ink)}
.merchant-setup-panel p{margin:8px 0 0;color:var(--ink-muted);font-size:14px;line-height:1.45}
.merchant-setup-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.merchant-setup-grid div{display:grid;gap:7px;border:.5px solid var(--rule);border-radius:10px;background:oklch(0.985 0.005 95 / .72);padding:12px;min-width:0}
.merchant-setup-grid span,.merchant-setup-flow span{font-family:var(--mono);font-size:9.5px;text-transform:uppercase;letter-spacing:.7px;color:var(--ink-muted)}
.merchant-setup-grid code{overflow:auto;border:.5px solid var(--rule);border-radius:7px;background:var(--receipt);padding:8px;font-family:var(--mono);font-size:10px;color:var(--verified)}
.merchant-setup-flow{display:flex;flex-wrap:wrap;gap:8px}
.merchant-setup-flow span{border:.5px solid var(--rule);border-radius:999px;background:var(--receipt);padding:8px 10px;color:var(--verified)}
@media(max-width:900px){.merchant-pilot-grid,.merchant-credit-memo,.merchant-credit-memo-grid,.merchant-readiness-top,.merchant-readiness-grid,.merchant-setup-grid{grid-template-columns:1fr}.merchant-pilot-grid div{border-right:none;border-bottom:.5px solid var(--rule)}.merchant-pilot-grid div:last-child{border-bottom:none}}
`;

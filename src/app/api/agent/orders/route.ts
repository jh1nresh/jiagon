import { createHash } from "node:crypto";
import { Pool } from "pg";
import {
  createMerchantOrder,
  publicMerchantOrder,
  recordMerchantPilotEvent,
  type MerchantOrderItem,
} from "@/server/merchantOrderStore";
import { knownMerchantProfileForId, type MenuItem, type MerchantProfile } from "@/lib/merchantCatalog";
import { nfcStationUrl, notifyMerchantGroup } from "@/server/telegramMerchantNotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AgentOrderRouteGlobal = typeof globalThis & {
  jiagonAgentOrderRateLimitPool?: Pool;
  jiagonAgentOrderRateLimitSchemaReady?: Promise<void>;
};

const AGENT_ORDER_RATE_LIMIT_WINDOW_MS = 60_000;
const AGENT_ORDER_RATE_LIMIT_DEFAULT_MAX = 20;
const DEFAULT_PICKUP_MINUTES = 8;
let warnedMissingProductionOrigin = false;

function databaseUrl() {
  return (process.env.DATABASE_URL || "").trim();
}

function getRateLimitPool() {
  const url = databaseUrl();
  if (!url) return null;

  const globalStore = globalThis as AgentOrderRouteGlobal;
  if (!globalStore.jiagonAgentOrderRateLimitPool) {
    const wantsSsl =
      process.env.DATABASE_SSL === "true" ||
      url.includes("sslmode=require");
    const allowInsecureSsl =
      process.env.DATABASE_SSL_INSECURE === "true" ||
      process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "false" ||
      url.includes("sslmode=no-verify");
    const enableSsl = wantsSsl || allowInsecureSsl;
    globalStore.jiagonAgentOrderRateLimitPool = new Pool({
      connectionString: url,
      max: 2,
      ssl: enableSsl ? { rejectUnauthorized: !allowInsecureSsl } : undefined,
    });
  }

  return globalStore.jiagonAgentOrderRateLimitPool;
}

async function ensureRateLimitSchema(pool: Pool) {
  const globalStore = globalThis as AgentOrderRouteGlobal;
  if (!globalStore.jiagonAgentOrderRateLimitSchemaReady) {
    globalStore.jiagonAgentOrderRateLimitSchemaReady = pool.query(`
        create table if not exists jiagon_agent_order_rate_limits (
          rate_key text primary key,
          count integer not null default 0,
          reset_at timestamptz not null,
          updated_at timestamptz not null default now()
        );

        create index if not exists jiagon_agent_order_rate_limits_reset_idx
          on jiagon_agent_order_rate_limits (reset_at);
      `)
      .then(() => undefined)
      .catch((error) => {
        globalStore.jiagonAgentOrderRateLimitSchemaReady = undefined;
        throw error;
      });
  }

  return globalStore.jiagonAgentOrderRateLimitSchemaReady;
}

function cleanConfiguredOrigin(value: string) {
  const configured = value.trim();
  if (!configured) return "";

  try {
    const url = new URL(configured);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : "";
  } catch {
    return "";
  }
}

function requestOrigin(request: Request) {
  const configuredOrigin = cleanConfiguredOrigin(
    process.env.JIAGON_APP_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || "",
  );
  if (configuredOrigin) return configuredOrigin;

  const vercelHost = (process.env.VERCEL_URL || "").trim();
  if (vercelHost) return cleanConfiguredOrigin(`https://${vercelHost}`);

  if (process.env.NODE_ENV !== "production") return new URL(request.url).origin;

  if (!warnedMissingProductionOrigin) {
    warnedMissingProductionOrigin = true;
    console.warn(
      "Jiagon agent order route cannot build public URLs because JIAGON_APP_ORIGIN, NEXT_PUBLIC_APP_URL, and VERCEL_URL are unset.",
    );
  }

  return new URL(request.url).origin;
}

function cleanText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 180) : fallback;
}

function cleanLongText(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 500) : "";
}

function centsFromUsd(value: string) {
  const normalized = value.trim().replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return 0;
  return Math.round(Number(normalized) * 100);
}

function parseMaxSpendCents(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const normalized =
    typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : typeof value === "string"
        ? value.trim().replace(/[$,\s]/g, "")
        : "";
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

function quantityFrom(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 1;
}

function quantityFromIntent(intent: string) {
  const lower = ` ${intent.toLowerCase()} `;
  const unitMatch = /\b([1-9]|1\d|20)\s*(x|pcs?|pieces?|cups?|杯|份)\b|\b(x|qty|quantity)\s*([1-9]|1\d|20)\b/.exec(lower);
  if (unitMatch) return quantityFrom(unitMatch[1] || unitMatch[4]);
  const leadingDigitMatch = /^\s*([1-9]|1\d|20)\b/.exec(lower);
  if (leadingDigitMatch) return quantityFrom(leadingDigitMatch[1]);
  if (/\b(two|couple)\b/.test(lower)) return 2;
  if (/\b(three)\b/.test(lower)) return 3;
  return 1;
}

function menuItemFromStructuredItem(merchant: MerchantProfile, item: Record<string, unknown>) {
  const itemId = cleanText(item.menuItemId ?? item.itemId ?? item.id).toLowerCase();
  const name = cleanText(item.name).toLowerCase();
  if (!itemId && !name) return null;
  return merchant.menu.find((menuItem) => {
    const menuName = menuItem.name.toLowerCase();
    return (itemId && menuItem.id === itemId) ||
      (name && (menuName === name || menuName.includes(name) || name.includes(menuName)));
  }) || null;
}

function menuItemFromIntent(merchant: MerchantProfile, intent: string) {
  const lower = intent.toLowerCase();
  const normalized = ` ${lower.replace(/[_-]/g, " ").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim()} `;
  const directMatch = merchant.menu.find((item) => {
    const name = item.name.toLowerCase();
    const normalizedId = item.id.replace(/-/g, " ");
    const significantTerms = name.split(/\s+/).filter((term) => term.length > 4);
    return lower.includes(name) ||
      lower.includes(normalizedId) ||
      significantTerms.some((term) => lower.includes(term));
  });
  if (directMatch) return directMatch;

  if (merchant.id === "raposa-coffee") {
    const wantsLatte = normalized.includes(" latte ") || normalized.includes(" 拿鐵 ") || normalized.includes(" 牛奶 ");
    const wantsEspresso = normalized.includes(" espresso ") || normalized.includes("濃縮");
    const wantsPastry = normalized.includes(" croissant ") || normalized.includes(" pastry ") || normalized.includes(" 可頌 ");
    const wantsCoffee = normalized.includes(" coffee ") || normalized.includes(" cafe ") || normalized.includes(" 咖啡 ");
    if (wantsLatte) return merchant.menu.find((item) => item.id === "iced-latte") || null;
    if (wantsEspresso) return merchant.menu.find((item) => item.id === "espresso") || null;
    if (wantsPastry) return merchant.menu.find((item) => item.id === "croissant") || null;
    if (wantsCoffee) return merchant.menu.find((item) => item.id === "iced-latte") || merchant.menu[0] || null;
  }

  return null;
}

function itemForMenuItem(menuItem: MenuItem, quantity: number): MerchantOrderItem | null {
  const safeQuantity = Math.max(1, Math.min(20, quantity));
  const unitAmountCents = centsFromUsd(menuItem.amountUsd);
  if (unitAmountCents <= 0) return null;
  return {
    id: menuItem.id,
    name: menuItem.name,
    quantity: safeQuantity,
    unitAmountCents,
  };
}

function agentOrderItems(body: Record<string, unknown>, merchant: MerchantProfile): MerchantOrderItem[] {
  const structuredItems = Array.isArray(body.items) ? body.items : [];
  const parsedStructured = structuredItems
    .map((rawItem) => {
      const item = rawItem && typeof rawItem === "object" ? rawItem as Record<string, unknown> : {};
      const menuItem = menuItemFromStructuredItem(merchant, item);
      if (!menuItem) return null;
      return itemForMenuItem(menuItem, quantityFrom(item.quantity));
    })
    .filter((item): item is MerchantOrderItem => Boolean(item))
    .slice(0, 5);
  if (parsedStructured.length > 0) return parsedStructured;

  const intent = cleanLongText(body.userIntent ?? body.intent ?? body.message ?? body.instruction);
  const menuItem = menuItemFromIntent(merchant, intent);
  const item = menuItem ? itemForMenuItem(menuItem, quantityFromIntent(intent)) : null;
  return item ? [item] : [];
}

function rateLimitKey(request: Request, agentId: string) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwardedFor || request.headers.get("x-real-ip")?.trim() || "local";
  return `${agentId || "anonymous"}:${ip}`;
}

function rateLimitMax() {
  const configured = Number.parseInt(process.env.JIAGON_AGENT_ORDER_RATE_LIMIT || "", 10);
  return Number.isFinite(configured) && configured >= 0 ? configured : AGENT_ORDER_RATE_LIMIT_DEFAULT_MAX;
}

async function checkRateLimit(request: Request, agentId: string) {
  const max = rateLimitMax();
  if (max === 0) return { ok: true as const };

  const now = Date.now();
  const key = rateLimitKey(request, agentId);
  const resetAt = now + AGENT_ORDER_RATE_LIMIT_WINDOW_MS;
  const pool = getRateLimitPool();
  if (!pool) return { ok: true as const };

  try {
    await ensureRateLimitSchema(pool);
    const result = await pool.query(
      `
        insert into jiagon_agent_order_rate_limits (rate_key, count, reset_at, updated_at)
        values ($1, 1, to_timestamp($2 / 1000.0), now())
        on conflict (rate_key) do update
        set
          count = case
            when jiagon_agent_order_rate_limits.reset_at <= now() then 1
            else jiagon_agent_order_rate_limits.count + 1
          end,
          reset_at = case
            when jiagon_agent_order_rate_limits.reset_at <= now() then excluded.reset_at
            else jiagon_agent_order_rate_limits.reset_at
          end,
          updated_at = now()
        returning count, extract(epoch from reset_at) * 1000 as reset_at_ms
      `,
      [key, resetAt],
    );
    const row = result.rows[0] || {};
    const count = Number(row.count) || 0;
    const resetAtMs = Number(row.reset_at_ms) || resetAt;
    if (count <= max) return { ok: true as const };
    return {
      ok: false as const,
      retryAfter: Math.max(1, Math.ceil((resetAtMs - now) / 1000)),
    };
  } catch (error) {
    console.warn("Jiagon agent order rate limit check failed open.", { error });
    return { ok: true as const };
  }
}

function idempotencyKey(body: Record<string, unknown>, merchantId: string, agentId: string) {
  const requestId = cleanText(body.requestId ?? body.idempotencyKey);
  if (!requestId) return null;
  const digest = createHash("sha256").update(`${merchantId}:${agentId}:${requestId}`).digest("hex").slice(0, 32);
  return `agent:${merchantId}:${digest}`;
}

function menuForClarification(merchant: MerchantProfile) {
  return merchant.menu.map((item) => ({
    id: item.id,
    name: item.name,
    amountUsd: item.amountUsd,
  }));
}

function pickupEstimate(body: Record<string, unknown>) {
  const requested = Number.parseInt(String(body.pickupEtaMinutes ?? body.pickupMinutes ?? ""), 10);
  const minutes = Number.isFinite(requested) && requested > 0 && requested <= 60 ? requested : DEFAULT_PICKUP_MINUTES;
  const readyAt = new Date(Date.now() + minutes * 60_000).toISOString();
  return {
    minutes,
    readyAt,
    label: `about ${minutes} minutes`,
  };
}

type AgentPaymentMode = "pay_at_counter" | "crypto_pay";

function requestedPaymentMode(body: Record<string, unknown>): AgentPaymentMode {
  const payment = body.payment && typeof body.payment === "object" ? body.payment as Record<string, unknown> : {};
  const value = cleanText(body.paymentMode ?? payment.mode).toLowerCase().replace(/[-\s]/g, "_");
  if (
    value === "crypto_pay" ||
    value === "cryptopay" ||
    value === "solana_pay" ||
    value === "solanapay" ||
    value === "helio_pay" ||
    value === "heliopay" ||
    value === "helio"
  ) {
    return "crypto_pay";
  }
  return "pay_at_counter";
}

function solanaPayRecipient() {
  return (process.env.JIAGON_SOLANA_PAY_RECIPIENT || process.env.NEXT_PUBLIC_JIAGON_SOLANA_PAY_RECIPIENT || "").trim();
}

function solanaPaySplToken() {
  return (process.env.JIAGON_SOLANA_PAY_SPL_TOKEN || process.env.NEXT_PUBLIC_JIAGON_SOLANA_PAY_SPL_TOKEN || "").trim();
}

function solanaPayIntent(input: {
  merchant: MerchantProfile;
  orderId: string;
  pickupCode: string;
  amountUsd: string;
}) {
  const recipient = solanaPayRecipient();
  if (!recipient) {
    return null;
  }

  const params = new URLSearchParams({
    amount: input.amountUsd,
    label: input.merchant.name,
    message: `Jiagon Order Pass ${input.pickupCode}`,
    memo: `jiagon:${input.orderId}`,
  });
  const splToken = solanaPaySplToken();
  if (splToken) params.set("spl-token", splToken);

  return {
    mode: "crypto_pay",
    status: "payment_request_created",
    provider: "solana_pay",
    rail: "solana",
    recipient,
    amountUsd: input.amountUsd,
    network: "solana-devnet",
    currency: splToken ? "devnet SPL token" : "devnet SOL",
    splToken: splToken || null,
    url: `solana:${recipient}?${params.toString()}`,
    memo: `jiagon:${input.orderId}`,
    note: "This is a devnet payment request for the demo. Receipt issuance still requires merchant fulfillment confirmation unless a Solana Pay verification webhook is added.",
  };
}

function helioPaylinkId() {
  return (process.env.HELIO_PAYLINK_ID || process.env.NEXT_PUBLIC_HELIO_PAYLINK_ID || "").trim();
}

function helioNetwork() {
  const configured = (process.env.HELIO_NETWORK || process.env.NEXT_PUBLIC_HELIO_NETWORK || "test").trim().toLowerCase();
  return configured === "main" ? "main" : "test";
}

function helioMainnetBlocked() {
  return helioNetwork() === "main";
}

function helioBlockedIntent() {
  return {
    mode: "crypto_pay",
    status: "blocked",
    provider: "helio_solana_checkout",
    rail: "solana",
    network: "blocked-main",
    note: "Jiagon demo is testnet-only. Set HELIO_NETWORK=test and use a paylink from app.dev.hel.io.",
  };
}

function helioPayIntent(input: {
  merchant: MerchantProfile;
  orderId: string;
  pickupCode: string;
  amountUsd: string;
}) {
  const paylinkId = helioPaylinkId();
  if (!paylinkId) {
    return null;
  }

  if (helioMainnetBlocked()) {
    return null;
  }

  const additionalJSON = {
    jiagonOrderId: input.orderId,
    pickupCode: input.pickupCode,
    merchantId: input.merchant.id,
    merchantName: input.merchant.name,
    proofPolicy: "receipt_claim_requires_merchant_paid_done_until_helio_webhook",
  };

  return {
    mode: "crypto_pay",
    status: "checkout_config_created",
    provider: "helio_solana_checkout",
    rail: "solana",
    paylinkId,
    amountUsd: input.amountUsd,
    network: helioNetwork(),
    checkout: {
      paylinkId,
      amount: input.amountUsd,
      network: helioNetwork(),
      display: "new-tab",
      primaryPaymentMethod: "crypto",
      showPayWithCard: false,
      additionalJSON,
    },
    note: "This returns a Helio Solana test checkout config for the demo. Receipt issuance still requires merchant Paid + Done until a Helio webhook or transaction query is added.",
  };
}

function counterPaymentIntent() {
  return {
    mode: "pay_at_counter",
    status: "external_payment_required",
    provider: "counter_pos",
    note: "Payment is collected by the merchant; Jiagon receipt issuance still requires staff Paid + Done.",
  };
}

function paymentIntent(input: {
  requestedMode: AgentPaymentMode;
  merchant: MerchantProfile;
  orderId: string;
  pickupCode: string;
  amountUsd: string;
}) {
  if (input.requestedMode === "pay_at_counter") return counterPaymentIntent();

  const helioBlocked = Boolean(helioPaylinkId()) && helioMainnetBlocked();
  const helio = helioPayIntent(input);
  if (helio) return helio;
  const solanaPay = solanaPayIntent(input);
  if (solanaPay) return solanaPay;
  if (helioBlocked) return helioBlockedIntent();
  return {
    mode: "crypto_pay",
    status: "setup_required",
    provider: "solana_payment",
    rail: "solana",
    missing: ["HELIO_PAYLINK_ID or JIAGON_SOLANA_PAY_RECIPIENT"],
    network: "test",
    note: "Crypto Pay needs either a Helio dev paylink or a Solana Pay devnet recipient. Staff can still collect payment at the counter.",
  };
}

function agentExecutionPlan(input: {
  merchant: MerchantProfile;
  order: ReturnType<typeof publicMerchantOrder>;
  pickup: ReturnType<typeof pickupEstimate>;
  payment: ReturnType<typeof paymentIntent>;
}) {
  const paymentApproval = input.payment.mode === "crypto_pay" && (
    input.payment.status === "checkout_config_created" ||
    input.payment.status === "payment_request_created"
  )
    ? "User approves the Solana payment intent; agent continues tracking pickup."
    : "Payment is external in this pilot; agent still tracks the order pass and receipt state.";

  return {
    userSaid: "I want coffee.",
    agentHandled: [
      `Selected ${input.merchant.name} and matched the menu item.`,
      "Created the order pass through Jiagon Agentic POS.",
      "Prepared payment route and user approval step.",
      "Sent the order into the merchant terminal.",
      "Prepared NFC receipt claim and credit unlock path.",
    ],
    userVisibleResult: [
      `Pickup at ${input.merchant.name}.`,
      `Order Pass ${input.order.pickupCode}.`,
      `Ready in ${input.pickup.label}.`,
    ],
    paymentApproval,
    merchantTerminal: "Telegram is the lightweight merchant terminal; the product surface is the agent-callable POS API.",
    receiptAutomation: "After merchant Paid + Done, Jiagon turns the fulfilled order into a claimable receipt passport record.",
    futureCreditUse: "The collected receipt history can later unlock purpose-bound fine-dining deposit credit.",
  };
}

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return Response.json({ error: "Agent order intake requires a JSON request." }, { status: 415 });
  }

  let body: Record<string, unknown>;
  try {
    const rawBody = await request.text();
    if (rawBody.length > 25_000) {
      return Response.json({ error: "Agent order payload is too large." }, { status: 413 });
    }
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return Response.json({ error: "JSON body must be an object." }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const agentId = cleanText(body.agentId, "personal-agent");
  const rateLimit = await checkRateLimit(request, agentId);
  if (!rateLimit.ok) {
    return Response.json(
      {
        error: "Too many agent order requests. Please retry shortly.",
        retryAfterSeconds: rateLimit.retryAfter,
      },
      { status: 429, headers: { "retry-after": String(rateLimit.retryAfter) } },
    );
  }

  const merchantId = cleanText(body.merchantId, "raposa-coffee").toLowerCase();
  const merchant = knownMerchantProfileForId(merchantId);
  if (!merchant) {
    return Response.json(
      {
        error: "Unknown merchant for agent ordering.",
        supportedMerchants: ["raposa-coffee"],
      },
      { status: 400 },
    );
  }

  const items = agentOrderItems(body, merchant);
  if (items.length < 1) {
    return Response.json(
      {
        product: "Jiagon personal agent ordering",
        status: "needs_clarification",
        error: "The agent request did not match an available menu item.",
        merchant: {
          id: merchant.id,
          name: merchant.name,
          location: merchant.location,
        },
        menu: menuForClarification(merchant),
        example: {
          userIntent: "Order one iced latte at Raposa Coffee",
          merchantId: merchant.id,
        },
      },
      { status: 422 },
    );
  }

  const subtotalCents = items.reduce((total, item) => total + item.unitAmountCents * item.quantity, 0);
  const maxSpendCents = parseMaxSpendCents(body.maxSpendUsd ?? body.maxSpend);
  if (maxSpendCents !== null && subtotalCents > maxSpendCents) {
    return Response.json(
      {
        error: "Order exceeds the user's agent spending policy.",
        subtotalUsd: (subtotalCents / 100).toFixed(2),
        maxSpendUsd: (maxSpendCents / 100).toFixed(2),
      },
      { status: 409 },
    );
  }
  if (subtotalCents <= 0 || subtotalCents > 10_000) {
    return Response.json({ error: "Agent orders are capped at $100 for the demo." }, { status: 400 });
  }

  const userIntent = cleanLongText(body.userIntent ?? body.intent ?? body.message ?? body.instruction);
  const pickup = pickupEstimate(body);
  const paymentMode = requestedPaymentMode(body);
  const notes = [
    userIntent ? `User intent: ${userIntent}` : "",
    `Pickup estimate: ${pickup.label}`,
    paymentMode === "crypto_pay" ? "Payment requested: Crypto Pay on Solana." : "",
    cleanLongText(body.notes),
  ].filter(Boolean).join(" ");
  const result = await createMerchantOrder({
    idempotencyKey: idempotencyKey(body, merchant.id, agentId),
    merchantId: merchant.id,
    merchantName: merchant.name,
    location: merchant.location,
    customerLabel: cleanText(body.customerLabel ?? body.userLabel, `${agentId} user`),
    source: "agent",
    items,
    notes,
  });

  if (result.configured && !result.persisted) {
    return Response.json(
      {
        error: result.error || "Failed to persist agent order.",
        configured: result.configured,
        persisted: result.persisted,
      },
      { status: 503 },
    );
  }

  try {
    await recordMerchantPilotEvent({
      merchantId: merchant.id,
      eventName: "order_started",
      source: "agent-order",
    });
  } catch (error) {
    console.warn("Jiagon agent order_started pilot event failed.", {
      merchantId: merchant.id,
      error,
    });
  }

  const origin = requestOrigin(request);
  const order = publicMerchantOrder(result.order);
  const merchantNotify = await notifyMerchantGroup(result.order);
  const stationUrl = nfcStationUrl(origin, merchant.id);
  const pairUrl = `${origin}/tile/${encodeURIComponent(merchant.id)}?pass=${encodeURIComponent(order.pickupCode)}&source=agent`;
  const payment = paymentIntent({
    requestedMode: paymentMode,
    merchant,
    orderId: order.id,
    pickupCode: order.pickupCode,
    amountUsd: order.subtotalUsd,
  });
  const agentExecution = agentExecutionPlan({ merchant, order, pickup, payment });

  return Response.json(
    {
      product: "Jiagon personal agent ordering",
      status: "order_pass_created",
      proofLevel: "order_intent_only",
      mode: result.configured ? "database" : "local-demo-memory",
      configured: result.configured,
      persisted: result.persisted,
      agent: {
        id: agentId,
        role: "personal_ordering_agent",
        policy: {
          merchantId: merchant.id,
          maxSpendUsd: maxSpendCents === null ? null : (maxSpendCents / 100).toFixed(2),
          paymentMode,
          receiptPolicy: "receipt_claim_requires_merchant_paid_done",
        },
      },
      merchant: {
        id: merchant.id,
        name: merchant.name,
        location: merchant.location,
      },
      order,
      pickup,
      payment,
      agentExecution,
      paymentProof: {
        rail: payment.mode === "crypto_pay" ? "solana" : "external_pos",
        currentLevel: payment.mode === "crypto_pay" && (
          payment.status === "checkout_config_created" || payment.status === "payment_request_created"
        )
          ? "payment_intent_created"
          : "merchant_attestation_required",
        verifiedPayment: false,
        nextUpgrade: payment.provider === "helio_solana_checkout"
          ? "Add Helio webhook verification for L4 payment-backed receipts."
          : payment.provider === "solana_pay"
            ? "Add Solana transaction confirmation query for L4 payment-backed receipts."
            : "Use merchant Paid + Done for L2 receipt proof in the pilot.",
      },
      staffDispatch: merchantNotify.sent ? "sent" : merchantNotify.skipped ? "skipped" : "failed",
      creditPath: [
        "L0 agent order intent created",
        payment.mode === "crypto_pay" && (
          payment.status === "checkout_config_created" || payment.status === "payment_request_created"
        )
          ? "L1 Solana payment intent returned"
          : payment.mode === "crypto_pay"
            ? "L1 Solana payment route needs demo env setup"
            : "L1 counter payment pending",
        "L2 merchant taps Paid + Done",
        "L3 customer claims receipt by NFC / Privy",
        "Credit page unlocks purpose-bound restaurant deposit credit",
      ],
      customerInstructions: [
        `Pickup at ${merchant.name} with Order Pass ${order.pickupCode}.`,
        payment.mode === "crypto_pay" && payment.status === "payment_request_created"
          ? "Approve the Solana Pay request; Jiagon keeps the order pass tied to pickup and receipt claim."
          : payment.mode === "crypto_pay" && payment.status === "checkout_config_created"
            ? "Approve the Helio Solana test checkout; Jiagon keeps the order pass tied to pickup and receipt claim."
          : "Counter payment is the pilot fallback; the agent still tracks pickup and receipt claim.",
        `Pickup target: ${pickup.label}.`,
        "After staff taps Paid + Done, tap the NFC receipt station to claim the onchain receipt into Jiagon Passport.",
      ],
      urls: {
        nfcStation: stationUrl,
        pairPhoneForNfcClaim: pairUrl,
      },
      next: "Merchant confirmation upgrades the order to merchant_completed; customer NFC claim upgrades it to customer_claimed and unlocks the receipt passport flow.",
    },
    { status: 201 },
  );
}

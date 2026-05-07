import {
  createMerchantOrder,
  listMerchantOrders,
  publicMerchantOrder,
  type MerchantOrderItem,
  type MerchantOrderStatus,
} from "@/server/merchantOrderStore";
import { authorizeMerchantDashboard } from "@/server/merchantAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OrderIntakeRateLimitEntry = {
  count: number;
  resetAt: number;
};

type OrderIntakeRouteGlobal = typeof globalThis & {
  jiagonOrderIntakeRateLimit?: Map<string, OrderIntakeRateLimitEntry>;
};

const ORDER_INTAKE_RATE_LIMIT_WINDOW_MS = 60_000;
const ORDER_INTAKE_RATE_LIMIT_DEFAULT_MAX = 30;

function cleanText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 160) : fallback;
}

function cleanLongText(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 500) : "";
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return slug || "merchant";
}

function parseCents(value: unknown) {
  const normalized =
    typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : typeof value === "string"
        ? value.trim().replace(/[$,\s]/g, "")
        : "";
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

function cleanItems(value: unknown): MerchantOrderItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const name = cleanText(record.name);
      const quantity = typeof record.quantity === "number" ? Math.floor(record.quantity) : Number.parseInt(String(record.quantity || "1"), 10);
      const unitAmountCents = parseCents(record.unitAmountUsd ?? record.unitAmount ?? record.priceUsd ?? record.price);
      if (!name || !Number.isInteger(quantity) || quantity < 1 || quantity > 20 || !unitAmountCents || unitAmountCents <= 0) {
        return null;
      }
      return {
        id: cleanText(record.id, `item-${index + 1}`),
        name,
        quantity,
        unitAmountCents,
      };
    })
    .filter((item): item is MerchantOrderItem => Boolean(item))
    .slice(0, 20);
}

function orderStatus(value: string | null): MerchantOrderStatus | null {
  return value === "pending" || value === "accepted" || value === "completed" || value === "cancelled" ? value : null;
}

function orderIntakeRateLimitKey(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || request.headers.get("x-real-ip")?.trim() || "local";
}

function orderIntakeRateLimitMax() {
  const configured = Number.parseInt(process.env.JIAGON_ORDER_INTAKE_RATE_LIMIT || "", 10);
  return Number.isFinite(configured) && configured >= 0 ? configured : ORDER_INTAKE_RATE_LIMIT_DEFAULT_MAX;
}

function checkOrderIntakeRateLimit(request: Request) {
  const max = orderIntakeRateLimitMax();
  if (max === 0) return { ok: true as const };

  const now = Date.now();
  const key = orderIntakeRateLimitKey(request);
  const globalStore = globalThis as OrderIntakeRouteGlobal;
  const store = globalStore.jiagonOrderIntakeRateLimit || new Map<string, OrderIntakeRateLimitEntry>();
  globalStore.jiagonOrderIntakeRateLimit = store;

  const existing = store.get(key);
  const entry = existing && existing.resetAt > now
    ? existing
    : { count: 0, resetAt: now + ORDER_INTAKE_RATE_LIMIT_WINDOW_MS };
  entry.count += 1;
  store.set(key, entry);

  if (entry.count <= max) return { ok: true as const };
  return {
    ok: false as const,
    retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
  };
}

export async function GET(request: Request) {
  const authError = authorizeMerchantDashboard(request);
  if (authError) {
    return Response.json({ error: authError }, { status: authError.startsWith("Invalid") ? 401 : 503 });
  }

  const url = new URL(request.url);
  const result = await listMerchantOrders({
    merchantId: cleanText(url.searchParams.get("merchantId")) || null,
    status: orderStatus(url.searchParams.get("status")),
    limit: Number.parseInt(url.searchParams.get("limit") || "25", 10),
  });

  if (result.error) {
    return Response.json({ error: result.error, configured: result.configured }, { status: 503 });
  }

  return Response.json({
    product: "Jiagon agentic merchant orders",
    mode: result.configured ? "database" : "local-demo-memory",
    configured: result.configured,
    orders: result.orders.map(publicMerchantOrder),
  });
}

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return Response.json({ error: "Agentic merchant order requires a JSON request." }, { status: 415 });
  }

  const rateLimit = checkOrderIntakeRateLimit(request);
  if (!rateLimit.ok) {
    return Response.json(
      {
        error: "Too many merchant order requests. Please retry shortly.",
        retryAfterSeconds: rateLimit.retryAfter,
      },
      {
        status: 429,
        headers: {
          "retry-after": String(rateLimit.retryAfter),
        },
      },
    );
  }

  let body: Record<string, unknown>;
  try {
    const rawBody = await request.text();
    if (rawBody.length > 50_000) {
      return Response.json({ error: "Merchant order payload is too large." }, { status: 413 });
    }
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return Response.json({ error: "JSON body must be an object." }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const merchantName = cleanText(body.merchantName);
  const merchantId = slugify(cleanText(body.merchantId, merchantName));
  const items = cleanItems(body.items);
  const subtotalCents = items.reduce((total, item) => total + item.unitAmountCents * item.quantity, 0);

  if (merchantName.length < 2) {
    return Response.json({ error: "Merchant name is required." }, { status: 400 });
  }
  if (items.length < 1) {
    return Response.json({ error: "At least one valid order item is required." }, { status: 400 });
  }
  if (subtotalCents <= 0 || subtotalCents > 100_000) {
    return Response.json({ error: "Order total must be greater than $0 and at most $1,000 for the MVP." }, { status: 400 });
  }

  const source = body.source === "telegram" || body.source === "web" || body.source === "agent" ? body.source : "tile";
  const result = await createMerchantOrder({
    merchantId,
    merchantName,
    location: cleanText(body.location),
    customerLabel: cleanText(body.customerLabel),
    source,
    items,
    notes: cleanLongText(body.notes),
  });

  if (result.configured && !result.persisted) {
    return Response.json(
      {
        error: result.error || "Failed to persist merchant order.",
        configured: result.configured,
        persisted: result.persisted,
      },
      { status: 503 },
    );
  }

  return Response.json(
    {
      product: "Jiagon agentic merchant order",
      mode: result.configured ? "database" : "local-demo-memory",
      configured: result.configured,
      persisted: result.persisted,
      order: publicMerchantOrder(result.order),
      next: "Merchant dashboard queue will accept or complete this order in the next Agentic POS step.",
    },
    { status: 201 },
  );
}

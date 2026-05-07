import { createHash, randomBytes } from "node:crypto";
import { Pool } from "pg";
import { createMerchantIssuedReceipt, publicMerchantReceipt } from "@/server/receiptStore";

export type MerchantOrderItem = {
  id: string;
  name: string;
  quantity: number;
  unitAmountCents: number;
};

export type MerchantOrderStatus = "pending" | "accepted" | "completed" | "cancelled";
export type MerchantOrderProofLevel = "order_intent_only" | "merchant_accepted" | "merchant_completed" | "customer_claimed" | "cancelled";
export type MerchantOrderPaymentStatus = "waiting_counter_payment" | "merchant_attested_paid" | "cancelled";

export type MerchantOrder = {
  id: string;
  idempotencyKey: string | null;
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
  proofLevel: MerchantOrderProofLevel;
  receiptId: string | null;
  receiptClaimUrl: string | null;
  receiptHash: string | null;
  receiptIssuedAt: string | null;
  receiptClaimedAt: string | null;
  receiptClaimedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MerchantOrderCreateInput = {
  idempotencyKey?: string | null;
  merchantId: string;
  merchantName: string;
  location?: string | null;
  customerLabel?: string | null;
  source?: "tile" | "telegram" | "web" | "agent" | null;
  items: MerchantOrderItem[];
  notes?: string | null;
};

type MerchantOrderGlobal = typeof globalThis & {
  jiagonMerchantOrderPool?: Pool;
  jiagonMerchantOrderSchemaReady?: Promise<void>;
  jiagonMerchantOrderMemory?: Map<string, MerchantOrder>;
  jiagonMerchantPilotEventMemory?: MerchantPilotEvent[];
};

type MerchantPilotEventName = "qr_opened" | "order_started" | "review_submitted";

type MerchantPilotEvent = {
  merchantId: string;
  eventName: MerchantPilotEventName;
  source: string | null;
  createdAt: string;
};

export type MerchantPilotMetrics = {
  merchantId: string;
  qrOpened: number;
  orderStarted: number;
  orderConfirmed: number;
  merchantDone: number;
  receiptClaimed: number;
  reviewSubmitted: number;
  estimatedGmvUsd: string;
};

export type MerchantCreditMemo = {
  merchantId: string;
  merchantName: string;
  title: string;
  telegramOrders: number;
  merchantCompleted: number;
  customerClaimed: number;
  receiptGatedReviews: number;
  estimatedGmvUsd: string;
  proofLevel: "L0_ORDER_INTENT" | "L2_MERCHANT_COMPLETED" | "L3_CUSTOMER_CLAIMED";
  suggestedNextProofUpgrade: string;
  suggestedPurposeCredit: string;
  note: string;
};

function databaseUrl() {
  return (process.env.DATABASE_URL || "").trim();
}

function getPool() {
  const url = databaseUrl();
  if (!url) return null;

  const globalStore = globalThis as MerchantOrderGlobal;
  if (!globalStore.jiagonMerchantOrderPool) {
    const wantsSsl =
      process.env.DATABASE_SSL === "true" ||
      url.includes("sslmode=require");
    const allowInsecureSsl =
      process.env.DATABASE_SSL_INSECURE === "true" ||
      process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "false" ||
      url.includes("sslmode=no-verify");
    const enableSsl = wantsSsl || allowInsecureSsl;
    globalStore.jiagonMerchantOrderPool = new Pool({
      connectionString: url,
      max: 5,
      ssl: enableSsl ? { rejectUnauthorized: !allowInsecureSsl } : undefined,
    });
  }

  return globalStore.jiagonMerchantOrderPool;
}

async function ensureMerchantOrderSchema(pool: Pool) {
  const globalStore = globalThis as MerchantOrderGlobal;
  if (!globalStore.jiagonMerchantOrderSchemaReady) {
    globalStore.jiagonMerchantOrderSchemaReady = pool.query(`
      create table if not exists jiagon_merchant_orders (
        id text primary key,
        idempotency_key text,
        pickup_code text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        merchant_id text not null,
        merchant_name text not null,
        location text,
        customer_label text,
        source text not null,
        status text not null,
        items jsonb not null,
        subtotal_cents integer not null check (subtotal_cents > 0),
        subtotal_usd text not null,
        payment_provider text not null default 'external_pos',
        payment_status text not null default 'waiting_counter_payment',
        notes text,
        proof_level text not null,
        receipt_id text,
        receipt_claim_url text,
        receipt_hash text,
        receipt_issued_at timestamptz,
        receipt_claimed_at timestamptz,
        receipt_claimed_by text,
        payload jsonb not null
      );

      alter table jiagon_merchant_orders
        add column if not exists idempotency_key text,
        add column if not exists pickup_code text,
        add column if not exists payment_provider text not null default 'external_pos',
        add column if not exists payment_status text not null default 'waiting_counter_payment',
        add column if not exists receipt_id text,
        add column if not exists receipt_claim_url text,
        add column if not exists receipt_hash text,
        add column if not exists receipt_issued_at timestamptz,
        add column if not exists receipt_claimed_at timestamptz,
        add column if not exists receipt_claimed_by text;

      create index if not exists jiagon_merchant_orders_merchant_status_idx
        on jiagon_merchant_orders (merchant_id, status, created_at desc);

      create index if not exists jiagon_merchant_orders_receipt_idx
        on jiagon_merchant_orders (receipt_id)
        where receipt_id is not null;

      create unique index if not exists jiagon_merchant_orders_merchant_idempotency_idx
        on jiagon_merchant_orders (merchant_id, idempotency_key)
        where idempotency_key is not null;

      create unique index if not exists jiagon_merchant_orders_pickup_idx
        on jiagon_merchant_orders (merchant_id, pickup_code)
        where pickup_code is not null;

      create table if not exists jiagon_merchant_pilot_events (
        id bigserial primary key,
        created_at timestamptz not null default now(),
        merchant_id text not null,
        event_name text not null,
        source text
      );

      create index if not exists jiagon_merchant_pilot_events_merchant_event_idx
        on jiagon_merchant_pilot_events (merchant_id, event_name, created_at desc);

      drop index if exists jiagon_merchant_orders_idempotency_idx;
    `)
      .then(() => undefined)
      .catch((error) => {
        globalStore.jiagonMerchantOrderSchemaReady = undefined;
        throw error;
      });
  }

  return globalStore.jiagonMerchantOrderSchemaReady;
}

function merchantOrderMemory() {
  const globalStore = globalThis as MerchantOrderGlobal;
  if (!globalStore.jiagonMerchantOrderMemory) {
    globalStore.jiagonMerchantOrderMemory = new Map();
  }
  return globalStore.jiagonMerchantOrderMemory;
}

function merchantPilotEventMemory() {
  const globalStore = globalThis as MerchantOrderGlobal;
  if (!globalStore.jiagonMerchantPilotEventMemory) {
    globalStore.jiagonMerchantPilotEventMemory = [];
  }
  return globalStore.jiagonMerchantPilotEventMemory;
}

function orderId(merchantId: string, items: MerchantOrderItem[]) {
  const seed = `${merchantId}:${JSON.stringify(items)}:${Date.now()}:${randomBytes(8).toString("hex")}`;
  return `ord-${createHash("sha256").update(seed).digest("hex").slice(0, 16)}`;
}

function pickupCodeForOrderId(id: string) {
  const hex = id.replace(/^ord-/, "").slice(-8);
  const numeric = Number.parseInt(hex || "0", 16);
  return `A${numeric.toString(36).toUpperCase().padStart(6, "0").slice(-6)}`;
}

function isPickupCodeUniqueViolation(error: unknown) {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const text = [record.constraint, record.detail, record.message]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return record.code === "23505" && (
    text.includes("jiagon_merchant_orders_pickup_idx") ||
    text.includes("pickup_code")
  );
}

function formatUsd(cents: number) {
  return (cents / 100).toFixed(2);
}

function orderItemSummary(items: MerchantOrderItem[]) {
  return items.map((item) => `${item.quantity}x ${item.name}`).join(", ");
}

function orderMemo(order: MerchantOrder) {
  const customer = order.customerLabel ? ` Customer: ${order.customerLabel}.` : "";
  const notes = order.notes ? ` Notes: ${order.notes}.` : "";
  return `Agentic POS order ${order.id}: ${orderItemSummary(order.items)}.${customer}${notes}`.slice(0, 500);
}

function proofLevelForStatus(status: MerchantOrderStatus): MerchantOrderProofLevel {
  if (status === "accepted") return "merchant_accepted";
  if (status === "completed") return "merchant_completed";
  if (status === "cancelled") return "cancelled";
  return "order_intent_only";
}

function isMerchantOrderStatus(value: unknown): value is MerchantOrderStatus {
  return value === "pending" || value === "accepted" || value === "completed" || value === "cancelled";
}

function isMerchantOrderProofLevel(value: unknown): value is MerchantOrderProofLevel {
  return value === "order_intent_only" || value === "merchant_accepted" || value === "merchant_completed" || value === "customer_claimed" || value === "cancelled";
}

function isMerchantOrderPaymentStatus(value: unknown): value is MerchantOrderPaymentStatus {
  return value === "waiting_counter_payment" || value === "merchant_attested_paid" || value === "cancelled";
}

function canTransitionOrderStatus(current: MerchantOrderStatus, next: MerchantOrderStatus) {
  if (current === next) return true;
  if (current === "pending") return next === "accepted" || next === "completed" || next === "cancelled";
  if (current === "accepted") return next === "completed" || next === "cancelled";
  return false;
}

function mapMerchantOrderRow(row: Record<string, unknown>): MerchantOrder {
  const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
  const updatedAt = row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at);
  const items = Array.isArray(row.items) ? row.items : [];
  const status = isMerchantOrderStatus(row.status) ? row.status : "pending";
  return {
    id: String(row.id),
    idempotencyKey: typeof row.idempotency_key === "string" ? row.idempotency_key : null,
    pickupCode: typeof row.pickup_code === "string" && row.pickup_code ? row.pickup_code : pickupCodeForOrderId(String(row.id)),
    merchantId: String(row.merchant_id),
    merchantName: String(row.merchant_name),
    location: typeof row.location === "string" ? row.location : null,
    customerLabel: typeof row.customer_label === "string" ? row.customer_label : null,
    source: row.source === "telegram" || row.source === "web" || row.source === "agent" ? row.source : "tile",
    status,
    items: items as MerchantOrderItem[],
    subtotalCents: Number(row.subtotal_cents),
    subtotalUsd: String(row.subtotal_usd),
    paymentProvider: "external_pos",
    paymentStatus: isMerchantOrderPaymentStatus(row.payment_status) ? row.payment_status : status === "cancelled" ? "cancelled" : "waiting_counter_payment",
    notes: typeof row.notes === "string" ? row.notes : null,
    proofLevel: isMerchantOrderProofLevel(row.proof_level) ? row.proof_level : proofLevelForStatus(status),
    receiptId: typeof row.receipt_id === "string" ? row.receipt_id : null,
    receiptClaimUrl: typeof row.receipt_claim_url === "string" ? row.receipt_claim_url : null,
    receiptHash: typeof row.receipt_hash === "string" ? row.receipt_hash : null,
    receiptIssuedAt: row.receipt_issued_at instanceof Date
      ? row.receipt_issued_at.toISOString()
      : typeof row.receipt_issued_at === "string"
        ? row.receipt_issued_at
        : null,
    receiptClaimedAt: row.receipt_claimed_at instanceof Date
      ? row.receipt_claimed_at.toISOString()
      : typeof row.receipt_claimed_at === "string"
        ? row.receipt_claimed_at
        : null,
    receiptClaimedBy: typeof row.receipt_claimed_by === "string" ? row.receipt_claimed_by : null,
    createdAt,
    updatedAt,
  };
}

export function publicMerchantOrder(order: MerchantOrder) {
  return {
    id: order.id,
    pickupCode: order.pickupCode,
    merchantId: order.merchantId,
    merchantName: order.merchantName,
    location: order.location,
    customerLabel: order.customerLabel,
    source: order.source,
    status: order.status,
    items: order.items,
    subtotalCents: order.subtotalCents,
    subtotalUsd: order.subtotalUsd,
    paymentProvider: order.paymentProvider,
    paymentStatus: order.paymentStatus,
    notes: order.notes,
    proofLevel: order.proofLevel,
    receiptId: order.receiptId,
    receiptClaimUrl: order.receiptClaimUrl,
    receiptHash: order.receiptHash,
    receiptIssuedAt: order.receiptIssuedAt,
    receiptClaimedAt: order.receiptClaimedAt,
    receiptClaimedBy: order.receiptClaimedBy,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

export async function createMerchantOrder(input: MerchantOrderCreateInput): Promise<{
  configured: boolean;
  persisted: boolean;
  order: MerchantOrder;
  error?: string;
}> {
  const subtotalCents = input.items.reduce((total, item) => total + item.unitAmountCents * item.quantity, 0);
  const buildOrder = (): MerchantOrder => {
    const now = new Date().toISOString();
    const id = orderId(input.merchantId, input.items);
    return {
      id,
      idempotencyKey: input.idempotencyKey?.trim() || null,
      pickupCode: pickupCodeForOrderId(id),
      merchantId: input.merchantId,
      merchantName: input.merchantName,
      location: input.location?.trim() || null,
      customerLabel: input.customerLabel?.trim() || null,
      source: input.source || "tile",
      status: "pending",
      items: input.items,
      subtotalCents,
      subtotalUsd: formatUsd(subtotalCents),
      paymentProvider: "external_pos",
      paymentStatus: "waiting_counter_payment",
      notes: input.notes?.trim() || null,
      proofLevel: proofLevelForStatus("pending"),
      receiptId: null,
      receiptClaimUrl: null,
      receiptHash: null,
      receiptIssuedAt: null,
      receiptClaimedAt: null,
      receiptClaimedBy: null,
      createdAt: now,
      updatedAt: now,
    };
  };
  let order = buildOrder();

  const pool = getPool();
  if (!pool) {
    if (order.idempotencyKey) {
      const existing = Array.from(merchantOrderMemory().values()).find(
        (memoryOrder) => memoryOrder.merchantId === order.merchantId && memoryOrder.idempotencyKey === order.idempotencyKey,
      );
      if (existing) return { configured: false, persisted: false, order: existing };
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const collision = Array.from(merchantOrderMemory().values()).some(
        (memoryOrder) => memoryOrder.merchantId === order.merchantId && memoryOrder.pickupCode === order.pickupCode,
      );
      if (!collision) break;
      order = buildOrder();
    }
    const finalCollision = Array.from(merchantOrderMemory().values()).some(
      (memoryOrder) => memoryOrder.merchantId === order.merchantId && memoryOrder.pickupCode === order.pickupCode,
    );
    if (finalCollision) {
      return { configured: false, persisted: false, order, error: "Merchant order pickup code generation failed." };
    }
    merchantOrderMemory().set(order.id, order);
    return { configured: false, persisted: false, order };
  }

  await ensureMerchantOrderSchema(pool);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const result = await pool.query(
        `
          insert into jiagon_merchant_orders (
            id,
            idempotency_key,
            pickup_code,
            merchant_id,
            merchant_name,
            location,
            customer_label,
            source,
            status,
            items,
            subtotal_cents,
            subtotal_usd,
            payment_provider,
            payment_status,
            notes,
            proof_level,
            receipt_id,
            receipt_claim_url,
            receipt_hash,
            receipt_issued_at,
            receipt_claimed_at,
            receipt_claimed_by,
            payload
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20::timestamptz, $21::timestamptz, $22, $23::jsonb)
          on conflict (merchant_id, idempotency_key) where idempotency_key is not null do update
            set idempotency_key = excluded.idempotency_key
          returning
            id,
            idempotency_key,
            pickup_code,
            merchant_id,
            merchant_name,
            location,
            customer_label,
            source,
            status,
            items,
            subtotal_cents,
            subtotal_usd,
            payment_provider,
            payment_status,
            notes,
            proof_level,
            receipt_id,
            receipt_claim_url,
            receipt_hash,
            receipt_issued_at,
            receipt_claimed_at,
            receipt_claimed_by,
            created_at,
            updated_at
        `,
        [
          order.id,
          order.idempotencyKey,
          order.pickupCode,
          order.merchantId,
          order.merchantName,
          order.location,
          order.customerLabel,
          order.source,
          order.status,
          JSON.stringify(order.items),
          order.subtotalCents,
          order.subtotalUsd,
          order.paymentProvider,
          order.paymentStatus,
          order.notes,
          order.proofLevel,
          order.receiptId,
          order.receiptClaimUrl,
          order.receiptHash,
          order.receiptIssuedAt,
          order.receiptClaimedAt,
          order.receiptClaimedBy,
          JSON.stringify(order),
        ],
      );
      return { configured: true, persisted: true, order: mapMerchantOrderRow(result.rows[0]) };
    } catch (error) {
      if (attempt < 4 && isPickupCodeUniqueViolation(error)) {
        order = buildOrder();
        continue;
      }
      return { configured: true, persisted: false, order, error: "Merchant order persistence failed." };
    }
  }

  return { configured: true, persisted: false, order, error: "Merchant order persistence failed." };
}

export async function listMerchantOrders(input: {
  merchantId?: string | null;
  status?: MerchantOrderStatus | null;
  limit?: number;
}): Promise<{
  configured: boolean;
  orders: MerchantOrder[];
  error?: string;
}> {
  const limit = Math.min(Math.max(input.limit || 25, 1), 100);
  const memoryOrders = () => Array.from(merchantOrderMemory().values())
    .filter((order) => !input.merchantId || order.merchantId === input.merchantId)
    .filter((order) => !input.status || order.status === input.status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);

  const pool = getPool();
  if (!pool) {
    return { configured: false, orders: memoryOrders() };
  }

  try {
    await ensureMerchantOrderSchema(pool);
    const clauses = [];
    const values: unknown[] = [];
    if (input.merchantId) {
      values.push(input.merchantId);
      clauses.push(`merchant_id = $${values.length}`);
    }
    if (input.status) {
      values.push(input.status);
      clauses.push(`status = $${values.length}`);
    }
    values.push(limit);
    const where = clauses.length > 0 ? `where ${clauses.join(" and ")}` : "";
    const result = await pool.query(
      `
        select
          id,
          idempotency_key,
          pickup_code,
          merchant_id,
          merchant_name,
          location,
          customer_label,
          source,
          status,
          items,
          subtotal_cents,
          subtotal_usd,
          payment_provider,
          payment_status,
          notes,
          proof_level,
          receipt_id,
          receipt_claim_url,
          receipt_hash,
          receipt_issued_at,
          receipt_claimed_at,
          receipt_claimed_by,
          created_at,
          updated_at
        from jiagon_merchant_orders
        ${where}
        order by created_at desc
        limit $${values.length}
      `,
      values,
    );

    return { configured: true, orders: result.rows.map(mapMerchantOrderRow) };
  } catch {
    return { configured: true, orders: [], error: "Merchant order query failed." };
  }
}

export async function findMerchantOrderByPickupCode(input: {
  merchantId: string;
  pickupCode: string;
}): Promise<{
  configured: boolean;
  order: MerchantOrder | null;
  error?: string;
}> {
  const merchantId = input.merchantId.trim();
  const pickupCode = input.pickupCode.trim().toUpperCase();
  if (!merchantId || !pickupCode) {
    return { configured: Boolean(getPool()), order: null, error: "Merchant id and pickup code are required." };
  }

  const memoryMatch = () => Array.from(merchantOrderMemory().values()).find(
    (order) => order.merchantId === merchantId && order.pickupCode.toUpperCase() === pickupCode,
  ) || null;

  const pool = getPool();
  if (!pool) {
    return { configured: false, order: memoryMatch() };
  }

  try {
    await ensureMerchantOrderSchema(pool);
    const result = await pool.query(
      `
        select
          id,
          idempotency_key,
          pickup_code,
          merchant_id,
          merchant_name,
          location,
          customer_label,
          source,
          status,
          items,
          subtotal_cents,
          subtotal_usd,
          payment_provider,
          payment_status,
          notes,
          proof_level,
          receipt_id,
          receipt_claim_url,
          receipt_hash,
          receipt_issued_at,
          receipt_claimed_at,
          receipt_claimed_by,
          created_at,
          updated_at
        from jiagon_merchant_orders
        where merchant_id = $1
          and upper(pickup_code) = $2
        limit 1
      `,
      [merchantId, pickupCode],
    );

    return { configured: true, order: result.rows[0] ? mapMerchantOrderRow(result.rows[0]) : null };
  } catch {
    return { configured: true, order: null, error: "Merchant receipt claim lookup failed." };
  }
}

async function getMerchantOrderById(id: string): Promise<{
  configured: boolean;
  order: MerchantOrder | null;
  error?: string;
}> {
  const pool = getPool();
  if (!pool) {
    return { configured: false, order: merchantOrderMemory().get(id) || null };
  }

  try {
    await ensureMerchantOrderSchema(pool);
    const result = await pool.query(
      `
        select
          id,
          idempotency_key,
          pickup_code,
          merchant_id,
          merchant_name,
          location,
          customer_label,
          source,
          status,
          items,
          subtotal_cents,
          subtotal_usd,
          payment_provider,
          payment_status,
          notes,
          proof_level,
          receipt_id,
          receipt_claim_url,
          receipt_hash,
          receipt_issued_at,
          receipt_claimed_at,
          receipt_claimed_by,
          created_at,
          updated_at
        from jiagon_merchant_orders
        where id = $1
        limit 1
      `,
      [id],
    );
    return { configured: true, order: result.rows[0] ? mapMerchantOrderRow(result.rows[0]) : null };
  } catch {
    return { configured: true, order: null, error: "Merchant order query failed." };
  }
}

export async function updateMerchantOrderStatus(input: {
  id: string;
  nextStatus: MerchantOrderStatus;
}): Promise<{
  configured: boolean;
  updated: boolean;
  order: MerchantOrder | null;
  error?: string;
}> {
  const pool = getPool();
  const memory = merchantOrderMemory();

  if (!pool) {
    const current = memory.get(input.id);
    if (!current) {
      return { configured: false, updated: false, order: null, error: "Merchant order was not found." };
    }
    if (!canTransitionOrderStatus(current.status, input.nextStatus)) {
      return {
        configured: false,
        updated: false,
        order: current,
        error: `Cannot move order from ${current.status} to ${input.nextStatus}.`,
      };
    }
    const nextOrder: MerchantOrder = {
      ...current,
      status: input.nextStatus,
      proofLevel: proofLevelForStatus(input.nextStatus),
      paymentStatus: input.nextStatus === "cancelled" ? "cancelled" : current.paymentStatus,
      updatedAt: new Date().toISOString(),
    };
    memory.set(input.id, nextOrder);
    return { configured: false, updated: true, order: nextOrder };
  }

  try {
    await ensureMerchantOrderSchema(pool);
    const currentResult = await pool.query(
      `
        select
          id,
          idempotency_key,
          pickup_code,
          merchant_id,
          merchant_name,
          location,
          customer_label,
          source,
          status,
          items,
          subtotal_cents,
          subtotal_usd,
          payment_provider,
          payment_status,
          notes,
          proof_level,
          receipt_id,
          receipt_claim_url,
          receipt_hash,
          receipt_issued_at,
          receipt_claimed_at,
          receipt_claimed_by,
          created_at,
          updated_at
        from jiagon_merchant_orders
        where id = $1
        limit 1
      `,
      [input.id],
    );
    const currentRow = currentResult.rows[0];
    if (!currentRow) {
      return { configured: true, updated: false, order: null, error: "Merchant order was not found." };
    }

    const current = mapMerchantOrderRow(currentRow);
    if (!canTransitionOrderStatus(current.status, input.nextStatus)) {
      return {
        configured: true,
        updated: false,
        order: current,
        error: `Cannot move order from ${current.status} to ${input.nextStatus}.`,
      };
    }

    const proofLevel = proofLevelForStatus(input.nextStatus);
    const result = await pool.query(
      `
        update jiagon_merchant_orders
        set
          status = $2,
          proof_level = $3,
          payment_status = $5,
          updated_at = now(),
          payload = jsonb_set(jsonb_set(jsonb_set(payload, '{status}', to_jsonb($2::text), true), '{proofLevel}', to_jsonb($3::text), true), '{paymentStatus}', to_jsonb($5::text), true)
        where id = $1
          and status = $4
        returning
          id,
          idempotency_key,
          pickup_code,
          merchant_id,
          merchant_name,
          location,
          customer_label,
          source,
          status,
          items,
          subtotal_cents,
          subtotal_usd,
          payment_provider,
          payment_status,
          notes,
          proof_level,
          receipt_id,
          receipt_claim_url,
          receipt_hash,
          receipt_issued_at,
          receipt_claimed_at,
          receipt_claimed_by,
          created_at,
          updated_at
      `,
      [input.id, input.nextStatus, proofLevel, current.status, input.nextStatus === "cancelled" ? "cancelled" : current.paymentStatus],
    );
    if (result.rowCount === 0) {
      return {
        configured: true,
        updated: false,
        order: current,
        error: "Merchant order changed before this status update could be applied. Refresh the queue and try again.",
      };
    }
    return { configured: true, updated: true, order: mapMerchantOrderRow(result.rows[0]) };
  } catch {
    return { configured: true, updated: false, order: null, error: "Merchant order status update failed." };
  }
}

export async function completeMerchantOrderWithReceipt(input: {
  id: string;
  origin: string;
  issuedBy?: string | null;
}): Promise<{
  configured: boolean;
  updated: boolean;
  receiptConfigured: boolean;
  receiptPersisted: boolean;
  order: MerchantOrder | null;
  receipt?: ReturnType<typeof publicMerchantReceipt>;
  claimToken?: string;
  error?: string;
}> {
  const pool = getPool();
  if (!pool) {
    const current = merchantOrderMemory().get(input.id) || null;
    if (!current) {
      return {
        configured: false,
        updated: false,
        receiptConfigured: false,
        receiptPersisted: false,
        order: null,
        error: "Merchant order was not found.",
      };
    }
    if (current.receiptClaimUrl) {
      return {
        configured: false,
        updated: true,
        receiptConfigured: false,
        receiptPersisted: false,
        order: current,
      };
    }
    if (!canTransitionOrderStatus(current.status, "completed")) {
      return {
        configured: false,
        updated: false,
        receiptConfigured: false,
        receiptPersisted: false,
        order: current,
        error: `Cannot complete order from ${current.status}.`,
      };
    }

    const receiptResult = await createMerchantIssuedReceipt({
      merchantId: current.merchantId,
      merchantName: current.merchantName,
      location: current.location,
      receiptNumber: current.id,
      amountCents: current.subtotalCents,
      currency: "USD",
      category: current.items[0]?.name || "Merchant order",
      purpose: "agentic_pos_order_receipt",
      issuedBy: input.issuedBy || "Jiagon merchant dashboard",
      memo: orderMemo(current),
      origin: input.origin,
    });
    const nextOrder: MerchantOrder = {
      ...current,
      status: "completed",
      proofLevel: proofLevelForStatus("completed"),
      paymentStatus: "merchant_attested_paid",
      receiptId: receiptResult.receipt.id,
      receiptClaimUrl: receiptResult.receipt.claimUrl,
      receiptHash: receiptResult.receipt.receiptHash,
      receiptIssuedAt: receiptResult.receipt.issuedAt,
      updatedAt: new Date().toISOString(),
    };
    merchantOrderMemory().set(nextOrder.id, nextOrder);
    return {
      configured: false,
      updated: true,
      receiptConfigured: receiptResult.configured,
      receiptPersisted: receiptResult.persisted,
      order: nextOrder,
      receipt: publicMerchantReceipt(receiptResult.receipt),
      claimToken: receiptResult.claimToken,
    };
  }

  let current: MerchantOrder | null = null;
  const client = await pool.connect();
  try {
    await ensureMerchantOrderSchema(pool);
    await client.query("begin");
    const currentResult = await client.query(
      `
        select
          id,
          idempotency_key,
          pickup_code,
          merchant_id,
          merchant_name,
          location,
          customer_label,
          source,
          status,
          items,
          subtotal_cents,
          subtotal_usd,
          payment_provider,
          payment_status,
          notes,
          proof_level,
          receipt_id,
          receipt_claim_url,
          receipt_hash,
          receipt_issued_at,
          receipt_claimed_at,
          receipt_claimed_by,
          created_at,
          updated_at
        from jiagon_merchant_orders
        where id = $1
        limit 1
        for update
      `,
      [input.id],
    );
    current = currentResult.rows[0] ? mapMerchantOrderRow(currentResult.rows[0]) : null;
    if (!current) {
      await client.query("rollback");
      return {
        configured: true,
        updated: false,
        receiptConfigured: false,
        receiptPersisted: false,
        order: null,
        error: "Merchant order was not found.",
      };
    }
    if (current.receiptClaimUrl) {
      await client.query("commit");
      return {
        configured: true,
        updated: true,
        receiptConfigured: false,
        receiptPersisted: false,
        order: current,
      };
    }
    if (!canTransitionOrderStatus(current.status, "completed")) {
      await client.query("rollback");
      return {
        configured: true,
        updated: false,
        receiptConfigured: false,
        receiptPersisted: false,
        order: current,
        error: `Cannot complete order from ${current.status}.`,
      };
    }

    const receiptResult = await createMerchantIssuedReceipt({
      merchantId: current.merchantId,
      merchantName: current.merchantName,
      location: current.location,
      receiptNumber: current.id,
      amountCents: current.subtotalCents,
      currency: "USD",
      category: current.items[0]?.name || "Merchant order",
      purpose: "agentic_pos_order_receipt",
      issuedBy: input.issuedBy || "Jiagon merchant dashboard",
      memo: orderMemo(current),
      origin: input.origin,
    });
    if (receiptResult.configured && !receiptResult.persisted) {
      await client.query("rollback");
      return {
        configured: true,
        updated: false,
        receiptConfigured: receiptResult.configured,
        receiptPersisted: receiptResult.persisted,
        order: current,
        receipt: publicMerchantReceipt(receiptResult.receipt),
        claimToken: receiptResult.claimToken,
        error: receiptResult.error || "Merchant receipt persistence failed.",
      };
    }

    const nextOrder: MerchantOrder = {
      ...current,
      status: "completed",
      proofLevel: proofLevelForStatus("completed"),
      paymentStatus: "merchant_attested_paid",
      receiptId: receiptResult.receipt.id,
      receiptClaimUrl: receiptResult.receipt.claimUrl,
      receiptHash: receiptResult.receipt.receiptHash,
      receiptIssuedAt: receiptResult.receipt.issuedAt,
      updatedAt: new Date().toISOString(),
    };
    const result = await client.query(
      `
        update jiagon_merchant_orders
        set
          status = $2,
          proof_level = $3,
          payment_status = 'merchant_attested_paid',
          receipt_id = $4,
          receipt_claim_url = $5,
          receipt_hash = $6,
          receipt_issued_at = $7::timestamptz,
          updated_at = now(),
          payload = $8::jsonb
        where id = $1
          and status = $9
          and receipt_id is null
        returning
          id,
          idempotency_key,
          pickup_code,
          merchant_id,
          merchant_name,
          location,
          customer_label,
          source,
          status,
          items,
          subtotal_cents,
          subtotal_usd,
          payment_provider,
          payment_status,
          notes,
          proof_level,
          receipt_id,
          receipt_claim_url,
          receipt_hash,
          receipt_issued_at,
          receipt_claimed_at,
          receipt_claimed_by,
          created_at,
          updated_at
      `,
      [
        nextOrder.id,
        nextOrder.status,
        nextOrder.proofLevel,
        nextOrder.receiptId,
        nextOrder.receiptClaimUrl,
        nextOrder.receiptHash,
        nextOrder.receiptIssuedAt,
        JSON.stringify(nextOrder),
        current.status,
      ],
    );

    if (result.rowCount === 0) {
      await client.query("rollback");
      return {
        configured: true,
        updated: false,
        receiptConfigured: receiptResult.configured,
        receiptPersisted: receiptResult.persisted,
        order: current,
        receipt: publicMerchantReceipt(receiptResult.receipt),
        claimToken: receiptResult.claimToken,
        error: "Merchant order changed before the receipt could be attached. Refresh the queue and try again.",
      };
    }

    await client.query("commit");
    return {
      configured: true,
      updated: true,
      receiptConfigured: receiptResult.configured,
      receiptPersisted: receiptResult.persisted,
      order: mapMerchantOrderRow(result.rows[0]),
      receipt: publicMerchantReceipt(receiptResult.receipt),
      claimToken: receiptResult.claimToken,
    };
  } catch {
    try {
      await client.query("rollback");
    } catch {
      // Ignore rollback failures and return the primary error below.
    }
    return {
      configured: true,
      updated: false,
      receiptConfigured: false,
      receiptPersisted: false,
      order: current,
      error: "Merchant order receipt attachment failed.",
    };
  } finally {
    client.release();
  }
}

export async function markMerchantOrderReceiptClaimed(input: {
  receiptId: string;
  claimedBy: string;
  claimedAt?: string | null;
}): Promise<{
  configured: boolean;
  updated: boolean;
  order: MerchantOrder | null;
  error?: string;
}> {
  const claimedAt = input.claimedAt || new Date().toISOString();
  const pool = getPool();
  const memory = merchantOrderMemory();

  if (!pool) {
    const current = Array.from(memory.values()).find((order) => order.receiptId === input.receiptId) || null;
    if (!current) return { configured: false, updated: false, order: null };
    if (current.receiptClaimedAt || current.receiptClaimedBy) {
      return { configured: false, updated: false, order: current };
    }
    const nextOrder: MerchantOrder = {
      ...current,
      proofLevel: "customer_claimed",
      receiptClaimedAt: claimedAt,
      receiptClaimedBy: input.claimedBy,
      updatedAt: new Date().toISOString(),
    };
    memory.set(nextOrder.id, nextOrder);
    return { configured: false, updated: true, order: nextOrder };
  }

  try {
    await ensureMerchantOrderSchema(pool);
    const result = await pool.query(
      `
        update jiagon_merchant_orders
        set
          proof_level = 'customer_claimed',
          receipt_claimed_at = $2::timestamptz,
          receipt_claimed_by = $3,
          updated_at = now(),
          payload = jsonb_set(jsonb_set(jsonb_set(payload, '{proofLevel}', to_jsonb('customer_claimed'::text), true), '{receiptClaimedAt}', to_jsonb($2::text), true), '{receiptClaimedBy}', to_jsonb($3::text), true)
        where receipt_id = $1
          and receipt_claimed_at is null
        returning
          id,
          idempotency_key,
          pickup_code,
          merchant_id,
          merchant_name,
          location,
          customer_label,
          source,
          status,
          items,
          subtotal_cents,
          subtotal_usd,
          payment_provider,
          payment_status,
          notes,
          proof_level,
          receipt_id,
          receipt_claim_url,
          receipt_hash,
          receipt_issued_at,
          receipt_claimed_at,
          receipt_claimed_by,
          created_at,
          updated_at
      `,
      [input.receiptId, claimedAt, input.claimedBy],
    );
    if (result.rows[0]) {
      return { configured: true, updated: true, order: mapMerchantOrderRow(result.rows[0]) };
    }

    const existingResult = await pool.query(
      `
        select
          id,
          idempotency_key,
          pickup_code,
          merchant_id,
          merchant_name,
          location,
          customer_label,
          source,
          status,
          items,
          subtotal_cents,
          subtotal_usd,
          payment_provider,
          payment_status,
          notes,
          proof_level,
          receipt_id,
          receipt_claim_url,
          receipt_hash,
          receipt_issued_at,
          receipt_claimed_at,
          receipt_claimed_by,
          created_at,
          updated_at
        from jiagon_merchant_orders
        where receipt_id = $1
        limit 1
      `,
      [input.receiptId],
    );
    return {
      configured: true,
      updated: false,
      order: existingResult.rows[0] ? mapMerchantOrderRow(existingResult.rows[0]) : null,
    };
  } catch {
    return { configured: true, updated: false, order: null, error: "Merchant order receipt claim sync failed." };
  }
}

export async function recordMerchantPilotEvent(input: {
  merchantId: string;
  eventName: MerchantPilotEventName;
  source?: string | null;
}): Promise<{ configured: boolean; recorded: boolean; error?: string }> {
  const event: MerchantPilotEvent = {
    merchantId: input.merchantId,
    eventName: input.eventName,
    source: input.source?.trim().slice(0, 80) || null,
    createdAt: new Date().toISOString(),
  };
  const pool = getPool();

  if (!pool) {
    merchantPilotEventMemory().push(event);
    return { configured: false, recorded: true };
  }

  try {
    await ensureMerchantOrderSchema(pool);
    await pool.query(
      `
        insert into jiagon_merchant_pilot_events (merchant_id, event_name, source)
        values ($1, $2, $3)
      `,
      [event.merchantId, event.eventName, event.source],
    );
    return { configured: true, recorded: true };
  } catch {
    return { configured: true, recorded: false, error: "Merchant pilot event persistence failed." };
  }
}

export async function getMerchantPilotMetrics(input: {
  merchantId: string;
}): Promise<{ configured: boolean; metrics: MerchantPilotMetrics; error?: string }> {
  const emptyMetrics = (partial?: Partial<MerchantPilotMetrics>): MerchantPilotMetrics => ({
    merchantId: input.merchantId,
    qrOpened: 0,
    orderStarted: 0,
    orderConfirmed: 0,
    merchantDone: 0,
    receiptClaimed: 0,
    reviewSubmitted: 0,
    estimatedGmvUsd: "0.00",
    ...partial,
  });

  const pool = getPool();
  if (!pool) {
    const orders = Array.from(merchantOrderMemory().values()).filter((order) => order.merchantId === input.merchantId);
    const events = merchantPilotEventMemory().filter((event) => event.merchantId === input.merchantId);
    const completedOrders = orders.filter((order) => order.status === "completed");
    const estimatedGmvCents = completedOrders.reduce((total, order) => total + order.subtotalCents, 0);
    return {
      configured: false,
      metrics: emptyMetrics({
        qrOpened: events.filter((event) => event.eventName === "qr_opened").length,
        orderStarted: events.filter((event) => event.eventName === "order_started").length,
        orderConfirmed: orders.length,
        merchantDone: completedOrders.length,
        receiptClaimed: orders.filter((order) => order.receiptClaimedAt).length,
        reviewSubmitted: events.filter((event) => event.eventName === "review_submitted").length,
        estimatedGmvUsd: formatUsd(estimatedGmvCents),
      }),
    };
  }

  try {
    await ensureMerchantOrderSchema(pool);
    const [orderResult, eventResult] = await Promise.all([
      pool.query(
        `
          select
            count(*)::int as order_confirmed,
            count(*) filter (where status = 'completed')::int as merchant_done,
            count(*) filter (where receipt_claimed_at is not null)::int as receipt_claimed,
            coalesce(sum(subtotal_cents) filter (where status = 'completed'), 0)::int as estimated_gmv_cents
          from jiagon_merchant_orders
          where merchant_id = $1
        `,
        [input.merchantId],
      ),
      pool.query(
        `
          select event_name, count(*)::int as count
          from jiagon_merchant_pilot_events
          where merchant_id = $1
          group by event_name
        `,
        [input.merchantId],
      ),
    ]);
    const orderRow = orderResult.rows[0] || {};
    const eventCounts = new Map<string, number>(
      eventResult.rows.map((row: Record<string, unknown>) => [String(row.event_name), Number(row.count)]),
    );
    return {
      configured: true,
      metrics: emptyMetrics({
        qrOpened: eventCounts.get("qr_opened") || 0,
        orderStarted: eventCounts.get("order_started") || 0,
        orderConfirmed: Number(orderRow.order_confirmed || 0),
        merchantDone: Number(orderRow.merchant_done || 0),
        receiptClaimed: Number(orderRow.receipt_claimed || 0),
        reviewSubmitted: eventCounts.get("review_submitted") || 0,
        estimatedGmvUsd: formatUsd(Number(orderRow.estimated_gmv_cents || 0)),
      }),
    };
  } catch {
    return { configured: true, metrics: emptyMetrics(), error: "Merchant pilot metrics query failed." };
  }
}

export async function getMerchantCreditMemo(input: {
  merchantId: string;
  merchantName?: string | null;
}): Promise<{ configured: boolean; memo: MerchantCreditMemo; error?: string }> {
  const metricsResult = await getMerchantPilotMetrics({ merchantId: input.merchantId });
  const metrics = metricsResult.metrics;
  const proofLevel = metrics.receiptClaimed > 0
    ? "L3_CUSTOMER_CLAIMED"
    : metrics.merchantDone > 0
      ? "L2_MERCHANT_COMPLETED"
      : "L0_ORDER_INTENT";
  return {
    configured: metricsResult.configured,
    error: metricsResult.error,
    memo: {
      merchantId: input.merchantId,
      merchantName: input.merchantName?.trim() || input.merchantId,
      title: `${input.merchantName?.trim() || input.merchantId} — Jiagon Credit Memo`,
      telegramOrders: metrics.orderConfirmed,
      merchantCompleted: metrics.merchantDone,
      customerClaimed: metrics.receiptClaimed,
      receiptGatedReviews: metrics.reviewSubmitted,
      estimatedGmvUsd: metrics.estimatedGmvUsd,
      proofLevel,
      suggestedNextProofUpgrade: "Helio-backed payment receipts",
      suggestedPurposeCredit: "next-event inventory / booth / staffing credit",
      note: "This is not immediate real lending. It is the first artifact showing how verified order receipts become underwriting data.",
    },
  };
}

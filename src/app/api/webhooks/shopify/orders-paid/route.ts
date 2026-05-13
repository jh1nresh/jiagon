import {
  completeMerchantOrderWithReceipt,
  publicMerchantOrder,
  type MerchantOrderPaymentProvider,
  type MerchantOrderPaymentStatus,
} from "@/server/merchantOrderStore";
import {
  createMerchantIssuedReceipt,
  getMerchantIssuedReceiptByMerchantReceiptNumber,
  publicMerchantReceipt,
} from "@/server/receiptStore";
import {
  parseShopifyPaidOrderProof,
  shopifyConfig,
  shopifyLineItemCategory,
  shopifyMerchantId,
  shopifyPaidOrderAmountCents,
  shopifyReceiptMemo,
  verifyShopifyWebhookSignature,
} from "@/server/shopifyCommerce";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  return process.env.NODE_ENV !== "production" ? new URL(request.url).origin : "";
}

function verifiedPaymentFromGateways(gateways: string[]): {
  paymentProvider: MerchantOrderPaymentProvider;
  paymentStatus: Exclude<MerchantOrderPaymentStatus, "waiting_counter_payment" | "cancelled">;
} {
  void gateways;
  return {
    paymentProvider: "shopify",
    paymentStatus: "shopify_verified_paid",
  };
}

function normalizeShopDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export async function POST(request: Request) {
  const config = shopifyConfig();
  if (!config.webhookConfigured) {
    return Response.json(
      { error: "SHOPIFY_WEBHOOK_SECRET or SHOPIFY_API_SECRET is required." },
      { status: 503 },
    );
  }

  const rawBody = await request.text();
  if (rawBody.length > 500_000) {
    return Response.json({ error: "Shopify webhook payload is too large." }, { status: 413 });
  }

  const hmac = request.headers.get("x-shopify-hmac-sha256") || "";
  if (!verifyShopifyWebhookSignature({ rawBody, signature: hmac, secret: config.webhookSecret })) {
    return Response.json({ error: "Invalid Shopify webhook signature." }, { status: 401 });
  }

  const topic = request.headers.get("x-shopify-topic") || "orders/paid";
  const shopDomain = request.headers.get("x-shopify-shop-domain") || config.shopDomain;
  if (normalizeShopDomain(shopDomain) !== normalizeShopDomain(config.shopDomain)) {
    return Response.json(
      {
        error: "Shopify webhook shop domain does not match the configured merchant.",
        shopDomain,
      },
      { status: 401 },
    );
  }
  if (topic !== "orders/paid") {
    return Response.json(
      {
        accepted: true,
        ignored: true,
        reason: "Webhook is authenticated, but only orders/paid creates Jiagon receipts.",
        topic,
      },
      { status: 202 },
    );
  }

  let payload: unknown;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return Response.json({ error: "Invalid JSON webhook payload." }, { status: 400 });
  }

  const proof = parseShopifyPaidOrderProof({ payload, shopDomain, topic });
  if (!proof) {
    return Response.json(
      {
        accepted: true,
        ignored: true,
        reason: "Webhook is authenticated, but order is not paid or cannot be parsed.",
      },
      { status: 202 },
    );
  }

  const origin = requestOrigin(request);
  if (!origin) {
    return Response.json(
      { error: "JIAGON_APP_ORIGIN or NEXT_PUBLIC_APP_URL is required to issue receipt claim links." },
      { status: 503 },
    );
  }

  const merchantId = shopifyMerchantId(proof.shopDomain);
  const verifiedPayment = verifiedPaymentFromGateways(proof.paymentGatewayNames);
  const paidAmountCents = shopifyPaidOrderAmountCents(proof);
  if (proof.jiagonOrderId) {
    const orderReceipt = await completeMerchantOrderWithReceipt({
      id: proof.jiagonOrderId,
      origin,
      issuedBy: "Shopify orders/paid webhook",
      paymentProvider: verifiedPayment.paymentProvider,
      paymentStatus: verifiedPayment.paymentStatus,
      receiptPurpose: "shopify_paid_order_receipt",
      receiptMemo: shopifyReceiptMemo(proof),
      minimumPaidCents: paidAmountCents,
      expectedMerchantIds: [proof.jiagonMerchantId, merchantId].filter((value): value is string => Boolean(value)),
    });

    if (orderReceipt.order && orderReceipt.updated) {
      return Response.json({
        accepted: true,
        product: "Jiagon Shopify paid-order receipt adapter",
        shopifyProof: proof,
        receiptPersistence: {
          configured: orderReceipt.receiptConfigured,
          persisted: orderReceipt.receiptPersisted,
        },
        claimToken: orderReceipt.claimToken || null,
        claimUrl: orderReceipt.order.receiptClaimUrl,
        receipt: orderReceipt.receipt || null,
        order: publicMerchantOrder(orderReceipt.order),
      });
    }

    const error = orderReceipt.error || "Shopify paid order could not attach a Jiagon receipt.";
    return Response.json(
      {
        error,
        product: "Jiagon Shopify paid-order receipt adapter",
        shopifyProof: proof,
        configured: orderReceipt.configured,
        receiptPersistence: {
          configured: orderReceipt.receiptConfigured,
          persisted: orderReceipt.receiptPersisted,
        },
        order: orderReceipt.order ? publicMerchantOrder(orderReceipt.order) : null,
      },
      { status: orderReceipt.order ? 409 : 404 },
    );
  }

  const receiptNumber = `shopify:${proof.shopDomain}:${proof.orderId}`;
  const existing = await getMerchantIssuedReceiptByMerchantReceiptNumber({ merchantId, receiptNumber });
  if (existing.error) {
    return Response.json({ error: existing.error, configured: existing.configured }, { status: 503 });
  }
  if (existing.receipt) {
    return Response.json({
      accepted: true,
      duplicate: true,
      product: "Jiagon Shopify paid-order receipt adapter",
      shopifyProof: proof,
      receipt: publicMerchantReceipt(existing.receipt),
      claimUrl: existing.receipt.claimUrl,
    });
  }

  if (paidAmountCents <= 0) {
    return Response.json({ error: "Paid Shopify order amount must be greater than zero." }, { status: 422 });
  }

  const receiptResult = await createMerchantIssuedReceipt({
    merchantId,
    merchantName: proof.shopDomain,
    location: proof.shopDomain,
    receiptNumber,
    amountCents: paidAmountCents,
    currency: proof.currency,
    category: shopifyLineItemCategory(proof),
    purpose: "shopify_paid_order_receipt",
    issuedBy: "Shopify orders/paid webhook",
    memo: shopifyReceiptMemo(proof),
    origin,
  });

  if (receiptResult.configured && !receiptResult.persisted) {
    return Response.json(
      {
        error: receiptResult.error || "Shopify paid-order receipt persistence failed.",
        shopifyProof: proof,
        receipt: publicMerchantReceipt(receiptResult.receipt),
      },
      { status: 503 },
    );
  }

  return Response.json({
    accepted: true,
    product: "Jiagon Shopify paid-order receipt adapter",
    shopifyProof: proof,
    receiptPersistence: {
      configured: receiptResult.configured,
      persisted: receiptResult.persisted,
    },
    claimToken: receiptResult.claimToken,
    claimUrl: receiptResult.receipt.claimUrl,
    receipt: publicMerchantReceipt(receiptResult.receipt),
  });
}

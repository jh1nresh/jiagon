import {
  moonPayDirectPaylinkError,
  moonPayDirectReceiptNumber,
  moonPayPaymentCurrencyError,
  moonPayPaymentAmountCents,
  moonPayPaylinkAllowlistError,
  moonPayReceiptMemo,
  moonPayWebhookSharedToken,
  parseMoonPayCommercePaymentProof,
  verifyMoonPayWebhookSignature,
} from "@/server/moonpayCommerce";
import { completeMerchantOrderWithReceipt, publicMerchantOrder } from "@/server/merchantOrderStore";
import {
  createMerchantIssuedReceipt,
  getMerchantIssuedReceiptByMerchantReceiptNumber,
  publicMerchantReceipt,
} from "@/server/receiptStore";

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

function moonPayDirectMerchantId(proof: { merchantId: string | null; merchantName: string | null }) {
  return (
    proof.merchantId ||
    process.env.MOONPAY_COMMERCE_MERCHANT_ID ||
    process.env.JIAGON_MOONPAY_MERCHANT_ID ||
    "moonpay-commerce"
  ).trim();
}

function moonPayDirectMerchantName(proof: { merchantName: string | null }) {
  return (
    proof.merchantName ||
    process.env.MOONPAY_COMMERCE_MERCHANT_NAME ||
    process.env.JIAGON_MOONPAY_MERCHANT_NAME ||
    "MoonPay Commerce"
  ).trim();
}

function moonPayOrderAttachStatus(error: string | undefined) {
  if (!error) return 409;
  if (
    error.includes("persistence failed") ||
    error.includes("attachment failed") ||
    error.includes("query failed")
  ) {
    return 503;
  }
  return 409;
}

export async function POST(request: Request) {
  const sharedToken = moonPayWebhookSharedToken();
  if (!sharedToken) {
    return Response.json(
      { error: "MOONPAY_COMMERCE_WEBHOOK_SHARED_TOKEN is required." },
      { status: 503 },
    );
  }

  const rawBody = await request.text();
  if (rawBody.length > 250_000) {
    return Response.json({ error: "Webhook payload is too large." }, { status: 413 });
  }

  const authorization = request.headers.get("authorization") || "";
  if (authorization !== `Bearer ${sharedToken}`) {
    return Response.json({ error: "Invalid MoonPay Commerce bearer token." }, { status: 401 });
  }

  const signature = request.headers.get("x-signature") || "";
  if (!verifyMoonPayWebhookSignature({ rawBody, signature, sharedToken })) {
    return Response.json({ error: "Invalid MoonPay Commerce webhook signature." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return Response.json({ error: "Invalid JSON webhook payload." }, { status: 400 });
  }

  const proof = parseMoonPayCommercePaymentProof(payload);
  if (!proof) {
    return Response.json(
      {
        accepted: true,
        ignored: true,
        reason: "Webhook is authenticated, but it is not a successful MoonPay Commerce payment event.",
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

  const currencyError = moonPayPaymentCurrencyError(proof);
  if (currencyError) {
    return Response.json(
      {
        error: currencyError,
        paymentProof: proof,
      },
      { status: 422 },
    );
  }

  const amountCents = moonPayPaymentAmountCents(proof);
  if (amountCents <= 0) {
    return Response.json(
      {
        error: "MoonPay Commerce payment amount must be a parseable value greater than zero.",
        paymentProof: proof,
      },
      { status: 422 },
    );
  }

  if (proof.orderId) {
    const bindingError = proof.jiagonMerchantId
      ? null
      : moonPayPaylinkAllowlistError(proof, "order attachment");
    if (bindingError) {
      return Response.json(
        {
          error: bindingError,
          paymentProof: proof,
        },
        { status: bindingError.includes("requires") ? 503 : 422 },
      );
    }

    const result = await completeMerchantOrderWithReceipt({
      id: proof.orderId,
      origin,
      issuedBy: "MoonPay Commerce webhook",
      paymentProvider: "moonpay_commerce",
      paymentStatus: "moonpay_verified_paid",
      receiptPurpose: "moonpay_commerce_payment_receipt",
      receiptMemo: moonPayReceiptMemo(proof),
      expectedSubtotalCents: amountCents,
      expectedMerchantIds: [proof.jiagonMerchantId, proof.merchantId].filter((value): value is string => Boolean(value)),
    });

    if (result.order && result.updated) {
      return Response.json({
        accepted: true,
        product: "Jiagon MoonPay Commerce receipt adapter",
        paymentProof: proof,
        receiptPersistence: {
          configured: result.receiptConfigured,
          persisted: result.receiptPersisted,
        },
        claimToken: result.claimToken || null,
        claimUrl: result.order.receiptClaimUrl,
        receipt: result.receipt || null,
        order: publicMerchantOrder(result.order),
      });
    }

    if (result.order) {
      const error = result.error || "MoonPay Commerce payment could not attach a Jiagon receipt.";
      return Response.json(
        {
          error,
          paymentProof: proof,
          configured: result.configured,
          order: publicMerchantOrder(result.order),
        },
        { status: moonPayOrderAttachStatus(error) },
      );
    }

    if (result.error !== "Merchant order was not found.") {
      const error = result.error || "MoonPay Commerce payment could not look up the Jiagon order.";
      return Response.json(
        {
          error,
          paymentProof: proof,
          configured: result.configured,
        },
        { status: moonPayOrderAttachStatus(error) },
      );
    }

    return Response.json(
      {
        error: `MoonPay Commerce payment asserted Jiagon order ${proof.orderId}, but that order was not found.`,
        paymentProof: proof,
        configured: result.configured,
      },
      { status: 404 },
    );
  }

  const paylinkError = moonPayDirectPaylinkError(proof);
  if (paylinkError) {
    return Response.json(
      {
        error: paylinkError,
        paymentProof: proof,
      },
      { status: paylinkError.includes("require") ? 503 : 422 },
    );
  }

  const merchantId = moonPayDirectMerchantId(proof);
  const merchantName = moonPayDirectMerchantName(proof);
  const receiptNumber = moonPayDirectReceiptNumber(proof);
  if (!receiptNumber) {
    return Response.json(
      {
        error: "MoonPay Commerce payment proof must include a stable transaction or idempotency identifier.",
        paymentProof: proof,
      },
      { status: 422 },
    );
  }

  const existing = await getMerchantIssuedReceiptByMerchantReceiptNumber({ merchantId, receiptNumber });
  if (existing.error) {
    return Response.json({ error: existing.error, configured: existing.configured }, { status: 503 });
  }
  if (existing.receipt) {
    return Response.json({
      accepted: true,
      duplicate: true,
      product: "Jiagon MoonPay Commerce direct receipt adapter",
      paymentProof: proof,
      claimToken: null,
      claimUrl: existing.receipt.claimUrl,
      receipt: publicMerchantReceipt(existing.receipt),
    });
  }

  const receiptResult = await createMerchantIssuedReceipt({
    merchantId,
    merchantName,
    location: merchantName,
    receiptNumber,
    amountCents,
    currency: proof.currency || "USD",
    category: "MoonPay Commerce payment",
    purpose: "moonpay_commerce_payment_receipt",
    issuedBy: "MoonPay Commerce webhook",
    memo: moonPayReceiptMemo(proof),
    origin,
  });

  if (receiptResult.configured && !receiptResult.persisted) {
    return Response.json(
      {
        error: receiptResult.error || "MoonPay Commerce direct receipt persistence failed.",
        paymentProof: proof,
        receipt: publicMerchantReceipt(receiptResult.receipt),
      },
      { status: 503 },
    );
  }

  return Response.json({
    accepted: true,
    duplicate: receiptResult.duplicate || undefined,
    product: "Jiagon MoonPay Commerce direct receipt adapter",
    paymentProof: proof,
    receiptPersistence: {
      configured: receiptResult.configured,
      persisted: receiptResult.persisted,
    },
    claimToken: receiptResult.duplicate ? null : receiptResult.claimToken,
    claimUrl: receiptResult.receipt.claimUrl,
    receipt: publicMerchantReceipt(receiptResult.receipt),
  });
}

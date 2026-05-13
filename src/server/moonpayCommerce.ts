import { createHmac, timingSafeEqual } from "node:crypto";

type UnknownRecord = Record<string, unknown>;

export type MoonPayCommercePaymentProof = {
  event: string;
  orderId: string | null;
  jiagonMerchantId: string | null;
  merchantId: string | null;
  merchantName: string | null;
  transactionId: string;
  paylinkId: string | null;
  depositId: string | null;
  transactionSignature: string | null;
  transactionStatus: string | null;
  senderWallet: string | null;
  recipientWallet: string | null;
  amount: string | null;
  currency: string | null;
  amountSource: "fiat_usd" | "payment_currency";
  rawIdempotencyKey: string | null;
};

export function moonPayWebhookSharedToken() {
  return (process.env.MOONPAY_COMMERCE_WEBHOOK_SHARED_TOKEN || "").trim();
}

function splitConfiguredIds(value: string | undefined) {
  return (value || "")
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizePaylinkId(value: string | null) {
  return (value || "").trim().toLowerCase();
}

export function moonPayDirectPaylinkAllowlist() {
  const configured = [
    ...splitConfiguredIds(process.env.MOONPAY_DIRECT_PAYLINK_ID),
    ...splitConfiguredIds(process.env.MOONPAY_DIRECT_PAYLINK_IDS),
    ...splitConfiguredIds(process.env.MOONPAY_COMMERCE_PAYLINK_ID),
    ...splitConfiguredIds(process.env.MOONPAY_COMMERCE_PAYLINK_IDS),
    ...splitConfiguredIds(process.env.NEXT_PUBLIC_MOONPAY_DIRECT_PAYLINK_ID),
    ...splitConfiguredIds(process.env.NEXT_PUBLIC_MOONPAY_COMMERCE_PAYLINK_ID),
  ];

  return Array.from(new Set(configured.map(normalizePaylinkId).filter(Boolean)));
}

export function verifyMoonPayWebhookSignature(input: {
  rawBody: string;
  signature: string;
  sharedToken: string;
}) {
  if (!input.rawBody || !input.signature || !input.sharedToken) return false;
  if (!/^[a-f0-9]+$/i.test(input.signature) || input.signature.length % 2 !== 0) return false;

  const computedSignature = createHmac("sha256", input.sharedToken)
    .update(input.rawBody)
    .digest("hex");
  const received = Buffer.from(input.signature, "hex");
  const computed = Buffer.from(computedSignature, "hex");
  if (received.length !== computed.length) return false;

  return timingSafeEqual(received, computed);
}

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function printableValue(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function centsFromAmount(value: string | null) {
  const normalized = (value || "").trim().replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return 0;
  return Math.round(Number(normalized) * 100);
}

function parseJsonObject(value: unknown): UnknownRecord | null {
  if (!value) return null;
  if (record(value)) return value as UnknownRecord;
  if (typeof value !== "string") return null;
  try {
    return record(JSON.parse(value));
  } catch {
    return null;
  }
}

function findOrderId(...values: unknown[]) {
  for (const value of values) {
    const candidate = stringValue(value);
    if (candidate && /^ord-[a-f0-9]{16}$/i.test(candidate)) return candidate.toLowerCase();
  }
  return null;
}

function currencySymbol(value: unknown) {
  const currency = record(value);
  return stringValue(value) || stringValue(currency?.symbol) || stringValue(currency?.name) || null;
}

function uppercaseCode(value: unknown) {
  return stringValue(value)?.toUpperCase() || null;
}

function isUsdCode(value: unknown) {
  return uppercaseCode(value) === "USD";
}

function usdAmountField(...values: unknown[]) {
  for (const value of values) {
    const candidate = printableValue(value);
    if (candidate) return candidate;
  }
  return null;
}

function fiatUsdAmount(root: UnknownRecord, meta: UnknownRecord | null, transactionObject: UnknownRecord | null) {
  const explicitUsdAmount = usdAmountField(
    root.amountUsd,
    root.usdAmount,
    root.fiatAmountUsd,
    root.fiatUsdAmount,
    meta?.amountUsd,
    meta?.usdAmount,
    meta?.fiatAmountUsd,
    meta?.fiatUsdAmount,
    transactionObject?.amountUsd,
    transactionObject?.usdAmount,
  );
  if (explicitUsdAmount) return explicitUsdAmount;

  if (isUsdCode(root.fiatCurrency) || isUsdCode(root.currencyCode) || isUsdCode(root.currency)) {
    return usdAmountField(root.fiatAmount, root.amount);
  }
  if (isUsdCode(meta?.fiatCurrency) || isUsdCode(meta?.currencyCode) || isUsdCode(meta?.currency)) {
    return usdAmountField(meta?.fiatAmount, meta?.totalAmount, meta?.amount);
  }
  if (
    isUsdCode(transactionObject?.fiatCurrency) ||
    isUsdCode(transactionObject?.currencyCode) ||
    isUsdCode(transactionObject?.currency)
  ) {
    return usdAmountField(transactionObject?.fiatAmount, transactionObject?.amount);
  }

  return null;
}

export function parseMoonPayCommercePaymentProof(payload: unknown): MoonPayCommercePaymentProof | null {
  const root = record(payload);
  if (!root) return null;

  const transactionObject = record(root.transactionObject) || parseJsonObject(root.transaction);
  const meta = record(transactionObject?.meta);
  const customerDetails = record(meta?.customerDetails);
  const productDetails = record(meta?.productDetails);
  const additionalJson = parseJsonObject(customerDetails?.additionalJSON) ||
    parseJsonObject(productDetails?.additionalJSON) ||
    parseJsonObject(root.additionalJSON) ||
    parseJsonObject(root.metadata);

  const orderId = findOrderId(
    root.orderId,
    root.merchantOrderId,
    transactionObject?.orderId,
    meta?.orderId,
    customerDetails?.orderId,
    productDetails?.orderId,
    additionalJson?.orderId,
    additionalJson?.merchantOrderId,
  );

  const event = stringValue(root.event) || "UNKNOWN";
  const transactionStatus = stringValue(meta?.transactionStatus) || stringValue(root.transactionStatus);
  const isSuccess = transactionStatus === "SUCCESS" ||
    event === "DEPOSIT_TX_CONFIRMED" ||
    event === "DEPOSIT_TX_ENRICHED";
  if (!isSuccess) return null;

  const merchant = record(root.merchant) || record(meta?.merchant) || record(productDetails?.merchant);
  const usdFiatAmount = fiatUsdAmount(root, meta, transactionObject);
  const paylinkId = stringValue(transactionObject?.paylinkId) ||
    stringValue(transactionObject?.paymentLinkId) ||
    stringValue(meta?.paylinkId) ||
    stringValue(meta?.paymentLinkId) ||
    stringValue(productDetails?.paylinkId) ||
    stringValue(productDetails?.paymentLinkId) ||
    stringValue(additionalJson?.paylinkId) ||
    stringValue(additionalJson?.paymentLinkId) ||
    stringValue(root.paylinkId) ||
    stringValue(root.paymentLinkId);

  return {
    event,
    orderId,
    jiagonMerchantId: stringValue(additionalJson?.jiagonMerchantId) ||
      stringValue(additionalJson?.jiagon_merchant_id) ||
      null,
    merchantId: stringValue(root.merchantId) ||
      stringValue(meta?.merchantId) ||
      stringValue(productDetails?.merchantId) ||
      stringValue(additionalJson?.merchantId) ||
      stringValue(merchant?.id),
    merchantName: stringValue(root.merchantName) ||
      stringValue(meta?.merchantName) ||
      stringValue(productDetails?.merchantName) ||
      stringValue(additionalJson?.merchantName) ||
      stringValue(merchant?.name),
    transactionId: stringValue(transactionObject?.id) || stringValue(root.transactionId) || stringValue(root.txIdempotencyKey) || "unknown",
    paylinkId,
    depositId: stringValue(root.depositId),
    transactionSignature: stringValue(meta?.transactionSignature) || stringValue(root.transactionSignature),
    transactionStatus,
    senderWallet: stringValue(meta?.senderPK),
    recipientWallet: stringValue(meta?.recipientPK),
    amount: usdFiatAmount || printableValue(root.amount) || printableValue(meta?.totalAmount) || printableValue(meta?.amount),
    currency: usdFiatAmount ? "USD" : currencySymbol(root.currency) || currencySymbol(meta?.currency),
    amountSource: usdFiatAmount ? "fiat_usd" : "payment_currency",
    rawIdempotencyKey: stringValue(root.txIdempotencyKey),
  };
}

export function moonPayReceiptMemo(proof: MoonPayCommercePaymentProof) {
  const parts = [
    proof.orderId
      ? `MoonPay Commerce verified payment for order ${proof.orderId}.`
      : "MoonPay Commerce verified direct payment.",
    proof.transactionId !== "unknown" ? `Transaction: ${proof.transactionId}.` : null,
    proof.transactionSignature ? `Signature: ${proof.transactionSignature}.` : null,
    proof.senderWallet ? `Payer wallet: ${proof.senderWallet}.` : null,
    proof.amount && proof.currency ? `Amount: ${proof.amount} ${proof.currency}.` : null,
  ].filter((part): part is string => Boolean(part));

  return parts.join(" ").slice(0, 500);
}

export function moonPayPaymentAmountCents(proof: MoonPayCommercePaymentProof) {
  return centsFromAmount(proof.amount);
}

export function moonPayDirectReceiptNumber(proof: MoonPayCommercePaymentProof) {
  const stableId = (proof.transactionId !== "unknown" ? proof.transactionId : null) ||
    proof.depositId ||
    proof.transactionSignature ||
    proof.rawIdempotencyKey;
  return stableId ? `moonpay:${stableId}` : null;
}

export function moonPayPaymentCurrencyError(proof: MoonPayCommercePaymentProof) {
  if (proof.amountSource === "fiat_usd") return null;

  const normalized = (proof.currency || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (normalized === "USD" || normalized === "USDC" || normalized === "USDCOIN") return null;

  return "MoonPay Commerce receipts require a USD/USDC payment currency or a clear fiat USD amount field.";
}

export function moonPayDirectPaylinkError(proof: MoonPayCommercePaymentProof) {
  return moonPayPaylinkAllowlistError(proof, "direct receipt");
}

export function moonPayPaylinkAllowlistError(proof: MoonPayCommercePaymentProof, context = "payment") {
  const allowedPaylinks = moonPayDirectPaylinkAllowlist();
  if (allowedPaylinks.length === 0) {
    return `MoonPay Commerce ${context} requires MOONPAY_DIRECT_PAYLINK_ID or MOONPAY_COMMERCE_PAYLINK_ID.`;
  }

  const paylinkId = normalizePaylinkId(proof.paylinkId);
  if (!paylinkId) {
    return `MoonPay Commerce ${context} proof must include paylinkId or paymentLinkId.`;
  }
  if (!allowedPaylinks.includes(paylinkId)) {
    return `MoonPay Commerce ${context} paylink is not approved.`;
  }

  return null;
}

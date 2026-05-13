import { createHmac, timingSafeEqual } from "node:crypto";

type UnknownRecord = Record<string, unknown>;

export type ShopifyProductVariant = {
  productId: string;
  productTitle: string;
  productHandle: string;
  variantId: string;
  variantTitle: string;
  availableForSale: boolean;
  amount: string;
  currencyCode: string;
};

export type ShopifyCartResult = {
  cartId: string;
  checkoutUrl: string;
  userErrors: string[];
};

export type ShopifyPaidOrderProof = {
  shopDomain: string;
  topic: string;
  orderId: string;
  orderName: string;
  adminGraphqlApiId: string | null;
  financialStatus: string;
  totalPrice: string;
  currency: string;
  paymentGatewayNames: string[];
  lineItems: Array<{
    id: string;
    name: string;
    quantity: number;
    price: string;
  }>;
  jiagonOrderId: string | null;
  jiagonMerchantId: string | null;
};

export function shopifyConfig() {
  const shopDomain = (process.env.SHOPIFY_SHOP_DOMAIN || "").trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  const storefrontAccessToken = (process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN || "").trim();
  const webhookSecret = (process.env.SHOPIFY_WEBHOOK_SECRET || process.env.SHOPIFY_API_SECRET || "").trim();

  return {
    configured: Boolean(shopDomain && storefrontAccessToken),
    webhookConfigured: Boolean(webhookSecret),
    shopDomain,
    storefrontAccessToken,
    webhookSecret,
  };
}

export function shopifyMerchantId(shopDomain: string) {
  const slug = shopDomain
    .toLowerCase()
    .replace(/\.myshopify\.com$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `shopify-${slug || "store"}`;
}

export function verifyShopifyWebhookSignature(input: {
  rawBody: string;
  signature: string;
  secret: string;
}) {
  if (!input.rawBody || !input.signature || !input.secret) return false;
  let received: Buffer;
  try {
    received = Buffer.from(input.signature, "base64");
  } catch {
    return false;
  }
  const computed = createHmac("sha256", input.secret).update(input.rawBody).digest();
  if (received.length !== computed.length) return false;
  return timingSafeEqual(received, computed);
}

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function stringValue(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function centsFromAmount(value: string) {
  const normalized = value.trim().replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return 0;
  return Math.round(Number(normalized) * 100);
}

async function shopifyStorefront<T>(query: string, variables: UnknownRecord = {}) {
  const config = shopifyConfig();
  if (!config.configured) throw new Error("SHOPIFY_SHOP_DOMAIN and SHOPIFY_STOREFRONT_ACCESS_TOKEN are required.");

  const response = await fetch(`https://${config.shopDomain}/api/2026-01/graphql.json`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shopify-storefront-access-token": config.storefrontAccessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await response.json() as { data?: T; errors?: Array<{ message?: string }> };
  if (!response.ok || json.errors?.length) {
    throw new Error(json.errors?.map((error) => error.message).filter(Boolean).join("; ") || "Shopify Storefront API request failed.");
  }
  if (!json.data) throw new Error("Shopify Storefront API response had no data.");
  return json.data;
}

export async function searchShopifyProducts(query: string, limit = 5): Promise<ShopifyProductVariant[]> {
  const data = await shopifyStorefront<{
    products: {
      edges: Array<{
        node: {
          id: string;
          title: string;
          handle: string;
          variants: {
            edges: Array<{
              node: {
                id: string;
                title: string;
                availableForSale: boolean;
                price: {
                  amount: string;
                  currencyCode: string;
                };
              };
            }>;
          };
        };
      }>;
    };
  }>(
    `
      query JiagonAgentProducts($query: String!, $first: Int!) {
        products(first: $first, query: $query) {
          edges {
            node {
              id
              title
              handle
              variants(first: 10) {
                edges {
                  node {
                    id
                    title
                    availableForSale
                    price {
                      amount
                      currencyCode
                    }
                  }
                }
              }
            }
          }
        }
      }
    `,
    { query, first: Math.min(Math.max(limit, 1), 10) },
  );

  return data.products.edges.flatMap((edge) => edge.node.variants.edges.map((variantEdge) => ({
    productId: edge.node.id,
    productTitle: edge.node.title,
    productHandle: edge.node.handle,
    variantId: variantEdge.node.id,
    variantTitle: variantEdge.node.title,
    availableForSale: variantEdge.node.availableForSale,
    amount: variantEdge.node.price.amount,
    currencyCode: variantEdge.node.price.currencyCode,
  })));
}

export async function createShopifyCart(input: {
  variantId: string;
  quantity: number;
  jiagonOrderId: string;
  merchantId: string;
  agentId: string;
}): Promise<ShopifyCartResult> {
  const data = await shopifyStorefront<{
    cartCreate: {
      cart: { id: string; checkoutUrl: string } | null;
      userErrors: Array<{ field?: string[]; message: string }>;
    };
  }>(
    `
      mutation JiagonAgentCartCreate($input: CartInput!) {
        cartCreate(input: $input) {
          cart {
            id
            checkoutUrl
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      input: {
        lines: [{ merchandiseId: input.variantId, quantity: Math.max(1, Math.min(20, input.quantity)) }],
        attributes: [
          { key: "jiagon_order_id", value: input.jiagonOrderId },
          { key: "jiagon_merchant_id", value: input.merchantId },
          { key: "jiagon_agent_id", value: input.agentId },
          { key: "jiagon_receipt_layer", value: "verified_commerce_memory" },
        ],
      },
    },
  );

  return {
    cartId: data.cartCreate.cart?.id || "",
    checkoutUrl: data.cartCreate.cart?.checkoutUrl || "",
    userErrors: data.cartCreate.userErrors.map((error) => error.message),
  };
}

function noteAttributes(payload: UnknownRecord) {
  const attributes = Array.isArray(payload.note_attributes) ? payload.note_attributes : [];
  return attributes
    .map((item) => record(item))
    .filter((item): item is UnknownRecord => Boolean(item));
}

function noteAttributeValue(payload: UnknownRecord, key: string) {
  const match = noteAttributes(payload).find((item) => stringValue(item.name || item.key) === key);
  return match ? stringValue(match.value) : "";
}

export function parseShopifyPaidOrderProof(input: {
  payload: unknown;
  shopDomain: string;
  topic: string;
}): ShopifyPaidOrderProof | null {
  const root = record(input.payload);
  if (!root) return null;
  const financialStatus = stringValue(root.financial_status).toLowerCase();
  if (financialStatus !== "paid") return null;

  const orderId = stringValue(root.id);
  if (!orderId) return null;
  const lineItems = (Array.isArray(root.line_items) ? root.line_items : [])
    .map((item) => record(item))
    .filter((item): item is UnknownRecord => Boolean(item))
    .slice(0, 25)
    .map((item) => ({
      id: stringValue(item.id || item.variant_id || item.product_id || item.sku || item.title),
      name: stringValue(item.name || item.title) || "Shopify line item",
      quantity: Math.max(1, Math.trunc(numberValue(item.quantity) || 1)),
      price: stringValue(item.price || item.pre_tax_price || item.total_discount) || "0.00",
    }));

  const paymentGatewayNames = (Array.isArray(root.payment_gateway_names) ? root.payment_gateway_names : [])
    .map((gateway) => stringValue(gateway))
    .filter(Boolean);

  const jiagonOrderId = noteAttributeValue(root, "jiagon_order_id") ||
    stringValue(root.cart_token).match(/^ord-[a-f0-9]{16}$/i)?.[0] ||
    null;
  const jiagonMerchantId = noteAttributeValue(root, "jiagon_merchant_id") || null;

  return {
    shopDomain: input.shopDomain,
    topic: input.topic,
    orderId,
    orderName: stringValue(root.name) || `#${orderId}`,
    adminGraphqlApiId: stringValue(root.admin_graphql_api_id) || null,
    financialStatus,
    totalPrice: stringValue(root.current_total_price || root.total_price) || "0.00",
    currency: stringValue(root.currency || root.presentment_currency) || "USD",
    paymentGatewayNames,
    lineItems,
    jiagonOrderId,
    jiagonMerchantId,
  };
}

export function shopifyReceiptMemo(proof: ShopifyPaidOrderProof) {
  const gateway = proof.paymentGatewayNames.length > 0 ? proof.paymentGatewayNames.join(", ") : "unknown gateway";
  const items = proof.lineItems.map((item) => `${item.quantity}x ${item.name}`).join(", ");
  return `Shopify order ${proof.orderName} paid on ${proof.shopDomain} via ${gateway}. Items: ${items || "n/a"}.`.slice(0, 500);
}

export function shopifyLineItemCategory(proof: ShopifyPaidOrderProof) {
  return proof.lineItems[0]?.name || "Shopify order";
}

export function shopifyPaidOrderAmountCents(proof: ShopifyPaidOrderProof) {
  return centsFromAmount(proof.totalPrice);
}

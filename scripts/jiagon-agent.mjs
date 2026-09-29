#!/usr/bin/env node

const intent = process.argv.slice(2).join(" ").trim();

if (!intent) {
  console.error('Usage: pnpm agent "Get me an iced latte from Raposa under 10 dollars, ready in 15 minutes"');
  process.exit(1);
}

const origin = process.env.JIAGON_AGENT_ORIGIN || "https://jiagon.vercel.app";

function inferPaymentMode(text) {
  const normalized = text.toLowerCase();
  if (normalized.includes("counter") || normalized.includes("cash") || normalized.includes("現場")) {
    return "pay_at_counter";
  }
  if (normalized.includes("solana") || normalized.includes("crypto") || normalized.includes("wallet")) {
    return "crypto_pay";
  }
  return "pay_at_counter";
}

function inferMaxSpendUsd(text) {
  const under = text.match(/(?:under|below|less than|以內|低於|不要超過)\s*\$?\s*(\d+(?:\.\d{1,2})?)/i);
  if (under) return Number.parseFloat(under[1]).toFixed(2);

  const usd = text.match(/\$?\s*(\d+(?:\.\d{1,2})?)\s*(?:usd|usdc|dollars?|美金)/i);
  if (usd) return Number.parseFloat(usd[1]).toFixed(2);

  return "10.00";
}

function inferMerchantId(text) {
  const normalized = text.toLowerCase();
  if (
    normalized.includes("theme park") ||
    normalized.includes("tomorrowland") ||
    normalized.includes("venue pickup") ||
    normalized.includes("park cafe") ||
    normalized.includes("starport") ||
    normalized.includes("pretzel")
  ) {
    return "theme-park-cafe";
  }
  if (normalized.includes("solyd") || normalized.includes("case") || normalized.includes("iphone")) return "solyd-cases";
  const mentionsRaposa = normalized.includes("raposa");
  if (
    normalized.includes("raposa shop") ||
    normalized.includes("raposa online") ||
    (mentionsRaposa && normalized.includes("online shop")) ||
    (mentionsRaposa && normalized.includes("ecommerce")) ||
    (mentionsRaposa && normalized.includes("shipping")) ||
    (mentionsRaposa && normalized.includes("ship ")) ||
    (mentionsRaposa &&
      (normalized.includes("beans") ||
        normalized.includes("bean") ||
        normalized.includes("whole bean") ||
        normalized.includes("matcha") ||
        normalized.includes("rogueai") ||
        normalized.includes("caramel latte") ||
        normalized.includes("cafe latte") ||
        normalized.includes("café latte") ||
        normalized.includes("extra kick") ||
        normalized.includes("dark roast") ||
        normalized.includes("iced tea") ||
        normalized.includes("hibiscus") ||
        normalized.includes("tonic") ||
        normalized.includes("flat white") ||
        normalized.includes("starter pack") ||
        normalized.includes("sunrise") ||
        normalized.includes("ethiopia") ||
        normalized.includes("yirgacheffe") ||
        normalized.includes("nitro") ||
        normalized.includes("cold brew")))
  ) {
    return "raposa-shop";
  }
  return "raposa-coffee";
}

function inferDeadlineMinutes(text) {
  const minuteMatch = text.match(/(?:within|in|under|ready in)\s+(\d{1,3})\s*(?:min|mins|minutes)/i);
  if (minuteMatch) return Number(minuteMatch[1]);
  if (text.toLowerCase().includes("15 minutes")) return 15;
  return undefined;
}

function inferDeliverByDays(text) {
  const normalized = text.toLowerCase();
  if (normalized.includes("this week") || normalized.includes("within a week")) return 7;
  const dayMatch = text.match(/(?:within|in|under|ship in)\s+(\d{1,2})\s*(?:day|days)/i);
  if (dayMatch) return Number(dayMatch[1]);
  return undefined;
}

async function postJson(path, body) {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed: ${response.status}`);
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function main() {
  const merchantId = inferMerchantId(intent);
  const body = {
    agentId: process.env.JIAGON_AGENT_ID || "jhinresh-cli-agent",
    userIntent: intent,
    maxSpendUsd: inferMaxSpendUsd(intent),
    paymentMode: inferPaymentMode(intent),
    customerLabel: process.env.JIAGON_AGENT_CUSTOMER || "Jerry",
    ...(inferDeadlineMinutes(intent) ? { deadlineMinutes: inferDeadlineMinutes(intent) } : {}),
    ...(inferDeliverByDays(intent) ? { deliverByDays: inferDeliverByDays(intent) } : {}),
  };

  const quote = await postJson(`/api/agent/merchants/${merchantId}/quote`, body);
  console.log("Jiagon Negotiator");
  console.log("");
  console.log(`Intent: ${intent}`);
  console.log(`Merchant: ${quote?.merchant?.name || merchantId}`);
  console.log(`Decision: ${quote?.quote?.decision || "unknown"}`);
  console.log(`Item: ${quote?.quote?.item?.quantity || 1}x ${quote?.quote?.item?.name || "unknown"}`);
  console.log(`Total: $${quote?.quote?.item?.subtotalUsd || "0.00"}`);
  console.log(`ETA: ${
    quote?.quote?.estimate?.readyInMinutes !== null && quote?.quote?.estimate?.readyInMinutes !== undefined
      ? `${quote.quote.estimate.readyInMinutes} minutes`
      : quote?.quote?.estimate?.shippingDays
        ? `${quote.quote.estimate.shippingDays} days`
        : "pending"
  }`);
  console.log("");

  if (!quote?.quote?.feasible) {
    console.log("Negotiation needed");
    for (const reason of quote?.quote?.reasons || []) console.log(`- ${reason}`);
    for (const alternative of quote?.quote?.alternatives || []) {
      console.log(`- Alternative: ${alternative.name} ($${alternative.amountUsd}) — ${alternative.reason}`);
    }
    process.exit(2);
  }

  const order = await postJson(`/api/agent/merchants/${merchantId}/orders`, body);
  const pickupCode = order?.order?.pickupCode || "";
  const nfcStation = order?.urls?.nfcStation || "";
  const pairPhoneForNfcClaim = order?.urls?.pairPhoneForNfcClaim || "";

  console.log("Order handoff created");
  console.log(`Status: ${order.status || "unknown"}`);
  if (order.shipping) {
    console.log(`Shipping: ${order.shipping.estimatedDays || "n/a"} days`);
  } else {
    console.log(`Pickup code: ${pickupCode || "n/a"}`);
  }
  console.log(`Payment: ${order?.payment?.status || "merchant handoff"}`);
  console.log("");
  console.log(order.shipping ? "Required checkout fields" : "Required demo fields");
  if (order.shipping) {
    console.log(`order.id=${order?.order?.id || ""}`);
    console.log(`payment.status=${order?.payment?.status || ""}`);
  } else {
    console.log(`order.pickupCode=${pickupCode}`);
    console.log(`urls.nfcStation=${nfcStation}`);
    console.log(`urls.pairPhoneForNfcClaim=${pairPhoneForNfcClaim}`);
  }
  console.log("");
  console.log("Next");
  for (const instruction of order.customerInstructions || []) {
    console.log(`- ${instruction}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  if (error?.payload) console.error(JSON.stringify(error.payload, null, 2));
  process.exit(1);
});

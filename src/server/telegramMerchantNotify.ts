import type { MerchantOrder } from "@/server/merchantOrderStore";

const DEFAULT_TELEGRAM_API_TIMEOUT_MS = 5_000;
const TELEGRAM_STAFF_ORDER_CALLBACK_PATTERN = /^ord-[a-f0-9]{16}$/;

function telegramBotToken() {
  return (process.env.TELEGRAM_BOT_TOKEN || "").trim();
}

function merchantGroupChatId() {
  return (process.env.TELEGRAM_MERCHANT_GROUP_CHAT_ID || "").trim();
}

function telegramApiTimeoutMs() {
  const configured = Number.parseInt(process.env.TELEGRAM_API_TIMEOUT_MS || "", 10);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TELEGRAM_API_TIMEOUT_MS;
}

async function sendTelegramMethod(method: string, payload: Record<string, unknown>) {
  const token = telegramBotToken();
  if (!token) return { sent: false, skipped: true };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), telegramApiTimeoutMs());
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => null) as { ok?: boolean; description?: string } | null;
    return {
      sent: response.ok && result?.ok === true,
      skipped: false,
      error: response.ok && result?.ok === true ? undefined : result?.description || "Telegram API request failed.",
    };
  } catch {
    return { sent: false, skipped: false };
  } finally {
    clearTimeout(timeoutId);
  }
}

function telegramOrderLines(order: MerchantOrder) {
  return order.items.map((item) => `- ${item.quantity}x ${item.name}`).join("\n");
}

function staffOrderCallbackData(action: "paid_done" | "cancel", orderId: string) {
  if (!TELEGRAM_STAFF_ORDER_CALLBACK_PATTERN.test(orderId)) {
    throw new Error("Telegram staff callback order id does not match the parser contract.");
  }
  return `${action}:${orderId}`;
}

export function nfcStationUrl(origin: string, merchantId: string) {
  return `${origin}/tile/${encodeURIComponent(merchantId)}?station=raposa-counter`;
}

export async function notifyMerchantGroup(order: MerchantOrder) {
  const chatId = merchantGroupChatId();
  if (!chatId) return { sent: false, skipped: true };
  if (!telegramBotToken()) return { sent: false, skipped: true };

  const paymentNote = order.notes?.toLowerCase() || "";
  const paymentLine = paymentNote.includes("crypto pay")
    ? "Payment: Crypto Pay on Solana returned to agent; verify payment or collect at counter if unpaid"
    : paymentNote.includes("helio pay")
    ? "Payment: Helio Solana checkout returned to agent; verify payment or collect at counter if unpaid"
    : paymentNote.includes("solana pay")
      ? "Payment: Solana Pay request returned to agent; verify payment or collect at counter if unpaid"
      : "Payment: collect at counter POS / cash / card";
  const text = [
    `Agent queued ${order.merchantName} Order Pass #${order.pickupCode}`,
    "",
    `Customer: ${order.customerLabel || "Agent customer"}`,
    `Source: ${order.source}`,
    "Parsed order:",
    telegramOrderLines(order),
    `Estimated total: $${order.subtotalUsd}`,
    order.notes ? `Notes: ${order.notes}` : "",
    "",
    `Order Pass: ${order.pickupCode}`,
    paymentLine,
    "Next action: confirm payment, make the order, then tap Paid + Done.",
  ]
    .filter(Boolean)
    .join("\n");

  return sendTelegramMethod("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Paid + Done", callback_data: staffOrderCallbackData("paid_done", order.id) },
          { text: "Cancel", callback_data: staffOrderCallbackData("cancel", order.id) },
        ],
      ],
    },
  });
}

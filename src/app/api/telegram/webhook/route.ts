import { createHash, timingSafeEqual } from "node:crypto";
import { knownMerchantProfileForId, type MenuItem, type MerchantProfile } from "@/lib/merchantCatalog";
import {
  completeMerchantOrderWithReceipt,
  createMerchantOrder,
  publicMerchantOrder,
  recordMerchantPilotEvent,
  updateMerchantOrderStatus,
  type MerchantOrderItem,
} from "@/server/merchantOrderStore";
import { nfcStationUrl, notifyMerchantGroup } from "@/server/telegramMerchantNotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TelegramUser = {
  id?: number;
  username?: string;
  first_name?: string;
  last_name?: string;
};

type TelegramMessage = {
  message_id?: number;
  text?: string;
  chat?: {
    id?: number | string;
  };
  from?: TelegramUser;
};

type TelegramCallbackQuery = {
  id?: string;
  data?: string;
  message?: TelegramMessage;
  from?: TelegramUser;
};

type TelegramWebhookPayload = {
  update_id?: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

type ParsedCommand =
  | { kind: "help"; merchantId?: string }
  | { kind: "menu"; merchantId: string }
  | { kind: "draft_order"; merchantId: string; itemId: string; quantity: number; notes: string; noteCode?: string }
  | { kind: "clarify"; merchantId: string; text: string };

type ParsedCallbackData =
  | { action: "paid_done" | "cancel"; orderId: string }
  | { action: "order_item" | "draft_order"; merchantId: string; itemId: string; quantity: number; noteCode?: string }
  | { action: "confirm_order"; merchantId: string; itemId: string; quantity: number; noteCode?: string }
  | { action: "change_order"; merchantId: string };

type TelegramWebhookGlobal = typeof globalThis & {
  jiagonTelegramNoteMemory?: Map<string, string>;
};

const DEFAULT_MERCHANT_ID = "raposa-coffee";
const MAX_TELEGRAM_BODY_BYTES = 20_000;
const DEFAULT_TELEGRAM_API_TIMEOUT_MS = 5_000;
const TELEGRAM_CALLBACK_TOKEN_MAX = 32;
const TELEGRAM_CALLBACK_TOKEN_PATTERN = /^[a-z0-9-]{1,32}$/;
// Custom note callbacks store a bounded in-process hint, then fall back to parsing
// the Telegram draft message. Persist notes before confirm if this becomes critical.
const MAX_NOTE_MEMORY_SIZE = 250;

let warnedMissingProductionOrigin = false;

function cleanToken(value: string | undefined, fallback = "") {
  return (value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function cleanNotes(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 240);
}

function cleanNoteCode(value: string | undefined) {
  return cleanToken(value, "").slice(0, 24);
}

function quantityFrom(value: string | undefined) {
  const parsed = Number.parseInt(value || "1", 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(Math.max(parsed, 1), 20);
}

function quantityFromNaturalText(text: string) {
  const normalized = text.toLowerCase();
  const blockedNumericContext = /\b(table|seat|room|order|for|at)\s+([1-9]|1\d|20)\b/.exec(normalized);
  const markedNumericMatch = /\b([1-9]|1\d|20)\s*(x|pcs?|pieces?|cups?|杯|份)\b|\b(x|qty|quantity)\s*([1-9]|1\d|20)\b/.exec(normalized);
  if (markedNumericMatch && !blockedNumericContext) return quantityFrom(markedNumericMatch[1] || markedNumericMatch[4]);
  const leadingNumericMatch = /^\s*([1-9]|1\d|20)\b/.exec(normalized);
  if (leadingNumericMatch) return quantityFrom(leadingNumericMatch[1]);

  const quantityWords: Record<string, number> = {
    a: 1,
    an: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    一: 1,
    壹: 1,
    兩: 2,
    二: 2,
    貳: 2,
    三: 3,
    參: 3,
  };
  for (const [word, quantity] of Object.entries(quantityWords)) {
    if (/[\u4e00-\u9fff]/.test(word)) {
      if (normalized.includes(word)) return quantity;
      continue;
    }
    if (new RegExp(`\\b${word}\\b`).test(normalized)) return quantity;
  }
  return 1;
}

function dollarsToCents(amountUsd: string) {
  const normalized = amountUsd.trim().replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return 0;
  return Math.round(Number(normalized) * 100);
}

function messageDigest(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function telegramOrderIdempotencyKey(payload: TelegramWebhookPayload, message: TelegramMessage, merchantId: string) {
  if (typeof payload.update_id === "number") {
    return `telegram:${merchantId}:update:${payload.update_id}`;
  }

  const chatId = message.chat?.id ?? "unknown-chat";
  const fromId = message.from?.id ?? "unknown-from";
  const messageId = message.message_id ?? "unknown-message";
  return `telegram:${merchantId}:message:${chatId}:${fromId}:${messageId}:${messageDigest(message.text || "")}`;
}

function telegramCallbackOrderIdempotencyKey(callback: TelegramCallbackQuery, merchantId: string, itemId: string) {
  const chatId = callback.message?.chat?.id ?? "unknown-chat";
  const fromId = callback.from?.id ?? "unknown-from";
  return `telegram:${merchantId}:callback:${chatId}:${fromId}:${callback.id || "unknown-callback"}:${itemId}`;
}

function telegramConfirmOrderIdempotencyKey(
  callback: TelegramCallbackQuery,
  merchantId: string,
  itemId: string,
  quantity: number,
  noteCode = "",
) {
  const chatId = callback.message?.chat?.id ?? "unknown-chat";
  const fromId = callback.from?.id ?? "unknown-from";
  const messageId = callback.message?.message_id ?? "unknown-message";
  return `telegram:${merchantId}:confirm:${chatId}:${fromId}:${messageId}:${itemId}:${quantity}:${cleanNoteCode(noteCode) || "none"}`;
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function validateTelegramSecret(request: Request) {
  const expected = (process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
  if (!expected && process.env.NODE_ENV === "production") {
    return "TELEGRAM_WEBHOOK_SECRET is required before enabling the Telegram webhook in production.";
  }
  if (!expected) return null;

  const submitted = request.headers.get("x-telegram-bot-api-secret-token") || "";
  return safeEqual(submitted, expected) ? null : "Invalid Telegram webhook secret.";
}

function noteCodeForText(text: string) {
  const normalized = normalizedNaturalText(text);
  if (normalized.includes(" less ice ") || normalized.includes(" 少冰 ")) return "less-ice";
  if (normalized.includes(" no ice ") || normalized.includes(" 去冰 ")) return "no-ice";
  if (normalized.includes(" oat ") || normalized.includes(" 燕麥 ")) return "oat-milk";
  if (normalized.includes(" extra hot ") || normalized.includes(" 熱一點 ")) return "extra-hot";
  const cleaned = cleanNotes(text);
  if (cleaned) {
    const noteCode = `note-${createHash("sha256").update(cleaned).digest("hex").slice(0, 12)}`;
    const globalStore = globalThis as TelegramWebhookGlobal;
    const memory = globalStore.jiagonTelegramNoteMemory || new Map<string, string>();
    globalStore.jiagonTelegramNoteMemory = memory;
    memory.set(noteCode, cleaned);
    while (memory.size > MAX_NOTE_MEMORY_SIZE) {
      const oldestKey = memory.keys().next().value;
      if (!oldestKey) break;
      memory.delete(oldestKey);
    }
    return noteCode;
  }
  return "";
}

function noteTextFromCode(noteCode: string | undefined) {
  const cleanedCode = cleanNoteCode(noteCode);
  switch (cleanedCode) {
    case "less-ice":
      return "less ice";
    case "no-ice":
      return "no ice";
    case "oat-milk":
      return "oat milk";
    case "extra-hot":
      return "extra hot";
    default:
      return ((globalThis as TelegramWebhookGlobal).jiagonTelegramNoteMemory || new Map()).get(cleanedCode) || "";
  }
}

function noteTextFromDraftMessage(text: string | undefined) {
  if (!text) return "";
  const match = /^Notes:\s*(.+)$/im.exec(text);
  return match ? cleanNotes(match[1]) : "";
}

function normalizedNaturalText(value: string) {
  return ` ${value.toLowerCase().replace(/[_-]/g, " ").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim()} `;
}

function isAmbiguousCoffeeRequest(text: string) {
  const normalized = normalizedNaturalText(text);
  const asksCoffee = normalized.includes(" coffee ") || normalized.includes(" 咖啡 ");
  const picksSpecificDrink =
    normalized.includes(" espresso ") ||
    normalized.includes(" latte ") ||
    normalized.includes(" 拿鐵 ") ||
    normalized.includes(" 濃縮 ");
  return asksCoffee && !picksSpecificDrink;
}

function itemAliases(item: MenuItem) {
  const aliases = new Set<string>([
    item.id.replace(/-/g, " "),
    item.name,
    ...item.name.split(/\s+/),
    ...item.id.split("-"),
  ]);

  if (item.id === "iced-latte") {
    aliases.add("latte");
    aliases.add("iced latte");
    aliases.add("拿鐵");
    aliases.add("冰拿鐵");
  }
  if (item.id === "espresso") {
    aliases.add("濃縮");
    aliases.add("咖啡");
  }
  if (item.id === "croissant") {
    aliases.add("croissant");
    aliases.add("可頌");
    aliases.add("麵包");
  }

  return [...aliases]
    .map((alias) => alias.trim().toLowerCase())
    .filter((alias) => alias.length >= 3 || /[\u4e00-\u9fff]/.test(alias));
}

function matchNaturalOrderItem(text: string, merchant: MerchantProfile) {
  const normalized = normalizedNaturalText(text);
  let best: { item: MenuItem; score: number } | null = null;

  for (const item of merchant.menu) {
    for (const alias of itemAliases(item)) {
      const normalizedAlias = normalizedNaturalText(alias).trim();
      if (!normalizedAlias || !normalized.includes(` ${normalizedAlias} `)) continue;
      const score = normalizedAlias.length;
      if (!best || score > best.score) best = { item, score };
    }
  }

  return best?.item || null;
}

function parseCommand(text: string): ParsedCommand {
  const trimmed = text.trim();
  const [command = "", merchantArg, itemArg, quantityArg, ...rest] = trimmed.split(/\s+/);
  const normalizedCommand = command.split("@")[0].toLowerCase();
  const merchantId = cleanToken(merchantArg, DEFAULT_MERCHANT_ID);

  if (normalizedCommand === "/menu") {
    return { kind: "menu", merchantId };
  }

  if (normalizedCommand === "/order") {
    return {
      kind: "draft_order",
      merchantId,
      itemId: cleanToken(itemArg),
      quantity: quantityFrom(quantityArg),
      notes: cleanNotes(rest.join(" ")),
      noteCode: noteCodeForText(rest.join(" ")),
    };
  }

  if (normalizedCommand === "/start" || normalizedCommand === "/help") {
    return { kind: "help", merchantId };
  }

  if (normalizedCommand.startsWith("/")) {
    return { kind: "help", merchantId };
  }

  if (isAmbiguousCoffeeRequest(trimmed)) {
    return { kind: "clarify", merchantId: DEFAULT_MERCHANT_ID, text: trimmed };
  }

  const merchant = knownMerchantProfileForId(DEFAULT_MERCHANT_ID);
  const matchedItem = merchant ? matchNaturalOrderItem(trimmed, merchant) : null;
  if (merchant && matchedItem) {
    return {
      kind: "draft_order",
      merchantId: merchant.id,
      itemId: matchedItem.id,
      quantity: quantityFromNaturalText(` ${trimmed} `),
      notes: `Natural language order: ${cleanNotes(trimmed)}`,
      noteCode: noteCodeForText(trimmed),
    };
  }

  return { kind: "help", merchantId };
}

function telegramCustomerLabel(from: TelegramUser | undefined) {
  if (!from) return "Telegram user";
  if (from.username) return `@${from.username}`;
  const name = [from.first_name, from.last_name].filter(Boolean).join(" ").trim();
  return name || (from.id ? `tg:${from.id}` : "Telegram user");
}

function defaultMerchantProfile() {
  const merchant = knownMerchantProfileForId(DEFAULT_MERCHANT_ID);
  if (!merchant) {
    throw new Error(`Default merchant ${DEFAULT_MERCHANT_ID} is not configured.`);
  }
  return merchant;
}

function unknownMerchantText(merchantId: string) {
  return [
    `Unknown merchant: ${merchantId || "(missing)"}`,
    "",
    `Use /menu ${DEFAULT_MERCHANT_ID} for the Raposa Coffee demo menu.`,
  ].join("\n");
}

function menuText(merchant: MerchantProfile) {
  const items = merchant.menu
    .map((item) => `- ${item.id} · ${item.name} · $${item.amountUsd}`)
    .join("\n");

  return [
    `${merchant.name} menu`,
    items,
    "",
    "Type naturally, like:",
    " one iced latte",
    " can I get an espresso",
    "",
    "Or tap an item below / use:",
    ` /order ${merchant.id} ${merchant.menu[0]?.id || "coffee"} 1`,
    "Jiagon will create an Order Pass. It becomes a receipt only after Raposa confirms payment at the counter.",
  ].join("\n");
}

function helpText(merchant: MerchantProfile) {
  return [
    "Jiagon Telegram POS",
    "",
    `${merchant.name}: type a natural order, like "one iced latte".`,
    `Manual fallback: /order ${merchant.id} ${merchant.menu[0]?.id || "coffee"} 1`,
    "",
    "After Raposa confirms payment and taps Paid + Done, NFC lets the customer claim the verified receipt.",
  ].join("\n");
}

function orderItemCallbackData(merchantId: string, itemId: string) {
  if (!TELEGRAM_CALLBACK_TOKEN_PATTERN.test(merchantId) || !TELEGRAM_CALLBACK_TOKEN_PATTERN.test(itemId)) {
    throw new Error(
      `Telegram order callback ids must be ${TELEGRAM_CALLBACK_TOKEN_MAX} characters or fewer and URL-safe.`,
    );
  }
  return `order_item:${merchantId}:${itemId}`;
}

function draftOrderCallbackData(merchantId: string, itemId: string, quantity = 1, noteCode = "") {
  if (!TELEGRAM_CALLBACK_TOKEN_PATTERN.test(merchantId) || !TELEGRAM_CALLBACK_TOKEN_PATTERN.test(itemId)) {
    throw new Error(
      `Telegram order callback ids must be ${TELEGRAM_CALLBACK_TOKEN_MAX} characters or fewer and URL-safe.`,
    );
  }
  const note = cleanNoteCode(noteCode);
  return ["draft_order", merchantId, itemId, String(quantityFrom(String(quantity))), note].filter(Boolean).join(":");
}

function confirmOrderCallbackData(merchantId: string, itemId: string, quantity = 1, noteCode = "") {
  if (!TELEGRAM_CALLBACK_TOKEN_PATTERN.test(merchantId) || !TELEGRAM_CALLBACK_TOKEN_PATTERN.test(itemId)) {
    throw new Error(
      `Telegram order callback ids must be ${TELEGRAM_CALLBACK_TOKEN_MAX} characters or fewer and URL-safe.`,
    );
  }
  const note = cleanNoteCode(noteCode);
  return ["confirm_order", merchantId, itemId, String(quantityFrom(String(quantity))), note].filter(Boolean).join(":");
}

function changeOrderCallbackData(merchantId: string) {
  if (!TELEGRAM_CALLBACK_TOKEN_PATTERN.test(merchantId)) {
    throw new Error(`Telegram merchant id must be ${TELEGRAM_CALLBACK_TOKEN_MAX} characters or fewer and URL-safe.`);
  }
  return `change_order:${merchantId}`;
}

function menuKeyboard(merchant: MerchantProfile) {
  return {
    inline_keyboard: merchant.menu.map((item) => [
      {
        text: `${item.name} · $${item.amountUsd}`,
        callback_data: draftOrderCallbackData(merchant.id, item.id, 1),
      },
    ]),
  };
}

function telegramResponse(
  chatId: number | string | null,
  text: string,
  status = 200,
  extra: Record<string, unknown> = {},
) {
  return Response.json(
    {
      method: "sendMessage",
      chat_id: chatId,
      text,
      ...extra,
    },
    { status },
  );
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
      "Jiagon Telegram webhook cannot issue receipt claim links because JIAGON_APP_ORIGIN, NEXT_PUBLIC_APP_URL, and VERCEL_URL are unset.",
    );
  }

  return "";
}

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
    const result = await response.json().catch(() => null) as { ok?: boolean } | null;
    return { sent: response.ok && result?.ok === true, skipped: false };
  } catch {
    return { sent: false, skipped: false };
  } finally {
    clearTimeout(timeoutId);
  }
}

function callbackData(value: unknown): ParsedCallbackData | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const staffMatch = /^(paid_done|cancel):(ord-[a-f0-9]{16})$/.exec(trimmed);
  if (staffMatch) {
    return { action: staffMatch[1] as "paid_done" | "cancel", orderId: staffMatch[2] };
  }

  const itemMatch = /^(order_item|draft_order):([a-z0-9-]{1,32}):([a-z0-9-]{1,32})(?::([1-9]|1\d|20))?(?::([a-z0-9-]{1,24}))?$/.exec(trimmed);
  if (itemMatch) {
    return {
      action: itemMatch[1] as "order_item" | "draft_order",
      merchantId: itemMatch[2],
      itemId: itemMatch[3],
      quantity: quantityFrom(itemMatch[4]),
      noteCode: cleanNoteCode(itemMatch[5]),
    };
  }

  const confirmMatch = /^confirm_order:([a-z0-9-]{1,32}):([a-z0-9-]{1,32}):([1-9]|1\d|20)(?::([a-z0-9-]{1,24}))?$/.exec(trimmed);
  if (confirmMatch) {
    return {
      action: "confirm_order",
      merchantId: confirmMatch[1],
      itemId: confirmMatch[2],
      quantity: quantityFrom(confirmMatch[3]),
      noteCode: cleanNoteCode(confirmMatch[4]),
    };
  }

  const changeMatch = /^change_order:([a-z0-9-]{1,32})$/.exec(trimmed);
  return changeMatch ? { action: "change_order", merchantId: changeMatch[1] } : null;
}

function sameTelegramChat(left: number | string | null, right: string) {
  return String(left ?? "").trim() === right.trim();
}

function orderDraftText(merchant: MerchantProfile, menuItem: MenuItem, quantity: number, noteCode = "") {
  const note = noteTextFromCode(noteCode);
  const total = (Number(menuItem.amountUsd) * quantity).toFixed(2);
  return [
    "I found this order:",
    "",
    `${quantity}x ${menuItem.name} · $${total}`,
    note ? `Notes: ${note}` : "",
    "",
    "Payment is handled at the Raposa counter.",
    "I will only create an Order Pass after you confirm.",
  ].filter(Boolean).join("\n");
}

function orderDraftKeyboard(merchant: MerchantProfile, menuItem: MenuItem, quantity: number, noteCode = "") {
  return {
    inline_keyboard: [
      [
        {
          text: "Confirm order",
          callback_data: confirmOrderCallbackData(merchant.id, menuItem.id, quantity, noteCode),
        },
        { text: "Change", callback_data: changeOrderCallbackData(merchant.id) },
      ],
    ],
  };
}

function clarificationText(merchant: MerchantProfile) {
  return [
    "I can help with coffee.",
    "",
    "Which one should I add to your Order Pass?",
    "Payment still happens at the counter; Jiagon issues a receipt only after staff confirms payment.",
  ].join("\n");
}

function clarificationKeyboard(merchant: MerchantProfile) {
  const coffeeItems = merchant.menu.filter((item) => item.id === "espresso" || item.id === "iced-latte");
  return {
    inline_keyboard: coffeeItems.map((item) => [
      { text: item.name, callback_data: draftOrderCallbackData(merchant.id, item.id, 1) },
    ]),
  };
}

async function handleCallback(request: Request, callback: TelegramCallbackQuery) {
  const chatId = callback.message?.chat?.id ?? null;
  const parsed = callbackData(callback.data);
  if (!parsed) {
    await sendTelegramMethod("answerCallbackQuery", {
      callback_query_id: callback.id,
      text: "Unsupported Jiagon action.",
      show_alert: false,
    });
    return telegramResponse(chatId, "Unsupported Jiagon order action.", 200);
  }

  if (parsed.action === "change_order") {
    const merchant = knownMerchantProfileForId(parsed.merchantId);
    if (!merchant) return telegramResponse(chatId, unknownMerchantText(parsed.merchantId), 200);
    await sendTelegramMethod("answerCallbackQuery", {
      callback_query_id: callback.id,
      text: "Choose another item",
      show_alert: false,
    });
    return telegramResponse(chatId, menuText(merchant), 200, { reply_markup: menuKeyboard(merchant) });
  }

  if (parsed.action === "order_item" || parsed.action === "draft_order" || parsed.action === "confirm_order") {
    const merchant = knownMerchantProfileForId(parsed.merchantId);
    if (!merchant) {
      await sendTelegramMethod("answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "Unknown merchant",
        show_alert: false,
      });
      return telegramResponse(chatId, unknownMerchantText(parsed.merchantId), 200);
    }

    const menuItem = merchant.menu.find((item) => item.id === parsed.itemId);
    if (!menuItem) {
      await sendTelegramMethod("answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "Item unavailable",
        show_alert: false,
      });
      return telegramResponse(chatId, menuText(merchant), 200, { reply_markup: menuKeyboard(merchant) });
    }

    if (parsed.action === "order_item" || parsed.action === "draft_order") {
      await sendTelegramMethod("answerCallbackQuery", {
        callback_query_id: callback.id,
        text: `Drafting ${menuItem.name}`,
        show_alert: false,
      });
      return telegramResponse(
        chatId,
        orderDraftText(merchant, menuItem, parsed.quantity, parsed.noteCode),
        200,
        { reply_markup: orderDraftKeyboard(merchant, menuItem, parsed.quantity, parsed.noteCode) },
      );
    }

    await sendTelegramMethod("answerCallbackQuery", {
      callback_query_id: callback.id,
      text: `Creating Order Pass`,
      show_alert: false,
    });
    return createTelegramOrderReply({
      chatId,
      customer: callback.from,
      idempotencyKey: telegramConfirmOrderIdempotencyKey(
        callback,
        merchant.id,
        menuItem.id,
        parsed.quantity,
        parsed.noteCode,
      ),
      merchant,
      menuItem,
      quantity: parsed.quantity,
      notes: noteTextFromCode(parsed.noteCode) || noteTextFromDraftMessage(callback.message?.text),
      origin: requestOrigin(request),
    });
  }

  const expectedGroupChatId = merchantGroupChatId();
  if (expectedGroupChatId && !sameTelegramChat(chatId, expectedGroupChatId)) {
    await sendTelegramMethod("answerCallbackQuery", {
      callback_query_id: callback.id,
      text: "Merchant group only.",
      show_alert: true,
    });
    return telegramResponse(chatId, "Jiagon order actions are only enabled in the configured merchant Telegram group.", 200);
  }

  if (parsed.action !== "paid_done" && parsed.action !== "cancel") {
    return telegramResponse(chatId, "Unsupported Jiagon order action.", 200);
  }

  if (parsed.action === "cancel") {
    const result = await updateMerchantOrderStatus({ id: parsed.orderId, nextStatus: "cancelled" });
    const order = result.order ? publicMerchantOrder(result.order) : null;
    const text = result.updated && order
      ? `Cancelled order #${order.pickupCode}.`
      : `Could not cancel order ${parsed.orderId}: ${result.error || "order not found"}`;
    await sendTelegramMethod("answerCallbackQuery", {
      callback_query_id: callback.id,
      text: result.updated ? "Cancelled" : "Cancel failed",
      show_alert: false,
    });
    return telegramResponse(chatId, text, 200);
  }

  const origin = requestOrigin(request);
  if (!origin) {
    await sendTelegramMethod("answerCallbackQuery", {
      callback_query_id: callback.id,
      text: "Missing app origin configuration",
      show_alert: true,
    });
    return telegramResponse(chatId, "JIAGON_APP_ORIGIN or NEXT_PUBLIC_APP_URL is required to issue claim links.", 200);
  }

  const result = await completeMerchantOrderWithReceipt({
    id: parsed.orderId,
    origin,
    issuedBy: "Raposa Coffee Telegram staff",
  });
  const order = result.order ? publicMerchantOrder(result.order) : null;
  const text = result.updated && order
    ? [
        `Receipt ready for Order Pass #${order.pickupCode}`,
        "",
        "Customer claim flow:",
        "1. Ask the customer to tap the Raposa NFC receipt station.",
        `2. Customer enters Order Pass ${order.pickupCode}.`,
        `NFC station: ${nfcStationUrl(origin, order.merchantId)}`,
        "",
        "Proof: merchant_completed -> customer_claimed after customer claim.",
      ].join("\n")
    : `Could not complete order ${parsed.orderId}: ${result.error || "order not found"}`;

  await sendTelegramMethod("answerCallbackQuery", {
    callback_query_id: callback.id,
    text: result.updated ? "Receipt ready" : "Complete failed",
    show_alert: false,
  });

  return telegramResponse(chatId, text, 200);
}

async function createTelegramOrderReply({
  chatId,
  customer,
  idempotencyKey,
  merchant,
  menuItem,
  quantity,
  notes,
  origin,
}: {
  chatId: number | string | null;
  customer?: TelegramUser;
  idempotencyKey: string;
  merchant: MerchantProfile;
  menuItem: MenuItem;
  quantity: number;
  notes: string | null;
  origin?: string;
}) {
  const item: MerchantOrderItem = {
    id: menuItem.id,
    name: menuItem.name,
    quantity,
    unitAmountCents: dollarsToCents(menuItem.amountUsd),
  };
  if (item.unitAmountCents <= 0) {
    console.error("Invalid Telegram menu price.", {
      merchantId: merchant.id,
      itemId: menuItem.id,
      amountUsd: menuItem.amountUsd,
    });
    return telegramResponse(
      chatId,
      "That item is temporarily unavailable. Please choose another item.",
      200,
      { reply_markup: menuKeyboard(merchant) },
    );
  }

  const result = await createMerchantOrder({
    idempotencyKey,
    merchantId: merchant.id,
    merchantName: merchant.name,
    location: merchant.location,
    customerLabel: telegramCustomerLabel(customer),
    source: "telegram",
    items: [item],
    notes,
  });

  if (result.configured && !result.persisted) {
    console.error("Failed to persist Telegram merchant order.", {
      merchantId: merchant.id,
      itemId: menuItem.id,
      idempotencyKey,
      error: result.error,
    });
    return telegramResponse(
      chatId,
      "Order could not be saved right now. Please try again at the counter.",
      200,
      { reply_markup: menuKeyboard(merchant) },
    );
  }

  const order = publicMerchantOrder(result.order);
  try {
    const pilotEvent = await recordMerchantPilotEvent({
      merchantId: merchant.id,
      eventName: "order_started",
      source: "telegram-order",
    });
    if (!pilotEvent.recorded) {
      console.warn("Jiagon Telegram order_started pilot event was not recorded.", {
        merchantId: merchant.id,
        error: pilotEvent.error,
      });
    }
  } catch (error) {
    console.warn("Jiagon Telegram order_started pilot event failed.", {
      merchantId: merchant.id,
      error,
    });
  }
  const pairUrl = origin
    ? `${origin}/tile/${merchant.id}?pass=${encodeURIComponent(order.pickupCode)}`
    : "";
  const merchantNotify = await notifyMerchantGroup(result.order);
  if (!merchantNotify.sent && !merchantNotify.skipped) {
    console.warn("Jiagon Telegram merchant group dispatch failed.", {
      orderId: order.id,
      pickupCode: order.pickupCode,
      merchantId: merchant.id,
    });
    return telegramResponse(
      chatId,
      [
        `Your ${merchant.name} Order Pass is ready.`,
        "",
        `${item.name} · $${order.subtotalUsd}`,
        `Pass: ${order.pickupCode}`,
        pairUrl ? `Pair phone for NFC receipt pickup: ${pairUrl}` : "",
        "",
        "Staff notification failed, so please show this pass at the counter if needed.",
      ].filter(Boolean).join("\n"),
      200,
    );
  }
  const reply = [
    `Your ${merchant.name} Order Pass is ready`,
    "",
    `${item.quantity}x ${item.name} · $${order.subtotalUsd}`,
    `Pass: ${order.pickupCode}`,
    "",
    pairUrl ? `Pair phone for NFC receipt pickup: ${pairUrl}` : "",
    `Show this pass at ${merchant.name}. Pay at the counter as usual.`,
    "This is not a receipt yet. After Raposa confirms payment and taps Paid + Done, tap NFC to claim the receipt into Jiagon Passport.",
  ].filter(Boolean).join("\n");

  return telegramResponse(chatId, reply, 200);
}

export async function POST(request: Request) {
  const authError = validateTelegramSecret(request);
  if (authError) {
    return Response.json({ error: authError }, { status: authError.startsWith("Invalid") ? 401 : 503 });
  }

  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return Response.json({ error: "Telegram webhook requires JSON." }, { status: 415 });
  }

  let payload: TelegramWebhookPayload;
  try {
    const rawBody = await request.text();
    const rawBodyBytes = new TextEncoder().encode(rawBody).length;
    if (rawBodyBytes > MAX_TELEGRAM_BODY_BYTES) {
      return Response.json({ error: "Telegram webhook payload is too large." }, { status: 413 });
    }
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return Response.json({ error: "Telegram webhook payload must be an object." }, { status: 400 });
    }
    payload = parsed as TelegramWebhookPayload;
  } catch {
    return Response.json({ error: "Invalid Telegram webhook JSON." }, { status: 400 });
  }

  if (payload.callback_query) {
    return handleCallback(request, payload.callback_query);
  }

  const message = payload.message;
  const chatId = message?.chat?.id ?? null;
  const text = typeof message?.text === "string" ? message.text : "";
  if (!message || !text) {
    const merchant = defaultMerchantProfile();
    return telegramResponse(chatId, helpText(merchant), 200, { reply_markup: menuKeyboard(merchant) });
  }

  const command = parseCommand(text);
  if (command.kind === "help") {
    const merchantId = command.merchantId || DEFAULT_MERCHANT_ID;
    const merchant = knownMerchantProfileForId(merchantId);
    if (!merchant) return telegramResponse(chatId, unknownMerchantText(merchantId), 200);
    return telegramResponse(chatId, helpText(merchant), 200, { reply_markup: menuKeyboard(merchant) });
  }
  if (command.kind === "menu") {
    const merchant = knownMerchantProfileForId(command.merchantId);
    if (!merchant) return telegramResponse(chatId, unknownMerchantText(command.merchantId), 200);
    return telegramResponse(chatId, menuText(merchant), 200, { reply_markup: menuKeyboard(merchant) });
  }
  if (command.kind === "clarify") {
    const merchant = knownMerchantProfileForId(command.merchantId);
    if (!merchant) return telegramResponse(chatId, unknownMerchantText(command.merchantId), 200);
    return telegramResponse(chatId, clarificationText(merchant), 200, { reply_markup: clarificationKeyboard(merchant) });
  }

  const merchant = knownMerchantProfileForId(command.merchantId);
  if (!merchant) return telegramResponse(chatId, unknownMerchantText(command.merchantId), 200);

  const menuItem = merchant.menu.find((item) => item.id === command.itemId);
  if (!menuItem) {
    return telegramResponse(
      chatId,
      [`Item not found: ${command.itemId || "(missing)"}`, "", menuText(merchant)].join("\n"),
      200,
      { reply_markup: menuKeyboard(merchant) },
    );
  }

  return telegramResponse(
    chatId,
    orderDraftText(merchant, menuItem, command.quantity, command.noteCode),
    200,
    { reply_markup: orderDraftKeyboard(merchant, menuItem, command.quantity, command.noteCode) },
  );
}

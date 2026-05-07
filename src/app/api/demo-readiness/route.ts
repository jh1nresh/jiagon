import type { DemoReadinessCheck, DemoReadinessResponse, DemoReadinessStatus } from "@/lib/demoReadiness";
import { solanaBubblegumReadinessSmoke } from "@/server/solanaBubblegum";
import { solanaCreditDepositConfig } from "@/server/solanaCreditDeposit";
import { authorizeMerchantDashboard } from "@/server/merchantAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CREDIT_REQUIRED_ENV = [
  "JIAGON_CREDIT_DEVNET_DEMO_ENABLED=true",
  "SOLANA_CREDIT_VERIFIER_SECRET_KEY",
  "SOLANA_CREDIT_DEMO_OWNER_PUBLIC_KEY",
  "SOLANA_CREDIT_DEMO_OWNER_SECRET_KEY",
  "SOLANA_CREDIT_DEMO_BORROWER_TOKEN_ACCOUNT",
  "SOLANA_CREDIT_PAYMENT_MINT",
  "SOLANA_CREDIT_VAULT_TOKEN_ACCOUNT",
  "SOLANA_CREDIT_MERCHANT_ESCROW_TOKEN_ACCOUNT",
];

function configured(value: string | undefined) {
  return Boolean((value || "").trim());
}

function configuredOrigin() {
  return (
    configured(process.env.JIAGON_APP_ORIGIN) ||
    configured(process.env.NEXT_PUBLIC_APP_URL) ||
    configured(process.env.VERCEL_URL) ||
    process.env.NODE_ENV !== "production"
  );
}

function missing(names: string[]) {
  return names.filter((name) => {
    if (name.endsWith("=true")) {
      const envName = name.slice(0, -5);
      return process.env[envName] !== "true";
    }
    return !configured(process.env[name]);
  });
}

function readinessStatus(configuredValue: boolean, blockedValue = false): DemoReadinessStatus {
  if (blockedValue) return "blocked";
  return configuredValue ? "ready" : "missing";
}

function authStatus(error: string) {
  return error.startsWith("Invalid") ? 401 : 503;
}

export async function GET(request: Request) {
  const authError = authorizeMerchantDashboard(request);
  if (authError) {
    return Response.json({ error: authError } satisfies DemoReadinessResponse, { status: authStatus(authError) });
  }

  const bubblegum = await solanaBubblegumReadinessSmoke();
  const credit = solanaCreditDepositConfig();
  const telegramMissing = missing([
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_MERCHANT_GROUP_CHAT_ID",
    ...(process.env.NODE_ENV === "production" ? ["TELEGRAM_WEBHOOK_SECRET"] : []),
  ]);
  if (!configuredOrigin()) telegramMissing.push("JIAGON_APP_ORIGIN or NEXT_PUBLIC_APP_URL");

  const creditMissing = missing(CREDIT_REQUIRED_ENV);
  const helioConfigured = configured(process.env.HELIO_PAYLINK_ID);
  const solanaPayConfigured = configured(process.env.JIAGON_SOLANA_PAY_RECIPIENT);
  const cryptoPayMissing = helioConfigured || solanaPayConfigured ? [] : ["HELIO_PAYLINK_ID or JIAGON_SOLANA_PAY_RECIPIENT"];
  const helioNetwork = (process.env.HELIO_NETWORK || process.env.NEXT_PUBLIC_HELIO_NETWORK || "test").trim().toLowerCase();
  const helioBlocked = helioConfigured && helioNetwork === "main";
  const checks: DemoReadinessCheck[] = [
    {
      id: "telegram",
      label: "Telegram POS",
      status: readinessStatus(telegramMissing.length === 0),
      configured: telegramMissing.length === 0,
      mode: telegramMissing.length === 0 ? "merchant Telegram ready" : "setup required",
      missingCount: telegramMissing.length,
      detail: "Customer Telegram orders can notify the merchant group and staff can tap Paid + Done.",
    },
    {
      id: "bubblegum",
      label: "Bubblegum receipt cNFT",
      status: bubblegum.status,
      configured: bubblegum.configured,
      mode: bubblegum.mode,
      missingCount: bubblegum.missing.length,
      detail: bubblegum.detail,
      diagnostics: bubblegum.diagnostics,
    },
    {
      id: "credit-vault",
      label: "Devnet credit vault",
      status: readinessStatus(credit.configured, !credit.enabled),
      configured: credit.configured,
      enabled: credit.enabled,
      mode: credit.configured && credit.enabled ? "draw-repay ready" : credit.enabled ? "setup required" : "disabled",
      missingCount: creditMissing.length,
      detail: "Credit page can send real devnet draw and repay transactions.",
    },
    {
      id: "helio-pay",
      label: "Crypto Pay on Solana",
      status: readinessStatus(cryptoPayMissing.length === 0, helioBlocked),
      configured: cryptoPayMissing.length === 0,
      enabled: cryptoPayMissing.length === 0 && !helioBlocked,
      mode: helioBlocked
        ? "mainnet blocked"
        : helioConfigured
          ? "Helio Solana checkout ready"
          : solanaPayConfigured
            ? "direct Solana Pay ready"
            : "optional setup",
      missingCount: cryptoPayMissing.length,
      detail: "Agent orders can return one Crypto Pay on Solana request: Helio checkout first, direct Solana Pay fallback. Receipt issuance still requires staff Paid + Done until webhook verification is added.",
      diagnostics: [
        {
          label: "network",
          value: helioNetwork === "main" ? "blocked-main" : "test",
        },
      ],
    },
  ];
  const readyCount = checks.filter((check) => check.status === "ready").length;

  const body: DemoReadinessResponse = {
    product: "Jiagon Consensus demo readiness",
    generatedAt: new Date().toISOString(),
    overall: {
      ready: readyCount === checks.length,
      readyCount,
      total: checks.length,
    },
    checks,
  };

  return Response.json(body);
}

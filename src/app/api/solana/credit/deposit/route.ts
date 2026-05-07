import { bearerTokenFromRequest, verifyPrivyAccessToken } from "@/server/privyAuth";
import {
  releaseMerchantReceiptCreditReservation,
  reserveMerchantReceiptCreditAtomic,
} from "@/server/receiptStore";
import {
  drawDevnetRestaurantDeposit,
  repayDevnetRestaurantDeposit,
  solanaCreditDepositConfig,
} from "@/server/solanaCreditDeposit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOCAL_DEMO_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function authError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to verify Privy access token.";
  const status = message.includes("not configured") ? 503 : 401;
  return Response.json({ error: message }, { status });
}

function isTrustedLocalDemo(request: Request) {
  const requestHost = request.headers.get("host")?.split(":")[0]?.toLowerCase();
  return process.env.NODE_ENV !== "production" && Boolean(requestHost && LOCAL_DEMO_HOSTS.has(requestHost));
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host")?.toLowerCase();
  if (!origin || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

async function verifiedClaims(request: Request) {
  const token = bearerTokenFromRequest(request);
  if (!token) throw new Error("Privy bearer token is required.");
  return verifyPrivyAccessToken(token);
}

function amountCents(value: unknown) {
  const normalized =
    typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : typeof value === "string"
        ? value.trim().replace(/[$,\s]/g, "")
        : "";
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

function cleanText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 100) : fallback;
}

export async function GET() {
  const config = solanaCreditDepositConfig();
  return Response.json({
    product: "Jiagon devnet restaurant deposit credit",
    enabled: config.enabled,
    configured: config.configured,
    cluster: config.cluster,
    mode: "server-side-devnet-demo",
  });
}

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return Response.json({ error: "Devnet deposit credit requires a JSON request." }, { status: 415 });
  }

  if (!isTrustedLocalDemo(request) && !sameOrigin(request)) {
    return Response.json({ error: "Devnet deposit credit must be requested from the Jiagon app origin." }, { status: 403 });
  }

  let claims: Awaited<ReturnType<typeof verifiedClaims>>;
  try {
    claims = await verifiedClaims(request);
  } catch (error) {
    return authError(error);
  }

  const config = solanaCreditDepositConfig();
  if (!config.enabled || !config.configured) {
    return Response.json({
      error: "Devnet credit transaction route is not configured.",
      enabled: config.enabled,
      configured: config.configured,
      requiredEnv: [
        "JIAGON_CREDIT_DEVNET_DEMO_ENABLED=true",
        "SOLANA_CREDIT_VERIFIER_SECRET_KEY",
        "SOLANA_CREDIT_DEMO_OWNER_PUBLIC_KEY",
        "SOLANA_CREDIT_DEMO_OWNER_SECRET_KEY",
        "SOLANA_CREDIT_DEMO_BORROWER_TOKEN_ACCOUNT",
        "SOLANA_CREDIT_PAYMENT_MINT",
        "SOLANA_CREDIT_VAULT_TOKEN_ACCOUNT",
        "SOLANA_CREDIT_MERCHANT_ESCROW_TOKEN_ACCOUNT",
      ],
    }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    const rawBody = await request.text();
    if (rawBody.length > 25_000) {
      return Response.json({ error: "Devnet deposit payload is too large." }, { status: 413 });
    }
    body = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    if (body.action === "draw") {
      const cents = amountCents(body.amountUsd ?? body.amount);
      if (cents == null || cents <= 0 || cents > 2_500) {
        return Response.json({ error: "Draw amount must be greater than $0 and at most $25 for the demo." }, { status: 400 });
      }
      const reservation = await reserveMerchantReceiptCreditAtomic(claims.userId, cents);
      if (reservation.error) {
        return Response.json({ error: reservation.error }, { status: 503 });
      }
      if (!reservation.configured) {
        return Response.json(
          { error: "Server-side merchant receipt credit index is not configured." },
          { status: 503 },
        );
      }
      if (reservation.mintedReceiptCount <= 0) {
        return Response.json(
          { error: "Mint a Bubblegum merchant receipt cNFT before drawing devnet credit." },
          { status: 403 },
        );
      }
      if (reservation.unlockedCreditCents <= 0) {
        return Response.json(
          { error: "Devnet credit is exhausted for the currently minted receipts." },
          { status: 403 },
        );
      }
      if (!reservation.reserved) {
        return Response.json(
          {
            error: `Draw amount exceeds unlocked credit of $${(reservation.unlockedCreditCents / 100).toFixed(2)}.`,
            unlockedCreditUsd: (reservation.unlockedCreditCents / 100).toFixed(2),
          },
          { status: 400 },
        );
      }
      let result: Awaited<ReturnType<typeof drawDevnetRestaurantDeposit>>;
      try {
        result = await drawDevnetRestaurantDeposit({
          amountCents: cents,
          merchantName: cleanText(body.merchantName, "restaurant"),
        });
      } catch (error) {
        try {
          await releaseMerchantReceiptCreditReservation(claims.userId, reservation.reservations);
        } catch (releaseError) {
          console.error("Jiagon failed to release devnet credit reservation after draw error.", {
            userId: claims.userId,
            reservations: reservation.reservations,
            error: releaseError,
          });
        }
        throw error;
      }
      const creditProfile = reservation.creditProfile || {
        unlockedCreditCents: Math.max(0, reservation.unlockedCreditCents - cents),
        mintedReceiptCount: reservation.mintedReceiptCount,
        receiptIds: reservation.receiptIds,
      };
      return Response.json({
        ...result,
        creditProfile: {
          unlockedCreditUsd: (creditProfile.unlockedCreditCents / 100).toFixed(2),
          mintedReceiptCount: creditProfile.mintedReceiptCount,
          receiptIds: creditProfile.receiptIds,
        },
      });
    }

    if (body.action === "repay") {
      const drawId = cleanText(body.drawId);
      const result = await repayDevnetRestaurantDeposit({ drawId });
      return Response.json(result);
    }

    return Response.json({ error: "Unsupported deposit action." }, { status: 400 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to send devnet credit transaction." },
      { status: 500 },
    );
  }
}

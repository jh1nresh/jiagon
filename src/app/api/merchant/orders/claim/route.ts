import { findMerchantOrderByPickupCode, publicMerchantOrder } from "@/server/merchantOrderStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanMerchantId(value: string | null) {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function cleanPickupCode(value: string | null) {
  return (value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, "")
    .slice(0, 16);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const merchantId = cleanMerchantId(url.searchParams.get("merchantId"));
  const pickupCode = cleanPickupCode(url.searchParams.get("pickupCode"));

  if (!merchantId || !pickupCode) {
    return Response.json({ error: "Merchant id and pickup code are required." }, { status: 400 });
  }

  const result = await findMerchantOrderByPickupCode({ merchantId, pickupCode });
  if (result.error) {
    return Response.json({ error: result.error, configured: result.configured }, { status: 503 });
  }
  if (!result.order) {
    return Response.json(
      {
        claimable: false,
        status: "not_found",
        message: "No order was found for that pickup code.",
      },
      { status: 404 },
    );
  }

  const order = result.order;
  const publicOrder = publicMerchantOrder(order);
  if (order.receiptClaimUrl) {
    return Response.json({
      claimable: true,
      status: order.status,
      claimUrl: order.receiptClaimUrl,
      order: publicOrder,
      message: order.receiptClaimedAt
        ? "This receipt was already claimed. Opening the claim page will show its current status."
        : "Receipt is ready to claim.",
    });
  }

  return Response.json({
    claimable: false,
    status: order.status,
    order: publicOrder,
    message: order.status === "completed"
      ? "Receipt is still being prepared. Ask staff to refresh and try again."
      : "Staff has not marked this order fulfilled yet.",
  });
}

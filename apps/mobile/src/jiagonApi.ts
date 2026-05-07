import { jiagonConfig } from "./config";

export type CreditImpact = {
  eligible: boolean;
  unlockedCreditUsd: number;
  reason: string;
};

export type MerchantReceipt = {
  id: string;
  merchantId?: string;
  merchantName: string;
  location?: string | null;
  receiptNumber?: string;
  amountCents?: number;
  amountUsd: string;
  currency?: string;
  category?: string;
  purpose?: string;
  status: "issued" | "claimed" | "void" | string;
  receiptHash: string;
  issuedAt?: string | null;
  claimedAt?: string | null;
  mintStatus?: "none" | "ready" | "prepared" | "minted" | string;
  credentialId?: string | null;
  credentialChain?: string | null;
  standard?: string | null;
  credentialStandard?: string | null;
  dataHash?: string | null;
  storageUri?: string | null;
  solanaOwner?: string | null;
  credentialTx?: string | null;
  explorerUrl?: string | null;
  assetExplorerUrl?: string | null;
  creditImpact?: CreditImpact;
};

export type MintReceiptResult = {
  status: "prepared" | "minted" | string;
  mode?: string;
  network?: string;
  credentialChain?: string;
  standard?: string;
  credentialId?: string;
  sourceReceiptHash?: string;
  dataHash?: string;
  storageUri?: string;
  solanaOwner?: string;
  credentialTx?: string | null;
  explorerUrl?: string | null;
  assetExplorerUrl?: string | null;
  note?: string;
  creditImpact?: CreditImpact;
};

function apiUrl(path: string) {
  return `${jiagonConfig.apiBaseUrl.replace(/\/$/, "")}${path}`;
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : `Jiagon API request failed with ${response.status}.`;
    throw new Error(message);
  }
  if (payload === null || payload === undefined) {
    throw new Error("Invalid or empty JSON response from Jiagon API.");
  }
  return payload as T;
}

export async function getMerchantReceipt(token: string) {
  const response = await fetch(apiUrl(`/api/merchant/receipts/${encodeURIComponent(token)}`), {
    headers: { accept: "application/json" },
  });
  return readJson<{ receipt: MerchantReceipt }>(response);
}

export async function claimMerchantReceipt(input: {
  token: string;
  accessToken: string;
  walletAddress?: string;
  userLabel?: string;
}) {
  const response = await fetch(apiUrl(`/api/merchant/receipts/${encodeURIComponent(input.token)}/claim`), {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
      "x-jiagon-client": "mobile",
    },
    body: JSON.stringify({
      wallet: input.walletAddress,
      userLabel: input.userLabel || "Jiagon Mobile",
    }),
  });
  return readJson<{ receipt: MerchantReceipt }>(response);
}

export async function mintMerchantReceipt(input: {
  accessToken: string;
  receipt: MerchantReceipt;
  solanaOwner: string;
}) {
  const response = await fetch(apiUrl("/api/solana/merchant-receipts/mint"), {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
      "x-jiagon-client": "mobile",
    },
    body: JSON.stringify({
      receiptId: input.receipt.id,
      receipt: input.receipt,
      solanaOwner: input.solanaOwner,
    }),
  });
  return readJson<MintReceiptResult>(response);
}

export type JiagonSolanaCluster = "devnet" | "testnet" | "localnet";

export const DEFAULT_SOLANA_CLUSTER: JiagonSolanaCluster = "devnet";
export const DEFAULT_SOLANA_RPC_URL = "https://api.devnet.solana.com";

const MAINNET_CLUSTER_VALUES = new Set(["mainnet", "mainnet-beta"]);
const MAINNET_RPC_HINTS = [
  "api.mainnet-beta.solana.com",
  "mainnet.helius",
  "mainnet.quicknode",
  "mainnet.rpcpool",
  "mainnet.solana",
];

export function normalizeSolanaTestCluster(value: string | undefined): JiagonSolanaCluster {
  const cluster = (value || "").trim().toLowerCase();
  if (cluster === "devnet" || cluster === "testnet" || cluster === "localnet") return cluster;
  return DEFAULT_SOLANA_CLUSTER;
}

export function assertSolanaTestnetOnly(input: {
  cluster?: string;
  rpcUrl?: string;
}) {
  const cluster = (input.cluster || "").trim().toLowerCase();
  if (MAINNET_CLUSTER_VALUES.has(cluster)) {
    throw new Error("Jiagon demo is testnet-only. SOLANA_CLUSTER must be devnet, testnet, or localnet.");
  }

  const rpcUrl = (input.rpcUrl || "").trim().toLowerCase();
  if (MAINNET_RPC_HINTS.some((hint) => rpcUrl.includes(hint))) {
    throw new Error("Jiagon demo is testnet-only. SOLANA_RPC_URL must not point to mainnet.");
  }
}

export function solanaTestnetConfigFromEnv() {
  const rawCluster = process.env.SOLANA_CLUSTER;
  const rawRpcUrl = process.env.SOLANA_RPC_URL;
  assertSolanaTestnetOnly({ cluster: rawCluster, rpcUrl: rawRpcUrl });
  const cluster = normalizeSolanaTestCluster(rawCluster);
  return {
    cluster,
    rpcUrl: rawRpcUrl?.trim() || DEFAULT_SOLANA_RPC_URL,
  };
}

export function solscanClusterParam(cluster: string) {
  const normalized = normalizeSolanaTestCluster(cluster);
  return `?cluster=${encodeURIComponent(normalized)}`;
}

import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey as SolanaPublicKey } from "@solana/web3.js";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { mintV2, mplBubblegum, parseLeafFromMintV2Transaction, type MetadataArgsV2Args } from "@metaplex-foundation/mpl-bubblegum";
import { base58, keypairIdentity, none, publicKey, some, type OptionOrNullable, type PublicKey } from "@metaplex-foundation/umi";
import { solanaTestnetConfigFromEnv, solscanClusterParam } from "@/lib/solanaNetwork";

function configuredSecret(value: string | undefined) {
  const secret = (value || "").trim();
  return secret.length > 0 ? secret : null;
}

function parseSecretKey(value: string) {
  const trimmed = value.trim();

  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error("Solana minter secret key JSON must be an array.");
    return Uint8Array.from(parsed.map((item) => {
      const byte = Number(item);
      if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
        throw new Error("Solana minter secret key contains an invalid byte.");
      }
      return byte;
    }));
  }

  if (/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) && trimmed.length > 80) {
    const decoded = Buffer.from(trimmed, "base64");
    if (decoded.length === 64) return new Uint8Array(decoded);
  }

  return base58.serialize(trimmed);
}

function shortKey(value: string | null | undefined) {
  if (!value) return "missing";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function rpcHost(rpcUrl: string) {
  try {
    return new URL(rpcUrl).host;
  } catch {
    return "custom rpc";
  }
}

function solAmount(lamports: number) {
  return `${(lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`;
}

export function solanaBubblegumConfig() {
  const { cluster, rpcUrl } = solanaTestnetConfigFromEnv();
  const merkleTree = configuredSecret(process.env.SOLANA_BUBBLEGUM_TREE);
  const minterSecret = configuredSecret(process.env.SOLANA_BUBBLEGUM_MINTER_SECRET_KEY);
  const collection = configuredSecret(process.env.SOLANA_BUBBLEGUM_COLLECTION);

  return {
    cluster,
    rpcUrl,
    merkleTree,
    collection,
    mintConfigured: Boolean(merkleTree && minterSecret),
    dasRequired: true,
  };
}

export async function solanaBubblegumReadinessSmoke() {
  let config: ReturnType<typeof solanaBubblegumConfig>;
  try {
    config = solanaBubblegumConfig();
  } catch (error) {
    return {
      status: "blocked" as const,
      configured: false,
      mode: "testnet guard blocked",
      missing: [],
      diagnostics: [
        { label: "cluster", value: process.env.SOLANA_CLUSTER || "devnet" },
        { label: "rpc", value: rpcHost(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com") },
      ],
      detail: error instanceof Error ? error.message : "Solana testnet guard blocked this configuration.",
    };
  }
  const minterSecret = configuredSecret(process.env.SOLANA_BUBBLEGUM_MINTER_SECRET_KEY);
  const missing = [
    ...(config.merkleTree ? [] : ["SOLANA_BUBBLEGUM_TREE"]),
    ...(minterSecret ? [] : ["SOLANA_BUBBLEGUM_MINTER_SECRET_KEY"]),
  ];
  const diagnostics = [
    { label: "cluster", value: config.cluster },
    { label: "rpc", value: rpcHost(config.rpcUrl) },
    { label: "tree", value: shortKey(config.merkleTree) },
    { label: "collection", value: shortKey(config.collection) },
  ];

  if (!config.merkleTree || !minterSecret) {
    return {
      status: "missing" as const,
      configured: false,
      mode: "setup required",
      missing,
      diagnostics,
      detail: "Bubblegum minting is not configured yet.",
    };
  }

  try {
    const minter = Keypair.fromSecretKey(parseSecretKey(minterSecret));
    const merkleTree = new SolanaPublicKey(config.merkleTree);
    const collection = config.collection ? new SolanaPublicKey(config.collection) : null;
    const connection = new Connection(config.rpcUrl, "confirmed");
    const [version, minterBalance, treeAccount, collectionAccount] = await Promise.all([
      connection.getVersion(),
      connection.getBalance(minter.publicKey),
      connection.getAccountInfo(merkleTree),
      collection ? connection.getAccountInfo(collection) : Promise.resolve(null),
    ]);
    const smokeDiagnostics = [
      ...diagnostics,
      { label: "rpc version", value: version["solana-core"] || "reachable" },
      { label: "minter", value: shortKey(minter.publicKey.toBase58()) },
      { label: "minter balance", value: solAmount(minterBalance) },
      { label: "tree account", value: treeAccount ? "readable" : "missing" },
      ...(collection ? [{ label: "collection account", value: collectionAccount ? "readable" : "missing" }] : []),
    ];

    if (!treeAccount) {
      return {
        status: "blocked" as const,
        configured: true,
        mode: "tree account missing",
        missing: [],
        diagnostics: smokeDiagnostics,
        detail: "Configured Bubblegum tree was not found on the selected Solana cluster.",
      };
    }

    if (collection && !collectionAccount) {
      return {
        status: "blocked" as const,
        configured: true,
        mode: "collection account missing",
        missing: [],
        diagnostics: smokeDiagnostics,
        detail: "Configured Bubblegum collection was not found on the selected Solana cluster.",
      };
    }

    if (minterBalance <= 0) {
      return {
        status: "blocked" as const,
        configured: true,
        mode: "minter unfunded",
        missing: [],
        diagnostics: smokeDiagnostics,
        detail: `Bubblegum minter has no SOL for ${config.cluster} mint fees.`,
      };
    }

    return {
      status: "ready" as const,
      configured: true,
      mode: `${config.cluster} smoke passed`,
      missing: [],
      diagnostics: smokeDiagnostics,
      detail: "Bubblegum RPC, tree account, and minter funding are ready for a real receipt mint.",
    };
  } catch (error) {
    return {
      status: "blocked" as const,
      configured: true,
      mode: "smoke failed",
      missing: [],
      diagnostics,
      detail: error instanceof Error ? error.message : "Bubblegum readiness smoke failed.",
    };
  }
}

export async function mintJiagonBubblegumReceipt({
  leafOwner,
  sourceReceiptHash,
  dataHash,
  metadataUri,
  name,
}: {
  leafOwner: string;
  sourceReceiptHash: string;
  dataHash: string;
  metadataUri: string;
  name: string;
}) {
  const config = solanaBubblegumConfig();
  const minterSecret = configuredSecret(process.env.SOLANA_BUBBLEGUM_MINTER_SECRET_KEY);

  if (!config.merkleTree || !minterSecret) {
    throw new Error("Solana Bubblegum tree and minter are not configured.");
  }

  const umi = createUmi(config.rpcUrl).use(mplBubblegum());
  const keypair = umi.eddsa.createKeypairFromSecretKey(parseSecretKey(minterSecret));
  umi.use(keypairIdentity(keypair));

  const collection = config.collection ? publicKey(config.collection) as PublicKey : null;
  const metadata: MetadataArgsV2Args = {
    name: name.slice(0, 32),
    symbol: "JIAGON",
    uri: metadataUri,
    sellerFeeBasisPoints: 0,
    collection: (collection ? some(collection) : none()) as OptionOrNullable<PublicKey>,
    creators: [{ address: umi.identity.publicKey, verified: false, share: 100 }],
  };

  const { signature } = await mintV2(umi, {
    leafOwner: publicKey(leafOwner),
    merkleTree: publicKey(config.merkleTree),
    ...(collection ? { coreCollection: collection } : {}),
    metadata,
  }).sendAndConfirm(umi);
  const signatureText = base58.deserialize(signature)[0];
  const leaf = await parseLeafFromMintV2Transaction(umi, signature);
  const assetId = String(leaf.id);

  return {
    status: "minted" as const,
    network: `Solana ${config.cluster}`,
    cluster: config.cluster,
    credentialChain: `solana-${config.cluster}`,
    standard: "bubblegum-v2-cnft",
    merkleTree: config.merkleTree,
    leafOwner,
    assetId,
    leafNonce: Number(leaf.nonce),
    credentialTx: signatureText,
    explorerUrl: `https://solscan.io/tx/${signatureText}${solscanClusterParam(config.cluster)}`,
    assetExplorerUrl: `https://solscan.io/token/${assetId}${solscanClusterParam(config.cluster)}`,
    sourceReceiptHash,
    dataHash,
    storageUri: metadataUri,
    mintedAt: new Date().toISOString(),
    metaplex: {
      program: "mpl-bubblegum",
      version: "v2",
      collection: config.collection || null,
      dasRequired: true,
    },
  };
}

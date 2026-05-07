import * as Linking from "expo-linking";
import { PrivyProvider, useLoginWithEmail, usePrivy } from "@privy-io/expo";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { claimMerchantReceipt, getMerchantReceipt, mintMerchantReceipt, type MerchantReceipt } from "./src/jiagonApi";
import { jiagonConfig } from "./src/config";
import { connectMobileWallet, type MobileWalletSession } from "./src/mobileWallet";

type MobileAuth = {
  configured: boolean;
  ready: boolean;
  authenticated: boolean;
  label: string;
  error?: string;
  getAccessToken: () => Promise<string | null>;
  sendCode?: (email: string) => Promise<void>;
  loginWithCode?: (email: string, code: string) => Promise<void>;
  logout?: () => Promise<void>;
};

const RAPOSA_STATION = `${jiagonConfig.apiBaseUrl}/tile/raposa-coffee?nfc=1`;

function tokenFromUrl(url: string | null) {
  if (!url) return "";
  const parsed = Linking.parse(url);
  const path = Array.isArray(parsed.path) ? parsed.path.join("/") : parsed.path || "";
  const token = path.replace(/^claim\//, "").trim();
  return token.startsWith("jgr_") ? token : "";
}

export default function App() {
  if (!jiagonConfig.privyAppId || !jiagonConfig.privyClientId) {
    return (
      <PassportScreen
        auth={{
          configured: false,
          ready: true,
          authenticated: false,
          label: "Privy mobile client missing",
          getAccessToken: async () => null,
        }}
      />
    );
  }

  return (
    <PrivyProvider appId={jiagonConfig.privyAppId} clientId={jiagonConfig.privyClientId}>
      <PrivyPassport />
    </PrivyProvider>
  );
}

function PrivyPassport() {
  const privy = usePrivy();
  const emailLogin = useLoginWithEmail();

  const auth: MobileAuth = {
    configured: true,
    ready: privy.isReady,
    authenticated: Boolean(privy.user),
    label: privy.user?.id || "Not signed in",
    error: privy.error?.message,
    getAccessToken: privy.getAccessToken,
    sendCode: async (email: string) => {
      await emailLogin.sendCode({ email });
    },
    loginWithCode: async (email: string, code: string) => {
      await emailLogin.loginWithCode({ email, code });
    },
    logout: privy.logout,
  };

  return <PassportScreen auth={auth} />;
}

function PassportScreen({ auth }: { auth: MobileAuth }) {
  const initialUrl = Linking.useURL();
  const [wallet, setWallet] = useState<MobileWalletSession | null>(null);
  const [claimToken, setClaimToken] = useState("");
  const [receipt, setReceipt] = useState<MerchantReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);

  const mintStatus = receipt?.mintStatus || "none";
  const creditLabel = useMemo(() => {
    if (receipt?.creditImpact?.eligible) return `$${receipt.creditImpact.unlockedCreditUsd} unlocked`;
    if (mintStatus === "minted") return "Indexing";
    if (mintStatus === "prepared") return "Prepared";
    if (mintStatus === "ready") return "Ready to mint";
    return "Locked";
  }, [mintStatus, receipt?.creditImpact]);

  const withBusy = useCallback(async (task: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await task();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }, []);

  async function sendLoginCode() {
    if (!auth.configured || !auth.sendCode) {
      setMessage("Set EXPO_PUBLIC_PRIVY_APP_ID and EXPO_PUBLIC_PRIVY_CLIENT_ID before mobile login.");
      return;
    }
    if (!email.trim()) {
      setMessage("Enter an email first.");
      return;
    }
    await withBusy(async () => {
      await auth.sendCode?.(email.trim());
      setCodeSent(true);
      setMessage("Privy code sent.");
    });
  }

  async function submitLoginCode() {
    if (!auth.loginWithCode) return;
    if (!email.trim() || !otpCode.trim()) {
      setMessage("Enter email and Privy code.");
      return;
    }
    await withBusy(async () => {
      await auth.loginWithCode?.(email.trim(), otpCode.trim());
      setOtpCode("");
      setMessage("Signed in with Privy.");
    });
  }

  async function connectWallet() {
    await withBusy(async () => {
      const session = await connectMobileWallet();
      setWallet(session);
      setMessage("Solana wallet connected through Mobile Wallet Adapter.");
    });
  }

  const loadReceiptPreview = useCallback(async (nextToken: string) => {
    const token = nextToken.trim();
    if (!token) {
      setMessage("Paste a Jiagon claim token or open a jiagon://claim/{token} link.");
      return;
    }

    await withBusy(async () => {
      const payload = await getMerchantReceipt(token);
      setReceipt(payload.receipt);
      setMessage(payload.receipt.status === "claimed" ? "Receipt loaded. Sign in to claim or mint." : "Receipt loaded from Jiagon.");
    });
  }, [withBusy]);

  useEffect(() => {
    const incomingToken = tokenFromUrl(initialUrl);
    if (incomingToken) {
      setClaimToken(incomingToken);
      void loadReceiptPreview(incomingToken);
    }
  }, [initialUrl, loadReceiptPreview]);

  async function claimReceipt() {
    if (!auth.authenticated) {
      setMessage("Sign in with Privy before claiming this receipt.");
      return;
    }
    const accessToken = await auth.getAccessToken();
    if (!accessToken) {
      setMessage("Privy access token is required.");
      return;
    }
    if (!claimToken.trim()) {
      setMessage("Paste a Jiagon claim token first.");
      return;
    }

    await withBusy(async () => {
      const payload = await claimMerchantReceipt({
        token: claimToken.trim(),
        accessToken,
        walletAddress: wallet?.address,
        userLabel: auth.label,
      });
      setReceipt({
        ...payload.receipt,
        mintStatus: payload.receipt.mintStatus || "ready",
        creditImpact: payload.receipt.creditImpact || {
          eligible: false,
          unlockedCreditUsd: 0,
          reason: "Merchant receipt must be minted as a Bubblegum cNFT before credit unlock.",
        },
      });
      setMessage("Receipt claimed into Jiagon Passport.");
    });
  }

  async function mintReceipt() {
    if (!auth.authenticated) {
      setMessage("Sign in with Privy before minting.");
      return;
    }
    if (!wallet) {
      setMessage("Connect a Solana wallet first.");
      return;
    }
    if (!receipt) {
      setMessage("Load and claim a receipt before minting.");
      return;
    }
    const accessToken = await auth.getAccessToken();
    if (!accessToken) {
      setMessage("Privy access token is required.");
      return;
    }

    await withBusy(async () => {
      const payload = await mintMerchantReceipt({
        accessToken,
        receipt,
        solanaOwner: wallet.address,
      });
      setReceipt({
        ...receipt,
        mintStatus: payload.status === "minted" ? "minted" : "prepared",
        credentialId: payload.credentialId,
        credentialChain: payload.credentialChain,
        standard: payload.standard,
        dataHash: payload.dataHash,
        storageUri: payload.storageUri,
        solanaOwner: payload.solanaOwner,
        credentialTx: payload.credentialTx || null,
        explorerUrl: payload.explorerUrl || null,
        assetExplorerUrl: payload.assetExplorerUrl || null,
        creditImpact: payload.creditImpact,
      });
      setMessage(payload.note || (payload.status === "minted" ? "Bubblegum cNFT minted." : "Bubblegum mint prepared."));
    });
  }

  const receiptTitle = receipt ? `${receipt.merchantName} · $${receipt.amountUsd}` : "No receipt loaded";
  const walletReady = Boolean(wallet?.address);
  const receiptClaimed = receipt?.status === "claimed" || mintStatus === "ready" || mintStatus === "prepared";
  const canClaim = auth.ready && auth.authenticated && Boolean(claimToken.trim()) && !busy;
  const canMint = canClaim && walletReady && Boolean(receipt) && receiptClaimed && mintStatus !== "minted";

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Text style={styles.kicker}>JIAGON MOBILE</Text>
          <Text style={styles.title}>Receipt Passport</Text>
          <Text style={styles.subtitle}>
            Tap NFC, sign in, claim a merchant receipt, mint it as a Solana Bubblegum cNFT, then use it for credit.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Privy account</Text>
          <Text style={styles.cardTitle}>{auth.authenticated ? "Signed in" : "Sign in"}</Text>
          <Text style={styles.receiptMeta}>{auth.error || auth.label}</Text>
          {!auth.authenticated ? (
            <>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                inputMode="email"
                onChangeText={setEmail}
                placeholder="Email"
                placeholderTextColor="#8B8170"
                style={styles.input}
                value={email}
              />
              {codeSent ? (
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  inputMode="numeric"
                  onChangeText={setOtpCode}
                  placeholder="Privy code"
                  placeholderTextColor="#8B8170"
                  style={styles.input}
                  value={otpCode}
                />
              ) : null}
              <TouchableOpacity style={styles.primaryButton} disabled={busy || !auth.ready} onPress={codeSent ? submitLoginCode : sendLoginCode}>
                <Text style={styles.primaryButtonText}>{codeSent ? "Verify code" : "Send login code"}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={styles.secondaryButton}
              disabled={busy}
              onPress={() => {
                setCodeSent(false);
                setEmail("");
                setOtpCode("");
                void auth.logout?.();
              }}
            >
              <Text style={styles.secondaryButtonText}>Logout</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Solana wallet</Text>
          <Text style={styles.cardTitle}>{wallet?.address ? shortAddress(wallet.address) : "Not connected"}</Text>
          <TouchableOpacity style={styles.primaryButton} disabled={busy} onPress={connectWallet}>
            <Text style={styles.primaryButtonText}>{walletReady ? "Reconnect with MWA" : "Connect with MWA"}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>NFC claim</Text>
          <Text style={styles.cardTitle}>Raposa station</Text>
          <Text style={styles.mono}>{RAPOSA_STATION}</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setClaimToken}
            placeholder="Paste jgr_ claim token"
            placeholderTextColor="#8B8170"
            style={styles.input}
            value={claimToken}
          />
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.secondaryButton} disabled={busy} onPress={() => void loadReceiptPreview(claimToken)}>
              <Text style={styles.secondaryButtonText}>Load</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryButton} disabled={!canClaim} onPress={claimReceipt}>
              <Text style={styles.primaryButtonText}>Claim receipt</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Passport</Text>
          <View style={styles.receiptRow}>
            <View style={styles.receiptText}>
              <Text style={styles.cardTitle}>{receiptTitle}</Text>
              <Text style={styles.receiptMeta}>
                {receipt ? `${receipt.receiptNumber || receipt.id} · ${receipt.status} · ${mintStatus}` : "Tap NFC or paste a token first"}
              </Text>
            </View>
            <Text style={styles.badge}>{creditLabel}</Text>
          </View>
          <TouchableOpacity style={styles.primaryButton} disabled={!canMint} onPress={mintReceipt}>
            <Text style={styles.primaryButtonText}>{mintStatus === "prepared" ? "Retry real mint" : "Mint Bubblegum cNFT"}</Text>
          </TouchableOpacity>
          {receipt?.assetExplorerUrl || receipt?.explorerUrl ? (
            <Text style={styles.mono}>{receipt.assetExplorerUrl || receipt.explorerUrl}</Text>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Credit</Text>
          <Text style={styles.cardTitle}>{creditLabel}</Text>
          <Text style={styles.subtitle}>
            Credit only unlocks after the API confirms a minted Bubblegum receipt and the server-side credit index updates.
          </Text>
        </View>

        {busy && <ActivityIndicator color="#173B2C" />}
        {message ? <Text style={styles.message}>{message}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function shortAddress(address: string) {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#F8F5EA",
  },
  container: {
    gap: 14,
    padding: 20,
    paddingBottom: 36,
  },
  header: {
    gap: 8,
    paddingVertical: 14,
  },
  kicker: {
    color: "#6D6558",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
  },
  title: {
    color: "#173B2C",
    fontSize: 42,
    fontWeight: "700",
    lineHeight: 46,
  },
  subtitle: {
    color: "#6D6558",
    fontSize: 14,
    lineHeight: 21,
  },
  card: {
    backgroundColor: "#FFFCF2",
    borderColor: "#DDD4C3",
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  cardLabel: {
    color: "#6D6558",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  cardTitle: {
    color: "#173B2C",
    fontSize: 20,
    fontWeight: "800",
  },
  mono: {
    color: "#173B2C",
    fontFamily: "monospace",
    fontSize: 11,
    lineHeight: 17,
  },
  input: {
    backgroundColor: "#F8F5EA",
    borderColor: "#DDD4C3",
    borderRadius: 10,
    borderWidth: 1,
    color: "#173B2C",
    fontSize: 14,
    minHeight: 46,
    paddingHorizontal: 12,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 10,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#173B2C",
    borderRadius: 10,
    flexGrow: 1,
    minHeight: 46,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  primaryButtonText: {
    color: "#FFFDF5",
    fontSize: 14,
    fontWeight: "900",
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#E7F1E8",
    borderColor: "#B7CAB8",
    borderRadius: 10,
    borderWidth: 1,
    flexGrow: 1,
    minHeight: 46,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  secondaryButtonText: {
    color: "#173B2C",
    fontSize: 14,
    fontWeight: "900",
  },
  receiptRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  receiptText: {
    flex: 1,
    minWidth: 0,
  },
  receiptMeta: {
    color: "#6D6558",
    fontSize: 12,
    lineHeight: 18,
  },
  badge: {
    backgroundColor: "#E7F1E8",
    borderColor: "#B7CAB8",
    borderRadius: 999,
    borderWidth: 1,
    color: "#173B2C",
    fontSize: 11,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  message: {
    backgroundColor: "#FFF7D8",
    borderColor: "#E2D088",
    borderRadius: 10,
    borderWidth: 1,
    color: "#4E4225",
    fontSize: 13,
    lineHeight: 19,
    padding: 12,
  },
});

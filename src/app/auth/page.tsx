"use client";

import { useEffect, useRef } from "react";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";

type StoredSession = {
  userLabel?: string;
  walletLabel?: string;
  walletAddress?: string;
};

const storageKey = "jiagon:privy-session";

const shortAddress = (address?: string) => {
  if (!address) return undefined;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
};

const getPrimaryWallet = (user: unknown) => {
  const typedUser = user as {
    wallet?: { address?: string };
    linkedAccounts?: Array<{ type?: string; address?: string }>;
  } | null;

  return (
    typedUser?.wallet?.address ||
    typedUser?.linkedAccounts?.find((account) => account.type === "wallet")?.address
  );
};

const getUserLabel = (user: unknown, walletAddress?: string) => {
  const typedUser = user as {
    id?: string;
    email?: { address?: string };
    phone?: { number?: string };
    google?: { email?: string };
    linkedAccounts?: Array<{
      type?: string;
      email?: string;
      address?: string;
      phoneNumber?: string;
    }>;
  } | null;

  const linkedEmail = typedUser?.linkedAccounts?.find((account) => account.email)?.email;
  const linkedPhone = typedUser?.linkedAccounts?.find((account) => account.phoneNumber)?.phoneNumber;

  return (
    typedUser?.email?.address ||
    typedUser?.google?.email ||
    linkedEmail ||
    typedUser?.phone?.number ||
    linkedPhone ||
    shortAddress(walletAddress) ||
    typedUser?.id
  );
};

function AuthFlow() {
  const { ready, authenticated, user, login } = usePrivy();
  const loginStarted = useRef(false);

  useEffect(() => {
    if (!ready || authenticated || loginStarted.current) return;

    loginStarted.current = true;
    login();
  }, [authenticated, login, ready]);

  useEffect(() => {
    if (!ready || !authenticated) return;

    const walletAddress = getPrimaryWallet(user);
    const session: StoredSession = {
      userLabel: getUserLabel(user, walletAddress),
      walletLabel: shortAddress(walletAddress),
      walletAddress,
    };

    window.localStorage.setItem(storageKey, JSON.stringify(session));
    window.location.replace("/");
  }, [authenticated, ready, user]);

  return (
    <main style={{
      minHeight: "100vh",
      display: "grid",
      placeItems: "center",
      background: "oklch(0.965 0.008 92)",
      color: "oklch(0.235 0.018 135)",
      fontFamily: "Inter, -apple-system, system-ui, sans-serif",
    }}>
      <div style={{ textAlign: "center" }}>
        <div style={{
          fontFamily: "Georgia, serif",
          fontStyle: "italic",
          fontSize: 42,
          marginBottom: 10,
        }}>Jiagon</div>
        <div style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 11,
          letterSpacing: 1,
          textTransform: "uppercase",
          opacity: 0.65,
        }}>Opening Privy</div>
      </div>
    </main>
  );
}

export default function AuthPage() {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  if (!appId) {
    return (
      <main style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "oklch(0.965 0.008 92)",
        color: "oklch(0.235 0.018 135)",
        fontFamily: "Inter, -apple-system, system-ui, sans-serif",
      }}>
        <div style={{ textAlign: "center", maxWidth: 320, padding: 24 }}>
          <div style={{
            fontFamily: "Georgia, serif",
            fontStyle: "italic",
            fontSize: 38,
            marginBottom: 10,
          }}>Jiagon</div>
          <div style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 11,
            letterSpacing: 1,
            textTransform: "uppercase",
            opacity: 0.65,
            lineHeight: 1.6,
          }}>Privy app id is required for wallet login.</div>
        </div>
      </main>
    );
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["wallet", "email", "google"],
        appearance: {
          theme: "light",
          accentColor: "#A9573D",
          showWalletLoginFirst: true,
          walletChainType: "solana-only",
          walletList: [
            "phantom",
            "solflare",
            "backpack",
            "jupiter",
            "detected_solana_wallets",
            "wallet_connect_qr_solana",
          ],
        },
        embeddedWallets: {
          solana: { createOnLogin: "off" },
          showWalletUIs: false,
        },
        externalWallets: {
          solana: { connectors: toSolanaWalletConnectors({ shouldAutoConnect: false }) },
        },
      }}
    >
      <AuthFlow />
    </PrivyProvider>
  );
}

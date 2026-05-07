# Jiagon Mobile

Android APK shell for the Solana Mobile Track.

## Run Locally

```bash
export EXPO_PUBLIC_PRIVY_APP_ID='your-privy-app-id'
export EXPO_PUBLIC_PRIVY_CLIENT_ID='your-privy-mobile-client-id'
pnpm install
pnpm --filter @jiagon/mobile start
```

`EXPO_PUBLIC_PRIVY_APP_ID` must be the Privy mobile app id. The mobile build
does not fall back to `NEXT_PUBLIC_PRIVY_APP_ID`, so CI and local Android builds
should fail setup visibly instead of silently bundling the web app id.

Optional override:

```bash
export EXPO_PUBLIC_JIAGON_API_BASE_URL='https://jiagon.vercel.app'
export EXPO_PUBLIC_SOLANA_CLUSTER='devnet'
```

## Android Build Path

```bash
pnpm --filter @jiagon/mobile prebuild
pnpm --filter @jiagon/mobile android
```

For hackathon submission, use Expo/EAS or a local Android release build to produce an APK.

## Demo Role

The mobile app is the customer receipt passport:

```text
NFC or QR claim
-> connect Solana wallet with Mobile Wallet Adapter
-> claim receipt
-> mint Bubblegum cNFT
-> show receipt-backed credit preview
```

The claim and mint buttons call the same Privy-protected Jiagon APIs used by the web claim page. If Bubblegum minting is not configured on the server, the API returns `prepared` instead of claiming an onchain mint.

The merchant POS/operator surface remains the web dashboard at `https://jiagon.vercel.app/merchant`.

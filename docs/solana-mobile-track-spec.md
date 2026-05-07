# Jiagon Solana Mobile Track Spec

## Goal

Ship a functional Android APK for the Solana Mobile Track that makes Jiagon feel native to a phone:

```text
tap NFC or scan QR
-> claim a merchant receipt
-> connect a Solana wallet with Mobile Wallet Adapter
-> mint a Bubblegum receipt cNFT
-> show receipt-backed credit eligibility
```

The mobile app is the customer-facing receipt passport. The merchant dashboard remains web-first.

## Hackathon Fit

The track asks for an Android app that meaningfully uses Solana and uses the Solana Mobile stack, including Mobile Wallet Adapter for wallet signing.

Jiagon fits by turning a real-world merchant receipt into a Solana-native credential:

- Mobile-native input: NFC claim station and QR fallback.
- Solana action: Bubblegum compressed NFT receipt mint.
- Wallet UX: Mobile Wallet Adapter connect and signing path.
- Consumer utility: private receipt passport and purpose-bound credit preview.

## MVP Scope

### P0: APK Shell

- Expo/React Native Android app under `apps/mobile`.
- App home is the customer receipt passport, not a landing page.
- Mobile screens:
  - Passport
  - Claim
  - Mint
  - Credit
- App can be built as an Android APK with Expo/EAS.

### P0: Mobile Wallet Adapter

- Use `@solana-mobile/mobile-wallet-adapter-protocol-web3js`.
- Connect wallet from the mobile app.
- Store wallet address in local app state.
- Use the wallet address as the Bubblegum leaf owner.

### P0: Claim Entry

- Support manual claim URL/token input for emulator demos.
- Support native deep link shape:

```text
jiagon://claim/{token}
```

- NFC sticker can keep pointing to the web station for now:

```text
https://jiagon.vercel.app/tile/raposa-coffee?nfc=1
```

The app can still be used after the web station resolves a claim token.

### P1: Receipt Claim API

- POST `/api/merchant/receipts/{token}/claim` with Privy/session strategy.
- Mobile uses `@privy-io/expo` email OTP auth and sends the Privy access token as a Bearer token.
- Store claimed receipt in the mobile passport.
- Keep the claim state honest:
  - `claimed`: offchain merchant receipt claimed by the user.
  - `prepared`: mint payload is ready, no onchain cNFT.
  - `minted`: Bubblegum cNFT transaction confirmed.

### P1: Bubblegum Mint

- POST `/api/solana/merchant-receipts/mint`.
- Pass the MWA wallet address as `solanaOwner`.
- Native mobile requests are accepted only after the server verifies the Privy bearer token.
- Display the returned asset id and Solscan link.
- Do not show credit unlocked unless API returns `creditImpact.eligible === true`.

### P2: Credit Preview

- Show unlocked credit as a preview from minted receipt state.
- Keep draw/repay web route out of the mobile P0 unless the devnet vault is funded and readiness is green.

## Demo Flow

```text
1. Staff opens web /merchant.
2. Customer orders through Telegram or /tile/raposa-coffee.
3. Staff takes normal counter payment.
4. Staff marks the order fulfilled.
5. Customer taps NFC station.
6. Customer opens Jiagon mobile APK and enters/receives the claim token.
7. Customer connects Solana wallet through Mobile Wallet Adapter.
8. Receipt is claimed into Passport.
9. Customer mints Bubblegum receipt cNFT.
10. App shows minted receipt and credit preview.
```

## Out Of Scope For The First APK

- Full merchant POS replacement.
- Live credit vault draw/repay.
- Solayer proof upload.
- dApp Store production submission.
- Mainnet minting.

## Submission Checklist

- Android APK.
- GitHub repository code.
- Demo video showing:
  - Android app open.
  - Wallet connect through Mobile Wallet Adapter.
  - Claim receipt flow.
  - Bubblegum mint or readiness-gated prepare state.
  - Receipt-backed credit preview.
- Short paragraph:

```text
Jiagon mobile is the passport surface for verified purchase memory. A user or agent can tap NFC at a merchant, claim a signed receipt, mint it as a Solana Bubblegum cNFT, and use verified receipt history as the input for purpose-bound credit.
```

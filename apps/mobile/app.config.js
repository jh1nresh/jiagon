const apiBaseUrl = process.env.EXPO_PUBLIC_JIAGON_API_BASE_URL || "https://jiagon.vercel.app";
const privyAppId = process.env.EXPO_PUBLIC_PRIVY_APP_ID || "";
const privyClientId = process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID || "";
const solanaCluster = process.env.EXPO_PUBLIC_SOLANA_CLUSTER || "devnet";

module.exports = {
  expo: {
    name: "Jiagon",
    slug: "jiagon-mobile",
    scheme: "jiagon",
    version: "0.1.0",
    orientation: "portrait",
    icon: "assets/jiagon-logo-mark.png",
    userInterfaceStyle: "light",
    assetBundlePatterns: ["**/*"],
    android: {
      package: "app.jiagon.mobile",
      versionCode: 1,
      adaptiveIcon: {
        foregroundImage: "assets/jiagon-logo-mark.png",
        backgroundColor: "#F8F5EA",
      },
      intentFilters: [
        {
          action: "VIEW",
          autoVerify: false,
          data: [{ scheme: "jiagon", host: "claim" }],
          category: ["BROWSABLE", "DEFAULT"],
        },
      ],
    },
    extra: {
      apiBaseUrl,
      privyAppId,
      privyClientId,
      solanaCluster,
    },
    plugins: ["expo-secure-store", "expo-web-browser"],
  },
};

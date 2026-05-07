import Constants from "expo-constants";

type Extra = {
  apiBaseUrl?: string;
  privyAppId?: string;
  privyClientId?: string;
  solanaCluster?: string;
};

const extra = (Constants.expoConfig?.extra || {}) as Extra;

function optionalConfigValue(value: string | undefined, name: string) {
  if (value?.trim()) return value.trim();
  console.warn(`[jiagon] ${name} is not configured.`);
  return "";
}

export const jiagonConfig = {
  apiBaseUrl: extra.apiBaseUrl || "https://jiagon.vercel.app",
  privyAppId: optionalConfigValue(extra.privyAppId, "EXPO_PUBLIC_PRIVY_APP_ID"),
  privyClientId: optionalConfigValue(extra.privyClientId, "EXPO_PUBLIC_PRIVY_CLIENT_ID"),
  solanaCluster: extra.solanaCluster || "devnet",
};

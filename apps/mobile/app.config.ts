import type { ConfigContext, ExpoConfig } from "expo/config";

const supportedEnvironments = ["local", "test", "preview", "staging", "production"] as const;
type AppEnvironment = (typeof supportedEnvironments)[number];

function appEnvironment(): AppEnvironment {
  const value = process.env.EXPO_PUBLIC_APP_ENV ?? "local";
  if (supportedEnvironments.includes(value as AppEnvironment)) return value as AppEnvironment;
  throw new Error(`Unsupported EXPO_PUBLIC_APP_ENV: ${value}`);
}

function productionIdentifier(variable: string) {
  const value = process.env[variable]?.trim();
  if (!value) throw new Error(`${variable} is required for a Production mobile build.`);
  return value;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const environment = appEnvironment();
  const production = environment === "production";
  return {
    ...config,
    name: "攤點通",
    slug: "stallorder-business",
    owner: process.env.EXPO_OWNER || undefined,
    version: "0.1.0",
    orientation: "default",
    userInterfaceStyle: "automatic",
    scheme: production ? "stallorder-business" : `stallorder-business-${environment}`,
    plugins: ["expo-router", "expo-secure-store", "expo-status-bar", ...(environment === "local" ? ["./plugins/local-loopback.cjs"] : [])],
    experiments: { typedRoutes: true },
    ios: {
      supportsTablet: true,
      bundleIdentifier: production
        ? productionIdentifier("EXPO_IOS_BUNDLE_IDENTIFIER")
        : `com.qidaigo.stallorder.business.${environment}`,
    },
    android: {
      package: production
        ? productionIdentifier("EXPO_ANDROID_PACKAGE")
        : `com.qidaigo.stallorder.business.${environment}`,
    },
    extra: {
      appEnvironment: environment,
      apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3026",
    },
  };
};

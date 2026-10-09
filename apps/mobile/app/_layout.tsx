import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NativeQueryProvider } from "../src/operations/query";
import { SessionProvider } from "../src/auth/session-context";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <NativeQueryProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }} />
        </NativeQueryProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}

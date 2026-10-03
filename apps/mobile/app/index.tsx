import { Redirect } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useSession } from "../src/auth/session-context";

export default function IndexScreen() {
  const { loading, session, bootstrapData, error, refresh, signOut } = useSession();
  if (!loading && bootstrapData) return <Redirect href="/home" />;
  if (!loading && !session) return <Redirect href="/login" />;
  if (!loading) {
    return (
      <View style={styles.container} accessibilityRole="alert">
        <Text style={styles.title}>尚未取得工作區</Text>
        <Text style={styles.error}>{error ?? "請確認網路後再試一次。"}</Text>
        <Pressable accessibilityRole="button" onPress={() => void refresh()} style={styles.button}>
          <Text style={styles.buttonText}>重新連線</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => void signOut()} style={styles.button}>
          <Text style={styles.buttonText}>登出並重新登入</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={styles.container} accessibilityLiveRegion="polite">
      <ActivityIndicator size="large" color="#0f766e" />
      <Text style={styles.label}>正在確認安全 Session…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    backgroundColor: "#f6f7f4",
  },
  label: { color: "#334155", fontSize: 16 },
  title: { color: "#0f172a", fontSize: 20, fontWeight: "800", textAlign: "center" },
  error: { color: "#b91c1c", fontSize: 14, lineHeight: 21, textAlign: "center" },
  button: {
    minHeight: 50,
    minWidth: 140,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    backgroundColor: "#0f766e",
    paddingHorizontal: 20,
  },
  buttonText: { color: "#ffffff", fontSize: 16, fontWeight: "800" },
});

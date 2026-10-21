import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../src/auth/session-context";

export default function LoginScreen() {
  const { loading, error, signIn } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function submit() {
    try {
      await signIn(email, password);
      router.replace("/home");
    } catch {
      // SessionProvider exposes the sanitized user-facing error.
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.brandBlock}>
          <Text style={styles.eyebrow}>攤點通</Text>
          <Text style={styles.title}>把現場營運，放進手掌裡</Text>
          <Text style={styles.subtitle}>使用攤點通帳號登入，查看您有權管理的攤位。</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.label}>電子郵件</Text>
          <TextInput
            accessibilityLabel="電子郵件"
            autoCapitalize="none"
            autoComplete="email"
            inputMode="email"
            onChangeText={setEmail}
            placeholder="name@example.com"
            style={styles.input}
            value={email}
          />
          <Text style={styles.label}>密碼</Text>
          <TextInput
            accessibilityLabel="密碼"
            autoCapitalize="none"
            autoComplete="current-password"
            onChangeText={setPassword}
            placeholder="輸入密碼"
            secureTextEntry
            style={styles.input}
            value={password}
          />
          {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={loading || !email.trim() || !password}
            onPress={() => void submit()}
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed, loading && styles.buttonDisabled]}
          >
            {loading ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.buttonText}>安全登入</Text>}
          </Pressable>
          <Text style={styles.footnote}>目前提供訂單、通知與商家申請的授權查詢。</Text>
        </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#0f3d3a" },
  container: { flexGrow: 1, justifyContent: "center", padding: 24, gap: 28 },
  brandBlock: { gap: 10 },
  eyebrow: { color: "#99f6e4", fontSize: 12, fontWeight: "800", letterSpacing: 1.8 },
  title: { color: "#ffffff", fontSize: 32, fontWeight: "800", lineHeight: 40 },
  subtitle: { color: "#d1fae5", fontSize: 16, lineHeight: 24 },
  card: { backgroundColor: "#ffffff", borderRadius: 24, padding: 22, gap: 10 },
  label: { color: "#1e293b", fontSize: 15, fontWeight: "700", marginTop: 4 },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 14,
    paddingHorizontal: 16,
    color: "#0f172a",
    fontSize: 16,
  },
  error: { color: "#b91c1c", fontSize: 14, lineHeight: 20 },
  button: {
    minHeight: 54,
    marginTop: 8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: "#0f766e",
  },
  buttonPressed: { backgroundColor: "#115e59" },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { color: "#ffffff", fontSize: 17, fontWeight: "800" },
  footnote: { color: "#64748b", fontSize: 13, lineHeight: 19, marginTop: 4 },
});

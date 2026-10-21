import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useNativeScope, useNativeRead } from "../../src/operations/query";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { orderDetail } from "../../src/api/client";
import { useSession } from "../../src/auth/session-context";
import {
  formatDateTime,
  formatMoney,
  mobileFulfillmentTypeLabels,
  mobileOrderItemStatusLabels,
  mobileOrderStatusLabels,
  mobilePaymentStatusLabels,
} from "../../src/operations/presentation";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default function OrderDetailScreen() {
  const params = useLocalSearchParams<{ orderId?: string | string[]; stallId?: string | string[] }>();
  const orderId = firstParam(params.orderId);
  const stallId = firstParam(params.stallId);
  const { bootstrapData, runAuthenticated } = useSession();
  const workspace = bootstrapData?.workspaces.find((candidate) => (
    candidate.stalls.some((candidateStall) => candidateStall.id === stallId)
  ));
  const stall = workspace?.stalls.find((candidate) => candidate.id === stallId);
  const authorizedStallId = stall?.id;
  const scope = useNativeScope(workspace?.id);
  const result = useNativeRead(stall?.permissions.includes("VIEW_ORDERS")&&orderId?scope.data:undefined, "native-order-detail", {stallId,orderId}, () => runAuthenticated((token,deviceId) => orderDetail(token,deviceId,authorizedStallId!,orderId!)));
  const data = result.error ? undefined : result.data;
  const loading = result.isFetching;
  const error = result.error?.message ?? scope.error?.message;
  if (!bootstrapData) return <Redirect href="/" />;
  if (!stall || !stall.permissions.includes("VIEW_ORDERS") || !orderId) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerCard} accessibilityRole="alert">
          <Text style={styles.errorTitle}>無法開啟此訂單</Text>
          <Text style={styles.errorBody}>訂單識別或授權攤位不正確；請返回訂單清單後重試。</Text>
          <Pressable accessibilityRole="button" onPress={() => router.replace("/home")} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>返回營運首頁</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const order = data?.order.id === orderId ? data.order : undefined;
  const currency = workspace?.defaultCurrency ?? "TWD";

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading && Boolean(order)} onRefresh={() => void result.refetch()} />}
      >
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="返回訂單清單" onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backButtonText}>返回</Text>
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>攤點通・唯讀訂單</Text>
            <Text style={styles.title}>{order ? `#${order.orderNo}` : "訂單明細"}</Text>
            <Text style={styles.subtitle}>{stall.name}</Text>
          </View>
        </View>

        {error ? (
          <View style={styles.errorCard} accessibilityRole="alert">
            <Text style={styles.errorTitle}>訂單同步暫時失敗</Text>
            <Text style={styles.errorBody}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={() => void result.refetch()} style={styles.retryButton}>
              <Text style={styles.retryButtonText}>重新整理</Text>
            </Pressable>
          </View>
        ) : null}

        {loading && !order ? (
          <View style={styles.loading} accessibilityLiveRegion="polite">
            <ActivityIndicator size="large" color="#0f766e" />
            <Text style={styles.loadingText}>正在讀取伺服器訂單狀態…</Text>
          </View>
        ) : order ? (
          <>
            <View style={styles.summaryCard}>
              <View style={styles.summaryTopRow}>
                <Text style={styles.status}>{mobileOrderStatusLabels[order.status]}</Text>
                {order.isTest ? <Text style={styles.testBadge}>測試訂單</Text> : null}
              </View>
              <Text style={styles.total}>{formatMoney(order.total, currency)}</Text>
              <InfoRow label="顧客" value={order.customerName || "未提供"} />
              <InfoRow label="取餐方式" value={mobileFulfillmentTypeLabels[order.fulfillmentType]} />
              <InfoRow label="付款狀態" value={mobilePaymentStatusLabels[order.paymentStatus]} />
              <InfoRow label="桌位" value={order.tableLabel ?? "不適用"} />
              <InfoRow label="來源" value={order.isTest ? "測試訂單" : order.source === "QR_MENU" ? "掃碼點餐" : "門市訂單"} />
              <InfoRow label="建立時間" value={formatDateTime(order.createdAt)} />
              <InfoRow label="最後更新" value={formatDateTime(order.updatedAt)} />
              {order.note ? <View style={styles.note}><Text style={styles.noteLabel}>訂單備註</Text><Text style={styles.noteText}>{order.note}</Text></View> : null}
            </View>

            <View style={styles.itemSection}>
              <Text style={styles.sectionTitle}>品項（{order.itemCount}）</Text>
              {order.items.map((item) => (
                <View key={item.id} style={styles.itemCard}>
                  <View style={styles.itemTopRow}>
                    <Text style={styles.itemName}>{item.quantity} × {item.name}</Text>
                    <Text style={styles.itemPrice}>{formatMoney(item.unitPrice * item.quantity, currency)}</Text>
                  </View>
                  <Text style={styles.itemStatus}>{mobileOrderItemStatusLabels[item.status]}</Text>
                  {item.noteOptions.map((option, index) => (
                    <Text key={`${option.groupName}-${option.optionName}-${index}`} style={styles.option}>
                      {option.groupName}：{option.optionName}{option.priceDelta ? ` (${formatMoney(option.priceDelta, currency)})` : ""}
                    </Text>
                  ))}
                  {item.note ? <Text style={styles.itemNote}>備註：{item.note}</Text> : null}
                </View>
              ))}
            </View>

            <View style={styles.readOnlyNotice}>
              <Text style={styles.readOnlyTitle}>唯讀安全邊界</Text>
              <Text style={styles.readOnlyBody}>本畫面不提供接單、改狀態、退款或付款操作；所有狀態均以伺服器回傳為準。</Text>
              <Text style={styles.generatedAt}>伺服器更新：{formatDateTime(data?.generatedAt ?? order.updatedAt)}</Text>
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#f6f7f4" },
  content: { padding: 20, paddingBottom: 44, gap: 16 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  headerCopy: { flex: 1, gap: 2 },
  backButton: { minHeight: 48, minWidth: 64, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "#e2e8f0" },
  backButtonText: { color: "#334155", fontWeight: "800" },
  eyebrow: { color: "#0f766e", fontSize: 11, fontWeight: "900", letterSpacing: 1.2 },
  title: { color: "#0f172a", fontSize: 26, fontWeight: "800" },
  subtitle: { color: "#64748b", fontSize: 13 },
  centerCard: { flex: 1, margin: 20, justifyContent: "center", gap: 12 },
  errorCard: { borderRadius: 18, backgroundColor: "#fee2e2", padding: 16, gap: 8 },
  errorTitle: { color: "#991b1b", fontSize: 17, fontWeight: "800" },
  errorBody: { color: "#b91c1c", fontSize: 14, lineHeight: 20 },
  retryButton: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "#ffffff" },
  retryButtonText: { color: "#991b1b", fontWeight: "800" },
  loading: { minHeight: 220, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { color: "#475569", fontSize: 15 },
  summaryCard: { borderRadius: 20, borderWidth: 1, borderColor: "#e2e8f0", backgroundColor: "#ffffff", padding: 18, gap: 10 },
  summaryTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  status: { color: "#115e59", backgroundColor: "#dff7f2", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, fontSize: 14, fontWeight: "900" },
  testBadge: { color: "#92400e", backgroundColor: "#fef3c7", borderRadius: 9, paddingHorizontal: 9, paddingVertical: 5, fontSize: 12, fontWeight: "800" },
  total: { color: "#0f172a", fontSize: 30, fontWeight: "900", marginVertical: 3 },
  infoRow: { minHeight: 34, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, borderTopWidth: 1, borderTopColor: "#f1f5f9", paddingTop: 9 },
  infoLabel: { color: "#64748b", fontSize: 13 },
  infoValue: { flex: 1, color: "#334155", fontSize: 14, fontWeight: "700", textAlign: "right" },
  note: { borderRadius: 12, backgroundColor: "#f8fafc", padding: 12, gap: 4 },
  noteLabel: { color: "#475569", fontSize: 12, fontWeight: "800" },
  noteText: { color: "#334155", fontSize: 14, lineHeight: 20 },
  itemSection: { gap: 10 },
  sectionTitle: { color: "#0f172a", fontSize: 19, fontWeight: "800" },
  itemCard: { borderRadius: 17, borderWidth: 1, borderColor: "#e2e8f0", backgroundColor: "#ffffff", padding: 16, gap: 6 },
  itemTopRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  itemName: { flex: 1, color: "#0f172a", fontSize: 16, fontWeight: "800" },
  itemPrice: { color: "#0f172a", fontSize: 15, fontWeight: "800" },
  itemStatus: { color: "#0f766e", fontSize: 12, fontWeight: "800" },
  option: { color: "#64748b", fontSize: 13, lineHeight: 18 },
  itemNote: { color: "#92400e", backgroundColor: "#fef3c7", borderRadius: 9, padding: 9, fontSize: 13, lineHeight: 18 },
  readOnlyNotice: { borderRadius: 17, backgroundColor: "#dff7f2", padding: 16, gap: 5 },
  readOnlyTitle: { color: "#134e4a", fontSize: 16, fontWeight: "800" },
  readOnlyBody: { color: "#115e59", fontSize: 13, lineHeight: 19 },
  generatedAt: { color: "#0f766e", fontSize: 12, marginTop: 3 },
  primaryButton: { minHeight: 50, alignItems: "center", justifyContent: "center", borderRadius: 15, backgroundColor: "#0f766e", paddingHorizontal: 18 },
  primaryButtonText: { color: "#ffffff", fontSize: 16, fontWeight: "800" },
});

import {mobileOrderStatusSchema,type MobileOrderListResponse,type MobileOrderStatus} from "@stallorder/contracts/mobile/v1";
import {operationsKey} from "@stallorder/contracts/operations/v1/query-key";
import {FlashList} from "@shopify/flash-list";
import {useInfiniteQuery,useQueryClient} from "@tanstack/react-query";
import {Redirect,router,useLocalSearchParams} from "expo-router";
import {useState} from "react";
import {ActivityIndicator,Pressable,StyleSheet,Text,TextInput,View} from "react-native";
import {SafeAreaView} from "react-native-safe-area-context";
import {orders} from "../src/api/client";
import {useSession} from "../src/auth/session-context";
import {nativeRead,useNativeScope,useReadCadence} from "../src/operations/query";
import {deduplicateAuthoritativeOrders,formatDateTime,formatMoney,mobileFulfillmentTypeLabels,mobileOrderStatusLabels,mobilePaymentStatusLabels} from "../src/operations/presentation";
type OrderSummary=MobileOrderListResponse["orders"][number];
const filters:{label:string;statuses:MobileOrderStatus[]}[]=[{label:"全部",statuses:mobileOrderStatusSchema.options},{label:"進行中",statuses:["WAITING_CONFIRMATION","CONFIRMED","PREPARING","PACKING","READY"]},{label:"已完成",statuses:["COMPLETED"]}];
export default function OrdersScreen(){
 const {stallId}=useLocalSearchParams<{stallId:string}>();const {bootstrapData,runAuthenticated}=useSession();
 const workspace=bootstrapData?.workspaces.find(w=>w.stalls.some(s=>s.id===stallId));const stall=workspace?.stalls.find(s=>s.id===stallId);
 const [query,setQuery]=useState(""),[filter,setFilter]=useState(0);const context=useNativeScope(workspace?.id);const client=useQueryClient();const cadence=useReadCadence();
 const input={stallId,query,statuses:filters[filter].statuses};const key=context.data?operationsKey(context.data,"native-orders",input):["pending-orders"];
 const list=useInfiniteQuery({queryKey:key,initialPageParam:undefined as string|undefined,enabled:!!context.data&&!!stall?.permissions.includes("VIEW_ORDERS")&&cadence!==false,refetchInterval:cadence,queryFn:({pageParam,signal})=>nativeRead(client,key,signal,()=>runAuthenticated((token,device)=>orders(token,device,stallId,{...input,cursor:pageParam,limit:50}))),getNextPageParam:page=>page.nextCursor??undefined});
 const rows=deduplicateAuthoritativeOrders(list.error?[]:list.data?.pages.flatMap(p=>p.orders)??[]);
 if(!bootstrapData)return <Redirect href="/login"/>;
 if(!stall?.permissions.includes("VIEW_ORDERS"))return <SafeAreaView><Text accessibilityRole="alert">無法存取此攤位訂單</Text></SafeAreaView>;
 return <SafeAreaView style={styles.safeArea}><FlashList key={JSON.stringify(key)} data={rows} keyExtractor={item=>item.id} renderItem={({item})=><OrderCard order={item} stallId={stallId} currency={workspace?.defaultCurrency??"TWD"}/>} contentContainerStyle={styles.content} refreshing={list.isRefetching} onRefresh={()=>void list.refetch()} onEndReached={()=>{if(list.hasNextPage&&!list.isFetching)void list.fetchNextPage();}} onEndReachedThreshold={0.4}
 ListHeaderComponent={<View><Pressable accessibilityRole="button" style={styles.backButton} onPress={()=>router.back()}><Text>返回</Text></Pressable><Text style={styles.title}>{stall.name}</Text><Text>攤點通・唯讀訂單（已載入 {rows.length} 筆）</Text><TextInput accessibilityLabel="搜尋訂單" style={styles.searchInput} value={query} onChangeText={setQuery}/><View style={styles.filterList}>{filters.map((f,i)=><Pressable key={f.label} accessibilityRole="tab" accessibilityState={{selected:i===filter}} style={styles.filter} onPress={()=>setFilter(i)}><Text>{f.label}</Text></Pressable>)}</View>{(list.error||context.error)&&<Text accessibilityRole="alert">{(list.error||context.error)?.message}</Text>}</View>}
 ListEmptyComponent={list.isPending?<ActivityIndicator/>:<Text>目前沒有符合條件的訂單</Text>}
 ListFooterComponent={<View>{list.isFetchingNextPage&&<ActivityIndicator/>}{list.hasNextPage&&<Pressable accessibilityRole="button" style={styles.primaryButton} disabled={list.isFetching} onPress={()=>void list.fetchNextPage()}><Text style={styles.primaryButtonText}>載入更多訂單</Text></Pressable>}</View>}/></SafeAreaView>;
}
function OrderCard({ order, stallId, currency }: { order: OrderSummary; stallId: string; currency: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`查看訂單 ${order.orderNo}，${mobileOrderStatusLabels[order.status]}`}
      onPress={() => router.push({ pathname: "/order/[orderId]", params: { orderId: order.id, stallId } })}
      style={({ pressed }) => [styles.orderCard, pressed && styles.orderCardPressed]}
    >
      <View style={styles.orderTopRow}>
        <View style={styles.orderNumberRow}>
          <Text style={styles.orderNumber}>#{order.orderNo}</Text>
          {order.isTest ? <Text style={styles.testBadge}>測試</Text> : null}
        </View>
        <Text style={styles.statusBadge}>{mobileOrderStatusLabels[order.status]}</Text>
      </View>
      <Text style={styles.customer}>{order.customerName || "未提供顧客姓名"}{order.tableLabel ? ` · ${order.tableLabel}` : ""}</Text>
      <View style={styles.orderMetaRow}>
        <Text style={styles.orderMeta}>{mobileFulfillmentTypeLabels[order.fulfillmentType]} · {order.itemCount} 項</Text>
        <Text style={styles.total}>{formatMoney(order.total, currency)}</Text>
      </View>
      <View style={styles.orderMetaRow}>
        <Text style={styles.orderMeta}>{mobilePaymentStatusLabels[order.paymentStatus]}</Text>
        <Text style={styles.orderTime}>{formatDateTime(order.updatedAt)}</Text>
      </View>
    </Pressable>
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
  readOnlyNotice: { borderRadius: 17, backgroundColor: "#dff7f2", padding: 16, gap: 4 },
  readOnlyTitle: { color: "#134e4a", fontSize: 16, fontWeight: "800" },
  readOnlyBody: { color: "#115e59", fontSize: 13, lineHeight: 19 },
  searchRow: { flexDirection: "row", gap: 8 },
  searchInput: { flex: 1, minHeight: 50, borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 14, backgroundColor: "#ffffff", paddingHorizontal: 14, color: "#0f172a", fontSize: 15 },
  searchButton: { minHeight: 50, minWidth: 66, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: "#0f766e" },
  searchButtonText: { color: "#ffffff", fontWeight: "800" },
  filterList: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filter: { minHeight: 48, justifyContent: "center", borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 14, backgroundColor: "#ffffff", paddingHorizontal: 14 },
  filterSelected: { borderColor: "#0f766e", backgroundColor: "#0f766e" },
  filterText: { color: "#475569", fontSize: 14, fontWeight: "700" },
  filterTextSelected: { color: "#ffffff" },
  centerCard: { flex: 1, margin: 20, alignItems: "stretch", justifyContent: "center", gap: 12 },
  errorCard: { borderRadius: 18, backgroundColor: "#fee2e2", padding: 16, gap: 8 },
  errorTitle: { color: "#991b1b", fontSize: 17, fontWeight: "800" },
  errorBody: { color: "#b91c1c", fontSize: 14, lineHeight: 20 },
  retryButton: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "#ffffff" },
  retryButtonText: { color: "#991b1b", fontWeight: "800" },
  loading: { minHeight: 180, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { color: "#475569", fontSize: 15 },
  empty: { borderRadius: 18, backgroundColor: "#ffffff", padding: 22, gap: 5 },
  emptyTitle: { color: "#334155", fontSize: 16, fontWeight: "800" },
  emptyBody: { color: "#64748b", fontSize: 14, lineHeight: 20 },
  orderList: { gap: 10 },
  orderCard: { borderRadius: 18, borderWidth: 1, borderColor: "#e2e8f0", backgroundColor: "#ffffff", padding: 16, gap: 9 },
  orderCardPressed: { backgroundColor: "#f0fdfa" },
  orderTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  orderNumberRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 7 },
  orderNumber: { color: "#0f172a", fontSize: 18, fontWeight: "900" },
  testBadge: { color: "#92400e", backgroundColor: "#fef3c7", borderRadius: 7, paddingHorizontal: 7, paddingVertical: 2, fontSize: 11, fontWeight: "800" },
  statusBadge: { color: "#115e59", backgroundColor: "#dff7f2", borderRadius: 9, paddingHorizontal: 9, paddingVertical: 5, fontSize: 12, fontWeight: "800" },
  customer: { color: "#334155", fontSize: 15, fontWeight: "700" },
  orderMetaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  orderMeta: { color: "#64748b", fontSize: 13 },
  orderTime: { color: "#64748b", fontSize: 12 },
  total: { color: "#0f172a", fontSize: 17, fontWeight: "900" },
  primaryButton: { minHeight: 50, alignItems: "center", justifyContent: "center", borderRadius: 15, backgroundColor: "#0f766e", paddingHorizontal: 18 },
  primaryButtonText: { color: "#ffffff", fontSize: 16, fontWeight: "800" },
  disabled: { opacity: 0.55 },
  generatedAt: { color: "#64748b", fontSize: 12, textAlign: "center" },
});

import { notFound } from "next/navigation";
import { PaymentIntegrationManager } from "@/components/payment-integration-manager";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/rbac";
import { requireWorkspacePage } from "@/lib/workspace";
import { paymentProviderDefinitions } from "@/server/payment-providers/provider-definitions";
import { requireAdminModuleVisible } from "@/server/admin/admin-module-visibility";

type PageProps = { searchParams: Promise<{ organizationId?: string }> };

const copies = {
  "zh-TW": {
    title: "付款與金流",
    description: "檢查付款、退款與對帳流程。",
    localOnly: "本機測試",
    localOnlyDescription: "此頁只供測試，不會使用正式金流資料。測試可能更新所選未付款訂單。",
    mockConnection: "測試連線設定",
    stall: "攤位",
    provider: "金流供應商",
    manualOnly: "僅限人工付款",
    configure: "建立／更新測試連線",
    configured: "測試連線已建立，不代表正式金流已啟用。",
    configureFailed: "建立測試連線失敗。",
    mockAcceptance: "付款流程測試",
    mockAcceptanceDescription: "選擇未付款訂單，測試付款、退款或對帳結果。",
    unpaidOrder: "未付款訂單",
    select: "請選擇",
    scenario: "情境",
    run: "執行本機測試",
    testCompleted: "測試完成",
    testCompletedEvidence: "付款結果會由金流通知確認，不會只看瀏覽器畫面。",
    testFailed: "付款流程測試失敗。",
    connections: "金流連線",
    secretReference: "金流設定",
    present: "已設定",
    missing: "未設定",
    enabledChannels: "啟用通路",
    none: "無",
    noConnections: "尚未建立金流連線。",
    recentTransactions: "最近付款紀錄",
    order: "訂單",
    noTransactions: "尚無付款紀錄。",
    channelLabels: { DINE_IN: "內用", TAKEOUT: "外帶", DELIVERY: "外送", STAFF_POS: "店員 POS", PUBLIC_MENU: "公開菜單" },
    scenarioLabels: { SUCCESS_WEBHOOK_BEFORE_RETURN: "Webhook 先於 Browser return 成功", SUCCESS_RETURN_BEFORE_WEBHOOK: "Browser return 先於 Webhook 成功", PENDING: "待付款", FAILED: "付款失敗", EXPIRED: "付款逾期", FULL_REFUND: "完整退款", RECONCILIATION_MISMATCH: "對帳不符" },
  },
  en: {
    title: "Payments and integrations",
    description: "Check payment, refund, and reconciliation flows.",
    localOnly: "Local test",
    localOnlyDescription: "This page is for testing only and does not use live payment data. A test may update the selected unpaid order.",
    mockConnection: "Test connection",
    stall: "Stall",
    provider: "Provider",
    manualOnly: "Manual payment only",
    configure: "Create or update test connection",
    configured: "The test connection is ready. Live payments are not enabled.",
    configureFailed: "Could not create the test connection.",
    mockAcceptance: "Payment flow test",
    mockAcceptanceDescription: "Choose an unpaid order to test payment, refund, or reconciliation results.",
    unpaidOrder: "Unpaid order",
    select: "Select",
    scenario: "Scenario",
    run: "Run local test",
    testCompleted: "Test completed",
    testCompletedEvidence: "The payment result is confirmed by the payment provider, not by the browser screen alone.",
    testFailed: "The payment flow test failed.",
    connections: "Payment connections",
    secretReference: "Payment setting",
    present: "present",
    missing: "missing",
    enabledChannels: "Channels",
    none: "none",
    noConnections: "No provider connection yet.",
    recentTransactions: "Recent payments",
    order: "Order",
    noTransactions: "No payments yet.",
    channelLabels: { DINE_IN: "Dine in", TAKEOUT: "Takeout", DELIVERY: "Delivery", STAFF_POS: "Staff POS", PUBLIC_MENU: "Public menu" },
    scenarioLabels: { SUCCESS_WEBHOOK_BEFORE_RETURN: "Webhook succeeds before browser return", SUCCESS_RETURN_BEFORE_WEBHOOK: "Browser return arrives before successful webhook", PENDING: "Pending", FAILED: "Failed", EXPIRED: "Expired", FULL_REFUND: "Full refund", RECONCILIATION_MISMATCH: "Reconciliation mismatch" },
  },
  vi: {
    title: "Thanh toán và tích hợp",
    description: "Kiểm tra quy trình thanh toán, hoàn tiền và đối soát.",
    localOnly: "Kiểm thử cục bộ",
    localOnlyDescription: "Trang này chỉ dùng để kiểm thử và không dùng dữ liệu thanh toán thật. Kiểm thử có thể cập nhật đơn chưa thanh toán đã chọn.",
    mockConnection: "Kết nối kiểm thử",
    stall: "Gian hàng",
    provider: "Nhà cung cấp",
    manualOnly: "Chỉ thanh toán thủ công",
    configure: "Tạo hoặc cập nhật kết nối kiểm thử",
    configured: "Kết nối kiểm thử đã sẵn sàng. Thanh toán thật chưa được bật.",
    configureFailed: "Không thể tạo kết nối kiểm thử.",
    mockAcceptance: "Kiểm thử quy trình thanh toán",
    mockAcceptanceDescription: "Chọn đơn chưa thanh toán để kiểm tra kết quả thanh toán, hoàn tiền hoặc đối soát.",
    unpaidOrder: "Đơn chưa thanh toán",
    select: "Chọn",
    scenario: "Kịch bản",
    run: "Chạy kiểm thử cục bộ",
    testCompleted: "Kiểm thử hoàn tất",
    testCompletedEvidence: "Kết quả thanh toán được xác nhận từ nhà cung cấp, không chỉ dựa vào màn hình trình duyệt.",
    testFailed: "Kiểm thử quy trình thanh toán thất bại.",
    connections: "Kết nối thanh toán",
    secretReference: "Cài đặt thanh toán",
    present: "đã có",
    missing: "chưa có",
    enabledChannels: "Kênh",
    none: "không có",
    noConnections: "Chưa có kết nối nhà cung cấp.",
    recentTransactions: "Thanh toán gần đây",
    order: "Đơn hàng",
    noTransactions: "Chưa có thanh toán.",
    channelLabels: { DINE_IN: "Ăn tại chỗ", TAKEOUT: "Mang đi", DELIVERY: "Giao hàng", STAFF_POS: "POS nhân viên", PUBLIC_MENU: "Thực đơn công khai" },
    scenarioLabels: { SUCCESS_WEBHOOK_BEFORE_RETURN: "Webhook thành công trước browser return", SUCCESS_RETURN_BEFORE_WEBHOOK: "Browser return đến trước webhook thành công", PENDING: "Đang chờ", FAILED: "Thất bại", EXPIRED: "Hết hạn", FULL_REFUND: "Hoàn tiền toàn bộ", RECONCILIATION_MISMATCH: "Sai lệch đối soát" },
  },
} as const;

export default async function MerchantPaymentsPage({ searchParams }: PageProps) {
  await requireAdminModuleVisible("payments");
  const [{ workspaces }, query, { locale }] = await Promise.all([requireWorkspacePage(), searchParams, getRequestAppLocale()]);
  const copy = locale === "zh-TW" || locale === "vi" ? copies[locale] : copies.en;
  const candidates = workspaces.filter((workspace) => workspace.roles.some((role) => hasPermission(role, "MANAGE_PAYMENT_INTEGRATIONS")));
  const workspace = candidates.find((item) => item.id === query.organizationId) ?? candidates[0];
  if (!workspace) notFound();
  const stallIds = workspace.stalls.filter((stall) => stall.isActive).map((stall) => stall.id);
  const [connections, orders, transactions] = await Promise.all([
    prisma.paymentProviderConnection.findMany({
      where: { organizationId: workspace.id },
      orderBy: [{ provider: "asc" }, { stallId: "asc" }],
    }),
    prisma.order.findMany({
      where: { organizationId: workspace.id, stallId: { in: stallIds }, paymentStatus: "UNPAID" },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { id: true, stallId: true, orderNo: true, total: true, createdAt: true },
    }),
    prisma.paymentProviderTransaction.findMany({
      where: { organizationId: workspace.id, stallId: { in: stallIds } },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, orderId: true, provider: true, amount: true, currency: true, status: true, createdAt: true },
    }),
  ]);

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-6xl px-4 py-8 md:px-8">
      <header className="mb-7 border-b border-stone-200 pb-5"><p className="text-sm font-semibold text-teal-800">{workspace.businessName}</p><h1 className="mt-1 text-3xl font-semibold">{copy.title}</h1><p className="mt-2 text-sm text-stone-600">{copy.description}</p></header>
      <PaymentIntegrationManager
        organizationId={workspace.id}
        stalls={workspace.stalls.filter((stall) => stall.isActive).map((stall) => ({ id: stall.id, name: stall.name }))}
        providers={paymentProviderDefinitions.map((provider) => ({ ...provider, capabilities: [...provider.capabilities] }))}
        initialConnections={connections.map((connection) => ({
          id: connection.id,
          stallId: connection.stallId,
          provider: connection.provider,
          environment: connection.environment,
          status: connection.status,
          enabledChannels: connection.enabledChannels,
          lastVerifiedAt: connection.lastVerifiedAt?.toISOString() ?? null,
          lastErrorCode: connection.lastErrorCode,
          secretReferencePresent: Boolean(connection.secretReference),
        }))}
        orders={orders.map((order) => ({ ...order, createdAt: order.createdAt.toISOString() }))}
        initialTransactions={transactions.map((transaction) => ({ ...transaction, createdAt: transaction.createdAt.toISOString() }))}
        copy={copy}
      />
    </main>
  );
}

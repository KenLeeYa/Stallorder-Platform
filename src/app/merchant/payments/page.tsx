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
    description: "Provider-neutral connection、transaction、webhook、退款與對帳本機驗收。",
    localOnly: "僅限本機 Mock",
    localOnlyDescription: "本頁不接受或顯示真實密鑰；Live flags 全部維持 OFF。測試會寫入本機資料庫，並可能更新所選未付款訂單。",
    mockConnection: "Mock 連線設定",
    stall: "攤位",
    provider: "Provider",
    manualOnly: "僅限人工付款",
    configure: "建立／更新 Local Mock 連線",
    configured: "Mock 連線已建立；僅供本機測試，不代表 Sandbox 或 Live 可用。",
    configureFailed: "建立 Mock 連線失敗。",
    mockAcceptance: "Mock 付款驗收",
    mockAcceptanceDescription: "只列出目前可存取的未付款訂單。成功與完整退款情境會更新既有 Order／Payment；對帳不符會建立 review case。",
    unpaidOrder: "未付款訂單",
    select: "請選擇",
    scenario: "情境",
    run: "執行並寫入本機測試資料",
    testCompleted: "測試完成",
    testCompletedEvidence: "Browser return 不會單獨被信任；付款成功只由簽章 webhook／provider query 寫入。",
    testFailed: "Mock 付款測試失敗。",
    connections: "Provider connections",
    secretReference: "Secret reference",
    present: "已設定",
    missing: "未設定",
    enabledChannels: "啟用通路",
    none: "無",
    noConnections: "尚無 provider connection。",
    recentTransactions: "最近 provider transactions",
    order: "訂單",
    noTransactions: "尚無 transaction。",
    channelLabels: { DINE_IN: "內用", TAKEOUT: "外帶", DELIVERY: "外送", STAFF_POS: "店員 POS", PUBLIC_MENU: "公開菜單" },
    scenarioLabels: { SUCCESS_WEBHOOK_BEFORE_RETURN: "Webhook 先於 Browser return 成功", SUCCESS_RETURN_BEFORE_WEBHOOK: "Browser return 先於 Webhook 成功", PENDING: "待付款", FAILED: "付款失敗", EXPIRED: "付款逾期", FULL_REFUND: "完整退款", RECONCILIATION_MISMATCH: "對帳不符" },
  },
  en: {
    title: "Payments and integrations",
    description: "Local acceptance for provider-neutral connections, transactions, webhooks, refunds, and reconciliation.",
    localOnly: "Local Mock only",
    localOnlyDescription: "This page never accepts or reveals live credentials. All live flags stay OFF. Tests write only to the local database and may update the selected unpaid order.",
    mockConnection: "Mock connection",
    stall: "Stall",
    provider: "Provider",
    manualOnly: "Manual payment only",
    configure: "Create or update Local Mock connection",
    configured: "The Mock connection is ready for local testing only; it does not prove Sandbox or Live readiness.",
    configureFailed: "Could not create the Mock connection.",
    mockAcceptance: "Mock payment acceptance",
    mockAcceptanceDescription: "Only accessible unpaid orders are listed. Success and full-refund scenarios update the existing Order and Payment; a mismatch creates a reconciliation review case.",
    unpaidOrder: "Unpaid order",
    select: "Select",
    scenario: "Scenario",
    run: "Run and write local test data",
    testCompleted: "Test completed",
    testCompletedEvidence: "A browser return is never trusted by itself; only a signed webhook or verified provider query can record a successful payment.",
    testFailed: "The Mock payment test failed.",
    connections: "Provider connections",
    secretReference: "Secret reference",
    present: "present",
    missing: "missing",
    enabledChannels: "Channels",
    none: "none",
    noConnections: "No provider connection yet.",
    recentTransactions: "Recent provider transactions",
    order: "Order",
    noTransactions: "No transaction yet.",
    channelLabels: { DINE_IN: "Dine in", TAKEOUT: "Takeout", DELIVERY: "Delivery", STAFF_POS: "Staff POS", PUBLIC_MENU: "Public menu" },
    scenarioLabels: { SUCCESS_WEBHOOK_BEFORE_RETURN: "Webhook succeeds before browser return", SUCCESS_RETURN_BEFORE_WEBHOOK: "Browser return arrives before successful webhook", PENDING: "Pending", FAILED: "Failed", EXPIRED: "Expired", FULL_REFUND: "Full refund", RECONCILIATION_MISMATCH: "Reconciliation mismatch" },
  },
  vi: {
    title: "Thanh toán và tích hợp",
    description: "Kiểm thử cục bộ cho kết nối trung lập nhà cung cấp, giao dịch, webhook, hoàn tiền và đối soát.",
    localOnly: "Chỉ dùng Mock cục bộ",
    localOnlyDescription: "Trang này không nhận hoặc hiển thị thông tin xác thực thật. Mọi cờ Live đều TẮT. Kiểm thử chỉ ghi vào cơ sở dữ liệu cục bộ và có thể cập nhật đơn chưa thanh toán đã chọn.",
    mockConnection: "Kết nối Mock",
    stall: "Gian hàng",
    provider: "Nhà cung cấp",
    manualOnly: "Chỉ thanh toán thủ công",
    configure: "Tạo hoặc cập nhật kết nối Local Mock",
    configured: "Kết nối Mock chỉ sẵn sàng cho kiểm thử cục bộ; không chứng minh Sandbox hoặc Live đã sẵn sàng.",
    configureFailed: "Không thể tạo kết nối Mock.",
    mockAcceptance: "Nghiệm thu thanh toán Mock",
    mockAcceptanceDescription: "Chỉ hiển thị đơn chưa thanh toán có quyền truy cập. Kịch bản thành công và hoàn tiền toàn bộ cập nhật Order và Payment hiện có; sai lệch sẽ tạo hồ sơ đối soát.",
    unpaidOrder: "Đơn chưa thanh toán",
    select: "Chọn",
    scenario: "Kịch bản",
    run: "Chạy và ghi dữ liệu kiểm thử cục bộ",
    testCompleted: "Kiểm thử hoàn tất",
    testCompletedEvidence: "Không tin cậy riêng browser return; chỉ webhook có chữ ký hoặc truy vấn nhà cung cấp đã xác minh mới được ghi nhận thanh toán thành công.",
    testFailed: "Kiểm thử thanh toán Mock thất bại.",
    connections: "Kết nối nhà cung cấp",
    secretReference: "Tham chiếu bí mật",
    present: "đã có",
    missing: "chưa có",
    enabledChannels: "Kênh",
    none: "không có",
    noConnections: "Chưa có kết nối nhà cung cấp.",
    recentTransactions: "Giao dịch nhà cung cấp gần đây",
    order: "Đơn hàng",
    noTransactions: "Chưa có giao dịch.",
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

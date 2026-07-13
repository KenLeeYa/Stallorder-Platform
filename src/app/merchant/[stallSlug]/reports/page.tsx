import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";
import { requirePagePermission } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/money";
import { orderStatusLabels, paymentStatusLabels } from "@/lib/orders";
import { roleLabels } from "@/lib/rbac";

type PageProps = {
  params: Promise<{ stallSlug: string }>;
};

export default async function ReportsPage({ params }: PageProps) {
  const { stallSlug } = await params;
  const { stall, principal, role } = await requirePagePermission(
    stallSlug,
    "VIEW_REPORTS",
    `/merchant/${stallSlug}/reports`,
  );
  const taipeiDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const startOfDay = new Date(`${taipeiDate}T00:00:00+08:00`);

  const orders = await prisma.order.findMany({
    where: {
      stallId: stall.id,
      createdAt: { gte: startOfDay },
    },
    orderBy: { createdAt: "desc" },
    include: { items: true },
  });

  const completedOrders = orders.filter((order) => order.status === "COMPLETED");
  const revenue = completedOrders.reduce((sum, order) => sum + order.total, 0);
  const unpaid = orders.filter((order) =>
    order.paymentStatus === "UNPAID" && !["CANCELLED", "EXPIRED"].includes(order.status)
  );
  const productTotals = new Map<string, { quantity: number; revenue: number }>();

  for (const order of completedOrders) {
    for (const item of order.items) {
      const current = productTotals.get(item.name) ?? { quantity: 0, revenue: 0 };
      productTotals.set(item.name, {
        quantity: current.quantity + item.quantity,
        revenue: current.revenue + item.quantity * item.unitPrice,
      });
    }
  }

  const topProducts = [...productTotals.entries()]
    .map(([name, totals]) => ({ name, ...totals }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-6 md:px-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-teal-800">每日銷售報表</p>
          <h1 className="text-3xl font-semibold">{stall.name}</h1>
          <p className="mt-1 text-sm text-stone-600">
            {startOfDay.toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" })} · {principal.user.displayName} · {roleLabels[role]}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/merchant/${stall.slug}`} className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-semibold">
            商品管理
          </Link>
          <LogoutButton />
        </div>
      </div>

      <section className="mt-6 grid gap-4 md:grid-cols-4">
        {[
          ["營業額", formatMoney(revenue, stall.currency)],
          ["已完成訂單", completedOrders.length.toString()],
          ["未結帳訂單", unpaid.length.toString()],
          ["平均客單價", completedOrders.length ? formatMoney(Math.round(revenue / completedOrders.length), stall.currency) : formatMoney(0, stall.currency)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-stone-200 bg-white p-4">
            <div className="text-sm text-stone-500">{label}</div>
            <div className="mt-2 text-2xl font-semibold">{value}</div>
          </div>
        ))}
      </section>

      <section className="mt-6 grid gap-6 md:grid-cols-2">
        <div className="rounded-lg border border-stone-200 bg-white p-5">
          <h2 className="text-lg font-semibold">熱銷商品</h2>
          <div className="mt-4 space-y-3">
            {topProducts.map((product) => (
              <div key={product.name} className="flex justify-between gap-4 border-b border-stone-100 pb-3 text-sm">
                <span>{product.name}</span>
                <span className="font-semibold">
                  {product.quantity} · {formatMoney(product.revenue, stall.currency)}
                </span>
              </div>
            ))}
            {topProducts.length === 0 ? <p className="text-sm text-stone-600">今天尚無已完成銷售。</p> : null}
          </div>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-5">
          <h2 className="text-lg font-semibold">最近訂單</h2>
          <div className="mt-4 space-y-3">
            {orders.slice(0, 8).map((order) => (
              <div key={order.id} className="flex justify-between gap-4 border-b border-stone-100 pb-3 text-sm">
                <div>
                  <div className="font-medium">{order.customerName}</div>
                  <div className="text-stone-500">{orderStatusLabels[order.status]} · {paymentStatusLabels[order.paymentStatus]}</div>
                </div>
                <span className="font-semibold">{formatMoney(order.total, stall.currency)}</span>
              </div>
            ))}
            {orders.length === 0 ? <p className="text-sm text-stone-600">今天尚無訂單。</p> : null}
          </div>
        </div>
      </section>
    </main>
  );
}

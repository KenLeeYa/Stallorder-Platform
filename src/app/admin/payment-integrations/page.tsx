import { ShieldCheck, WalletCards } from "lucide-react";
import { requirePlatformAdminPage } from "@/lib/authorization";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { formatAppDateTime, formatAppNumber } from "@/lib/locale-format";
import { createAdminTranslator } from "@/lib/messages/admin";
import { prisma } from "@/lib/prisma";
import { resolveResilienceFeatureFlags } from "@/server/resilience/feature-flag-service";

const paymentFlags = [
  "ONLINE_ORDER_PAYMENT_ENABLED",
  "PAYMENTS_FOUNDATION_ENABLED",
  "PAYMENTS_MOCK_PROVIDER_ENABLED",
  "PAYMENTS_LINE_PAY_ENABLED",
  "PAYMENTS_JKO_PAY_ENABLED",
  "PAYMENTS_TWQR_ENABLED",
  "PAYMENTS_TAIWAN_PAY_ENABLED",
  "PAYMENTS_PX_PAY_PLUS_ENABLED",
  "PAYMENTS_IPASS_MONEY_ENABLED",
  "PAYMENTS_ICASH_PAY_ENABLED",
  "PAYMENTS_PLUS_PAY_ENABLED",
  "PAYMENTS_EASY_WALLET_ENABLED",
  "PAYMENTS_GAMA_PAY_ENABLED",
  "PAYMENTS_OPAY_ENABLED",
  "PAYMENTS_GATEWAY_ENABLED",
  "PAYMENTS_REFUNDS_ENABLED",
  "PAYMENTS_RECONCILIATION_ENABLED",
] as const;

function countStalledWebhooks() {
  return prisma.paymentProviderWebhookEvent.count({
    where: {
      processingStatus: "RECEIVED",
      receivedAt: { lt: new Date(Date.now() - 5 * 60_000) },
    },
  });
}

export default async function AdminPaymentIntegrationsPage() {
  await requirePlatformAdminPage("/admin/payment-integrations");
  const [{ locale }, connections, totalTransactions, failedTransactions, stalledWebhooks, reconciliationRequired, flags] = await Promise.all([
    getRequestAppLocale(),
    prisma.paymentProviderConnection.findMany({
      orderBy: [{ environment: "asc" }, { provider: "asc" }, { updatedAt: "desc" }],
      include: {
        organization: { select: { businessName: true } },
        stall: { select: { name: true } },
      },
    }),
    prisma.paymentProviderTransaction.count(),
    prisma.paymentProviderTransaction.count({ where: { status: "FAILED" } }),
    countStalledWebhooks(),
    prisma.paymentReconciliationCase.count({ where: { reviewStatus: { in: ["OPEN", "IN_REVIEW"] } } }),
    resolveResilienceFeatureFlags(paymentFlags),
  ]);
  const m = createAdminTranslator(locale);
  const organizationsAffected = new Set(connections.map((connection) => connection.organizationId)).size;
  const failureRate = totalTransactions === 0
    ? "0.0%"
    : `${((failedTransactions / totalTransactions) * 100).toFixed(1)}%`;

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
      <header className="border-b border-stone-200 pb-5"><p className="flex items-center gap-2 text-sm font-semibold text-teal-800"><ShieldCheck className="h-4 w-4" />{m("Platform administrators only")}</p><h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold"><WalletCards className="h-7 w-7 text-teal-700" />{m("Payment provider health")}</h1><p className="mt-2 text-sm text-stone-600">{m("Read-only payment provider health. Merchant secrets are never displayed.")}</p></header>
      <section className="grid gap-4 py-7 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label={m("Organizations affected")} value={formatAppNumber(locale, organizationsAffected)} />
        <Metric label={m("Stalled webhooks")} value={formatAppNumber(locale, stalledWebhooks)} />
        <Metric label={m("Payment failure rate")} value={failureRate} />
        <Metric label={m("Reconciliation required")} value={formatAppNumber(locale, reconciliationRequired)} />
      </section>
      <section className="border-t border-stone-200 py-7"><h2 className="text-xl font-semibold">{m("Connections")}</h2><div className="mt-3 divide-y divide-stone-200 border-y border-stone-200">{connections.map((connection) => <article key={connection.id} className="grid gap-3 py-4 md:grid-cols-[1fr_auto]"><div><p className="font-semibold">{connection.provider} · {connection.organization.businessName}{connection.stall ? ` · ${connection.stall.name}` : ""}</p><p className="mt-1 text-sm text-stone-600">{connection.environment} · {connection.status} · {m("Credential reference")}: {connection.secretReference ? "present" : "missing"}</p></div><p className="text-sm text-stone-500">{connection.lastVerifiedAt ? formatAppDateTime(locale, connection.lastVerifiedAt, { timeZone: "Asia/Taipei" }) : "—"}</p></article>)}{connections.length === 0 ? <p className="py-5 text-sm text-stone-600">{m("There are no connections.")}</p> : null}</div></section>
      <section className="border-t border-stone-200 py-7"><h2 className="text-xl font-semibold">Feature flags</h2><p className="mt-1 text-sm text-stone-600">{m("Feature flags remain OFF until provider onboarding and canary approval.")}</p><div className="mt-3 grid gap-2 md:grid-cols-2">{paymentFlags.map((code) => <div key={code} className="flex items-center justify-between rounded-md border border-stone-200 p-3 text-sm"><code>{code}</code><strong className={flags[code].enabled ? "text-emerald-700" : "text-stone-500"}>{flags[code].enabled ? "ON" : "OFF"}</strong></div>)}</div></section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <article className="rounded-xl border border-stone-200 bg-white p-5"><p className="text-sm text-stone-600">{label}</p><strong className="mt-2 block text-3xl">{value}</strong></article>;
}

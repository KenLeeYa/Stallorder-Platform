import { AdminSubscriptionDirectory } from "@/components/admin-subscription-directory";
import { getAdminSubscriptions } from "@/lib/admin-billing-data";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { createAdminTranslator } from "@/lib/messages/admin";

export default async function AdminSubscriptionsPage() {
  const [{ locale }, subscriptions] = await Promise.all([getRequestAppLocale(), getAdminSubscriptions()]);
  const m = createAdminTranslator(locale);

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
      <header>
        <h1 className="text-3xl font-semibold">{m("Subscription management")}</h1>
        <p className="mt-2 text-sm text-stone-600">{m("Review plan versions, status, periods, and recent reconciled usage.")}</p>
      </header>
      <AdminSubscriptionDirectory rows={subscriptions.map(subscription => ({
        id: subscription.id, organizationId: subscription.organizationId,
        businessName: subscription.organization.businessName, status: subscription.status,
        plan: `${subscription.planVersion.displayName} v${subscription.planVersion.version}`,
        periodStart: subscription.billingPeriodStart.toISOString(), periodEnd: subscription.billingPeriodEnd.toISOString(),
        orderCount: subscription.organization.billingUsageSummaries[0]?.billableOrderCount ?? 0,
      }))} />
    </main>
  );
}

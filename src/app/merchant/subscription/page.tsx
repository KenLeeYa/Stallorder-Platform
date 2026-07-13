import { notFound, redirect } from "next/navigation";
import { SubscriptionOverview } from "@/components/subscription-overview";
import { hasPermission } from "@/lib/rbac";
import { getSubscriptionOverview } from "@/lib/subscription-data";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";

type PageProps = { searchParams: Promise<{ organizationId?: string }> };

export default async function MerchantSubscriptionPage({ searchParams }: PageProps) {
  const { organizationId } = await searchParams;
  const { principal, workspaces } = await requireWorkspacePage();
  if (!organizationId && workspaces.length > 1) redirect("/select-organization");
  const workspace = requireWorkspaceOrganization(workspaces, organizationId);
  if (!workspace.roles.some((role) => hasPermission(role, "MANAGE_SUBSCRIPTION") || hasPermission(role, "PLATFORM_ADMIN"))) notFound();
  const overview = await getSubscriptionOverview(workspace.id);
  if (!overview) notFound();

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-6xl px-4 py-7 md:px-8">
      <div className="border-b border-stone-200 pb-6"><p className="text-sm font-semibold text-teal-800">{workspace.businessName}</p><h1 className="mt-1 text-3xl font-semibold">訂閱與用量</h1><p className="mt-2 text-sm text-stone-600">方案額度、額外攤位核准、用量與發票明細。</p></div>
      <div className="py-7">
        <SubscriptionOverview
          organizationId={workspace.id}
          currency={workspace.defaultCurrency}
          canApprove={principal.user.platformRole === "PLATFORM_ADMIN"}
          data={{
            plan: { code: overview.subscription.plan.code, name: overview.subscription.plan.displayName, basePrice: overview.subscription.plan.basePrice, includedStalls: overview.subscription.plan.includedStalls, additionalStallPrice: overview.subscription.plan.additionalStallPrice, maxStalls: overview.subscription.plan.maxStalls },
            subscription: { status: overview.subscription.status, periodStart: overview.subscription.billingPeriodStart.toISOString().slice(0, 10), periodEnd: overview.subscription.billingPeriodEnd.toISOString().slice(0, 10) },
            usage: overview.usage,
            estimate: overview.estimate,
            approvals: overview.subscription.additionalApprovals.map((approval) => ({ id: approval.id, quantity: approval.quantity, unitPrice: approval.unitPrice, reason: approval.reason, effectiveAt: approval.effectiveAt.toISOString().slice(0, 10) })),
            invoices: overview.subscription.invoices.map((invoice) => ({ id: invoice.id, number: invoice.invoiceNumber, status: invoice.status, total: invoice.total, periodStart: invoice.billingPeriodStart.toISOString().slice(0, 10), lineItems: invoice.lineItems.map((item) => ({ id: item.id, description: item.description, amount: item.amount })) })),
          }}
        />
      </div>
    </main>
  );
}

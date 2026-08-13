import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { StallSettingsOverview } from "@/components/stall-settings-overview";
import { getRequestMerchantMessages } from "@/lib/messages/merchant-server";
import { hasPermission } from "@/lib/rbac";
import { requireWorkspacePage } from "@/lib/workspace";
import { resolveDeliveryFeatureState } from "@/server/delivery-platforms/delivery-feature-flags";

type PageProps = { params: Promise<{ stallId: string }> };

export default async function EditStallPage({ params }: PageProps) {
  const { m } = await getRequestMerchantMessages();
  const { stallId } = await params;
  const { workspaces } = await requireWorkspacePage();
  const workspace = workspaces.find((candidate) => candidate.stalls.some((stall) => stall.id === stallId));
  const stall = workspace?.stalls.find((candidate) => candidate.id === stallId);
  if (!workspace || !stall) notFound();

  const roles = [...new Set([...workspace.roles, ...stall.roles])];
  if (!roles.some((role) => hasPermission(role, "MANAGE_STALL"))) notFound();

  const canManageLocalization = workspace.roles.some((role) => hasPermission(role, "MANAGE_SHARED_PRODUCTS"));
  const canManageEvents = workspace.roles.some((role) => hasPermission(role, "MANAGE_MARKET_EVENTS"));
  const canManageTeam = roles.some((role) => hasPermission(role, "MANAGE_STAFF"));
  const canManageOrdering = roles.some((role) => hasPermission(role, "MANAGE_ORDERING"));
  const canManageReportSchedules = workspace.roles.some((role) => hasPermission(role, "MANAGE_REPORT_SCHEDULES"));
  const deliveryFeatureState = await resolveDeliveryFeatureState("UBER_EATS", {
    organizationId: workspace.id,
    stallId: stall.id,
  });
  const canManageDelivery = roles.some(
    (role) => hasPermission(role, "MANAGE_DELIVERY_INTEGRATIONS"),
  ) && deliveryFeatureState.foundation && deliveryFeatureState.ui;

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-5xl px-4 py-7 md:px-8">
      <Link href={`/merchant/stalls?organizationId=${workspace.id}`} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-teal-800">
        <ArrowLeft className="h-4 w-4" />
        {m("返回攤位管理")}
      </Link>

      <header className="mt-4 border-b border-stone-200 pb-5">
        <p className="text-sm font-semibold text-teal-800">{workspace.businessName}</p>
        <h1 className="mt-1 text-3xl font-semibold">{stall.name}</h1>
        <p className="mt-2 text-sm text-stone-500">{stall.slug}</p>
      </header>

      <StallSettingsOverview
        workspaceId={workspace.id}
        stallId={stall.id}
        canManageLocalization={canManageLocalization}
        canManageEvents={canManageEvents}
        canManageTeam={canManageTeam}
        canManageOrdering={canManageOrdering}
        canManageReportSchedules={canManageReportSchedules}
        canManageOrganization={workspace.roles.some((role) => hasPermission(role, "MANAGE_ORGANIZATION"))}
        canManageDelivery={canManageDelivery}
        showMerchantSetup={workspace.roles.includes("ORGANIZATION_OWNER")
          && Boolean(workspace.merchantSetupState)
          && workspace.merchantSetupStallId === stall.id}
      />
    </main>
  );
}

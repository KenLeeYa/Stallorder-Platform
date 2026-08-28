import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Plus, Settings2 } from "lucide-react";
import { StallSettingsOverview } from "@/components/stall-settings-overview";
import { getRequestMerchantMessages } from "@/lib/messages/merchant-server";
import { hasPermission } from "@/lib/rbac";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";
import { resolveDeliveryFeatureState } from "@/server/delivery-platforms/delivery-feature-flags";

type PageProps = { searchParams: Promise<{ organizationId?: string }> };

export default async function MerchantStallsPage({ searchParams }: PageProps) {
  const { m } = await getRequestMerchantMessages();
  const { organizationId } = await searchParams;
  const { workspaces } = await requireWorkspacePage();
  if (!organizationId && workspaces.length > 1) redirect("/select-organization");
  const workspace = requireWorkspaceOrganization(workspaces, organizationId);
  const canCreate = workspace.roles.some((role) => hasPermission(role, "MANAGE_ORGANIZATION"));
  const canManageAny = canCreate || workspace.stalls.some((stall) => stall.roles.some((role) => hasPermission(role, "MANAGE_STALL")));
  if (!canManageAny) notFound();
  const singleStall = workspace.stalls.length === 1 ? workspace.stalls[0] : null;
  const singleStallRoles = singleStall
    ? [...new Set([...workspace.roles, ...singleStall.roles])]
    : [];
  const showSingleStallSettings = Boolean(singleStall && singleStallRoles.some(
    (role) => hasPermission(role, "MANAGE_STALL"),
  ));
  const deliveryFeatureState = showSingleStallSettings && singleStall
    ? await resolveDeliveryFeatureState("UBER_EATS", {
      organizationId: workspace.id,
      stallId: singleStall.id,
    })
    : null;

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-5xl px-4 py-7 md:px-8">
      <div className="flex flex-col gap-4 border-b border-stone-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-sm font-semibold text-teal-800">{workspace.businessName}</p><h1 className="mt-1 text-3xl font-semibold">{m("管理攤位")}</h1><p className="mt-2 text-sm text-stone-600">{m("停用攤位會保留歷史訂單、商品設定與報表資料。")}</p></div>
        {canCreate ? <Link href={`/merchant/stalls/new?organizationId=${workspace.id}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-stone-900 px-4 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4" />{m("新增攤位")}</Link> : null}
      </div>
      <div className="mt-5 divide-y divide-stone-200 border-y border-stone-200">
        {workspace.stalls.map((stall) => {
          const canManage = workspace.roles.some((role) => hasPermission(role, "MANAGE_STALL")) || stall.roles.some((role) => hasPermission(role, "MANAGE_STALL"));
          return (
            <div key={stall.id} className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
              <div><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{stall.name}</h2>{!stall.isActive ? <span className="rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-red-800">{m("已停用")}</span> : <span className="rounded-md bg-stone-100 px-2 py-1 text-xs font-semibold text-stone-700">{{ OPEN: m("營業中"), PAUSED: m("已暫停"), CLOSED: m("已關閉"), SOLD_OUT: m("全攤售罄") }[stall.businessStatus]}</span>}</div><p className="mt-1 text-sm text-stone-500">{m("代碼 {code} · {slug}", { code: stall.code, slug: stall.slug })}</p></div>
              {canManage && !showSingleStallSettings ? <Link href={`/merchant/stalls/${stall.id}?organizationId=${workspace.id}`} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-teal-800"><Settings2 className="h-4 w-4" />{m("設定")}</Link> : null}
            </div>
          );
        })}
      </div>
      {showSingleStallSettings && singleStall ? (
        <StallSettingsOverview
          workspaceId={workspace.id}
          stallId={singleStall.id}
          canManageLocalization={workspace.roles.some((role) => hasPermission(role, "MANAGE_SHARED_PRODUCTS"))}
          canManageEvents={workspace.roles.some((role) => hasPermission(role, "MANAGE_MARKET_EVENTS"))}
          canManageTeam={singleStallRoles.some((role) => hasPermission(role, "MANAGE_STAFF"))}
          canManageAttendance={singleStallRoles.some((role) => hasPermission(role, "MANAGE_ATTENDANCE"))}
          canManageOrdering={singleStallRoles.some((role) => hasPermission(role, "MANAGE_ORDERING"))}
          canManageReportSchedules={workspace.roles.some((role) => hasPermission(role, "MANAGE_REPORT_SCHEDULES"))}
          canManageOrganization={canCreate}
          canManageDelivery={singleStallRoles.some(
            (role) => hasPermission(role, "MANAGE_DELIVERY_INTEGRATIONS"),
          ) && Boolean(deliveryFeatureState?.foundation && deliveryFeatureState.ui)}
          kdsEnabled={singleStall.kdsEnabled}
          showMerchantSetup={workspace.roles.includes("ORGANIZATION_OWNER")
            && Boolean(workspace.merchantSetupState)
            && workspace.merchantSetupStallId === singleStall.id}
        />
      ) : null}
      {workspace.stalls.length === 0 ? <p className="mt-6 text-sm text-stone-600">{m("尚未建立攤位。")}</p> : null}
    </main>
  );
}

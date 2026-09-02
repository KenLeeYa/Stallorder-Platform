"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  BarChart3,
  BriefcaseBusiness,
  Boxes,
  Building2,
  Cable,
  ChartNoAxesCombined,
  CreditCard,
  FileChartColumn,
  Package,
  ScrollText,
  ShieldCheck,
  WalletCards,
  Store,
  UsersRound,
} from "lucide-react";
import { LogoutButton } from "@/components/logout-button";
import { MerchantGuideDialog } from "@/components/merchant-guide-dialog";
import { MobileSeniorActionMenu } from "@/components/mobile-senior-action-menu";
import { PwaControls } from "@/components/pwa-controls";
import { WorkModeSwitcher } from "@/components/work-mode-switcher";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { hasPermission } from "@/lib/rbac";
import { buildWorkModeDestinations } from "@/lib/work-mode";
import { useMerchantMessages } from "@/lib/messages/merchant-client";
import type { WorkspaceOrganization } from "@/lib/workspace";
import type { WorkspaceRouteContext } from "@/lib/workspace-route-context";

export function MerchantWorkspaceHeader({
  workspaces,
  displayName,
  routeContext,
  showBilling,
  showGrowth = false,
  showPayments = false,
  showSupply = false,
}: {
  workspaces: WorkspaceOrganization[];
  displayName: string;
  routeContext: WorkspaceRouteContext;
  showBilling: boolean;
  showGrowth?: boolean;
  showPayments?: boolean;
  showSupply?: boolean;
}) {
  const { m } = useMerchantMessages();
  const organizationId = routeContext.organizationId ?? workspaces[0]?.id ?? "";

  const workspace = useMemo(
    () => workspaces.find((candidate) => candidate.id === organizationId) ?? workspaces[0],
    [organizationId, workspaces],
  );
  const routeStall = routeContext.stallId
    ? workspaces.flatMap((candidate) => candidate.stalls)
      .find((stall) => stall.id === routeContext.stallId)
    : undefined;
  const activeStalls = workspace?.stalls.filter((stall) => stall.isActive) ?? [];
  const singleActiveStall = activeStalls.length === 1 ? activeStalls[0] : null;
  const guideStall = routeStall?.organizationId === workspace?.id
    ? routeStall
    : singleActiveStall;
  const workModeDestinations = useMemo(
    () => buildWorkModeDestinations(workspaces),
    [workspaces],
  );
  const selectedScope = routeStall?.organizationId === workspace?.id
    ? routeStall.id
    : (workspace?.canUseAllStalls ? "ALL_STALLS" : activeStalls[0]?.id ?? "");
  const organizationDestinations = workspaces.map((candidate) => ({
    value: candidate.id,
    label: candidate.businessName,
    href: `/merchant/dashboard?organizationId=${encodeURIComponent(candidate.id)}`,
  }));
  const stallDestinations = workspace ? [
    ...(workspace.canUseAllStalls ? [{
      value: "ALL_STALLS",
      label: m("全部攤位"),
      href: `/merchant/stalls?organizationId=${encodeURIComponent(workspace.id)}`,
    }] : []),
    ...activeStalls.map((stall) => ({
      value: stall.id,
      label: stall.name,
      href: `/merchant/${encodeURIComponent(stall.slug)}`,
    })),
  ] : [];
  const merchantGuide = workspace ? (
    <MerchantGuideDialog
      scope={{
        organizationId: workspace.id,
        operatingMode: workspace.operatingMode,
        merchantSetupState: workspace.merchantSetupState,
        roles: workspace.roles,
        stall: guideStall ? {
          id: guideStall.id,
          name: guideStall.name,
          slug: guideStall.slug,
          kdsEnabled: guideStall.kdsEnabled,
          roles: guideStall.roles,
        } : null,
        features: {
          billing: showBilling,
          growth: showGrowth,
          payments: showPayments,
          supply: showSupply,
        },
      }}
    />
  ) : null;

  function renderFunctionNavigation(className: string, testId: string) {
    return (
      <nav data-testid={testId} data-persist-horizontal-scroll={testId} className={`min-w-0 items-center gap-1 overflow-x-auto ${className}`} aria-label={m("商戶功能")}>
        <Link title={m("儀表板")} href={`/merchant/dashboard?organizationId=${workspace?.id ?? ""}`} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-stone-100">
          <BarChart3 className="h-5 w-5" /><span className="sr-only">{m("儀表板")}</span>
        </Link>
        {workspace?.roles.some((role) => role === "PLATFORM_ADMIN" || role === "ORGANIZATION_OWNER" || role === "ORGANIZATION_ADMIN" || role === "FINANCE_VIEWER") ? (
          <Link title={m("攤位報表")} href={`/merchant/reports/overview?organizationId=${workspace.id}`} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-stone-100">
            <FileChartColumn className="h-5 w-5" /><span className="sr-only">{m("攤位報表")}</span>
          </Link>
        ) : null}
        {workspace?.roles.some((role) => hasPermission(role, "VIEW_REPORTS")) ? (
          <Link title={m("營業損益與成本")} href={`/merchant/operating-profit?organizationId=${workspace.id}`} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-stone-100">
            <ChartNoAxesCombined className="h-5 w-5" /><span className="sr-only">{m("營業損益與成本")}</span>
          </Link>
        ) : null}
        <Link title={m("管理攤位")} href={`/merchant/stalls?organizationId=${workspace?.id ?? ""}`} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-stone-100">
          <Building2 className="h-5 w-5" /><span className="sr-only">{m("管理攤位")}</span>
        </Link>
        {workspace?.roles.some((role) => role === "PLATFORM_ADMIN" || role === "ORGANIZATION_OWNER" || role === "ORGANIZATION_ADMIN") ? (
          <Link title={m("共用商品")} href={`/merchant/catalog?organizationId=${workspace.id}`} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-stone-100">
            <Package className="h-5 w-5" /><span className="sr-only">{m("共用商品")}</span>
          </Link>
        ) : null}
        {showSupply && workspace?.roles.some((role) => hasPermission(role, "MANAGE_SHARED_PRODUCTS")) ? (
          <Link title={m("庫存與配方")} href={`/merchant/supply?organizationId=${workspace.id}`} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-stone-100">
            <Boxes className="h-5 w-5" /><span className="sr-only">{m("庫存與配方")}</span>
          </Link>
        ) : null}
        {workspace && (
          workspace.roles.some((role) => hasPermission(role, "MANAGE_ATTENDANCE"))
          || workspace.stalls.some((stall) => stall.roles.some((role) => hasPermission(role, "MANAGE_ATTENDANCE")))
        ) ? (
          <Link title={m("員工排班與薪資")} href={`/merchant/workforce?organizationId=${workspace.id}`} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-stone-100">
            <BriefcaseBusiness className="h-5 w-5" /><span className="sr-only">{m("員工排班與薪資")}</span>
          </Link>
        ) : null}
        {showGrowth && workspace?.roles.some((role) => hasPermission(role, "MANAGE_ORGANIZATION")) ? (
          <Link title={m("會員與成長")} href={`/merchant/growth?organizationId=${workspace.id}`} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-stone-100">
            <UsersRound className="h-5 w-5" /><span className="sr-only">{m("會員與成長")}</span>
          </Link>
        ) : null}
        {workspace && (
          workspace.roles.some((role) => hasPermission(role, "VIEW_AUDIT_LOGS"))
          || workspace.stalls.some((stall) => stall.roles.some((role) => hasPermission(role, "MANAGE_OPERATIONAL_ALERTS")))
        ) ? (
          <Link title={m("稽核與營運警示")} href={`/merchant/operations?organizationId=${workspace.id}`} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-stone-100">
            <ScrollText className="h-5 w-5" /><span className="sr-only">{m("稽核與營運警示")}</span>
          </Link>
        ) : null}
        {showBilling && workspace?.roles.some((role) => hasPermission(role, "VIEW_BILLING")) ? (
          <Link title={m("訂閱與帳務")} href={`/merchant/billing?organizationId=${workspace.id}`} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-stone-100">
            <CreditCard className="h-5 w-5" /><span className="sr-only">{m("訂閱與帳務")}</span>
          </Link>
        ) : null}
        <Link title={m("帳號與安全性")} href="/merchant/account/security" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-stone-100">
          <ShieldCheck className="h-5 w-5" /><span className="sr-only">{m("帳號與安全性")}</span>
        </Link>
        {showPayments && workspace?.roles.some((role) => hasPermission(role, "MANAGE_PAYMENT_INTEGRATIONS")) ? (
          <Link title={m("付款與金流")} href={`/merchant/payments?organizationId=${workspace.id}`} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-stone-100">
            <WalletCards className="h-5 w-5" /><span className="sr-only">{m("付款與金流")}</span>
          </Link>
        ) : null}
        {workspace?.roles.some((role) => (
          hasPermission(role, "MANAGE_ORGANIZATION")
          || hasPermission(role, "MANAGE_DELIVERY_INTEGRATIONS")
          || hasPermission(role, "MANAGE_PAYMENT_INTEGRATIONS")
          || hasPermission(role, "MANAGE_LINE_INTEGRATION")
        )) ? (
          <Link title={m("整合設定中心")} href={`/merchant/integrations?organizationId=${workspace.id}`} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-stone-100">
            <Cable className="h-5 w-5" /><span className="sr-only">{m("整合設定中心")}</span>
          </Link>
        ) : null}
      </nav>
    );
  }

  return (
    <>
      <header className="z-30 border-b border-stone-200 bg-white/95 backdrop-blur md:sticky md:top-0">
        <div className="mx-auto flex max-w-7xl items-center gap-1 px-2 py-2 sm:gap-2 sm:px-4 md:px-8 md:py-3">
          <Link
            href={workspace ? `/merchant/dashboard?organizationId=${workspace.id}` : "/merchant/dashboard"}
            aria-label={m("攤點通")}
            className="inline-flex h-11 min-w-11 flex-1 items-center gap-2 overflow-hidden font-semibold text-stone-950 md:flex-none"
          >
            <Store className="h-5 w-5 shrink-0 text-teal-700" />
            <span className="hidden truncate min-[420px]:inline">{m("攤點通")}</span>
          </Link>

          {renderFunctionNavigation("hidden min-w-0 flex-1 justify-end lg:flex", "merchant-function-navigation-desktop")}

          <div data-testid="merchant-utility-toolbar" data-persist-horizontal-scroll="merchant-utility-toolbar" className="ml-auto flex min-w-0 shrink-0 items-center gap-1 overflow-x-auto [&_button]:h-11 [&_button]:w-11 [&_label]:h-11 [&_label]:min-h-11 [&_label]:w-11 [&_span[title]]:h-11 [&_span[title]]:w-11 [&_span[title]]:justify-center [&_span[title]]:px-0 [&_svg]:h-5 [&_svg]:w-5">
            {workspace ? (
              <WorkModeSwitcher
                destinations={workModeDestinations}
                currentMode="MERCHANT"
                organizationId={workspace.id}
              />
            ) : null}
            {organizationDestinations.length > 1 ? (
              <WorkspaceSwitcher
                kind="ORGANIZATION"
                destinations={organizationDestinations}
                currentValue={workspace?.id ?? ""}
                label={m("選擇商家")}
              />
            ) : null}
            {singleActiveStall ? (
              <Link
                data-testid="merchant-single-stall-link"
                href={`/merchant/${encodeURIComponent(singleActiveStall.slug)}`}
                aria-label={`${m("選擇攤位")}：${singleActiveStall.name}`}
                title={`${m("選擇攤位")}：${singleActiveStall.name}`}
                className="inline-grid h-11 w-11 shrink-0 place-items-center rounded-md border border-stone-300 bg-white text-stone-700 transition-colors hover:border-teal-600 hover:bg-teal-50 hover:text-teal-800"
              >
                <Store className="h-5 w-5" />
              </Link>
            ) : activeStalls.length > 1 && workspace ? (
              <WorkspaceSwitcher
                kind="STALL"
                destinations={stallDestinations}
                currentValue={selectedScope}
                organizationId={workspace.id}
                label={m("選擇攤位")}
              />
            ) : null}
            <PwaControls afterAccessibility={merchantGuide} />
            <span className="hidden max-w-36 truncate text-sm text-stone-600 lg:inline">{displayName}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <div className="sticky top-0 z-30 min-w-0 overflow-x-hidden border-b border-stone-200 bg-white/95 px-4 py-1 backdrop-blur lg:hidden">
        <div className="mx-auto min-w-0 max-w-full">
          <MobileSeniorActionMenu label={m("商戶功能")}>
            {renderFunctionNavigation("flex w-full", "merchant-function-navigation-mobile")}
          </MobileSeniorActionMenu>
        </div>
      </div>
    </>
  );
}

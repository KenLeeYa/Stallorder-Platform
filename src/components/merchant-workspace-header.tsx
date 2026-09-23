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
import { WorkspaceFunctionNavigation, type WorkspaceFunction } from "@/components/workspace-function-navigation";
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
  const { m, locale } = useMerchantMessages();
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

  const orgHref = (path: string) => `${path}?organizationId=${encodeURIComponent(workspace?.id ?? "")}`;
  const can = (permission: Parameters<typeof hasPermission>[1]) => workspace?.roles.some(role => hasPermission(role, permission));
  const owner = workspace?.roles.some(role => ["PLATFORM_ADMIN", "ORGANIZATION_OWNER", "ORGANIZATION_ADMIN"].includes(role));
  const navigation: WorkspaceFunction[] = [
    { href: orgHref("/merchant/dashboard"), label: m("儀表板"), icon: BarChart3, group: "operations", primary: true },
    { href: orgHref("/merchant/stalls"), label: m("管理攤位"), icon: Building2, group: "merchants", primary: true },
  ];
  if (owner) navigation.push({ href: orgHref("/merchant/catalog"), label: m("共用商品"), icon: Package, group: "merchants", primary: true });
  if (owner || workspace?.roles.includes("FINANCE_VIEWER")) navigation.push({ href: orgHref("/merchant/reports/overview"), label: m("攤位報表"), icon: FileChartColumn, group: "operations", primary: true });
  if (can("VIEW_REPORTS")) navigation.push({ href: orgHref("/merchant/operating-profit"), label: m("營業損益與成本"), icon: ChartNoAxesCombined, group: "finance" });
  if (showSupply && can("MANAGE_SHARED_PRODUCTS")) navigation.push({ href: orgHref("/merchant/supply"), label: m("庫存與配方"), icon: Boxes, group: "merchants" });
  if (can("MANAGE_ATTENDANCE") || workspace?.stalls.some(stall => stall.roles.some(role => hasPermission(role, "MANAGE_ATTENDANCE")))) navigation.push({ href: orgHref("/merchant/workforce"), label: m("員工排班與薪資"), icon: BriefcaseBusiness, group: "operations" });
  if (showGrowth && can("MANAGE_ORGANIZATION")) navigation.push({ href: orgHref("/merchant/growth"), label: m("會員與成長"), icon: UsersRound, group: "merchants" });
  if (can("VIEW_AUDIT_LOGS") || workspace?.stalls.some(stall => stall.roles.some(role => hasPermission(role, "MANAGE_OPERATIONAL_ALERTS")))) navigation.push({ href: orgHref("/merchant/operations"), label: m("稽核與營運警示"), icon: ScrollText, group: "audit" });
  if (showBilling && can("VIEW_BILLING")) navigation.push({ href: orgHref("/merchant/billing"), label: m("訂閱與帳務"), icon: CreditCard, group: "finance" });
  if (showPayments && can("MANAGE_PAYMENT_INTEGRATIONS")) navigation.push({ href: orgHref("/merchant/payments"), label: m("付款與金流"), icon: WalletCards, group: "finance" });
  if (can("MANAGE_ORGANIZATION") || can("MANAGE_DELIVERY_INTEGRATIONS") || can("MANAGE_PAYMENT_INTEGRATIONS") || can("MANAGE_LINE_INTEGRATION")) navigation.push({ href: orgHref("/merchant/integrations"), label: m("整合設定中心"), icon: Cable, group: "settings" });
  navigation.push({ href: "/merchant/account/security", label: m("帳號與安全性"), icon: ShieldCheck, group: "audit" });

  return (
    <>
      <header data-testid="merchant-workspace-header" className="z-30 overflow-x-clip border-b border-stone-200 bg-white/95 backdrop-blur md:sticky md:top-0">
        <div className="mx-auto flex max-w-7xl items-center gap-1 px-2 py-2 sm:gap-2 sm:px-4 md:px-8 md:py-3">
          <Link
            href={workspace ? `/merchant/dashboard?organizationId=${workspace.id}` : "/merchant/dashboard"}
            aria-label={m("攤點通")}
            className="inline-flex h-11 min-w-11 flex-none items-center gap-2 overflow-hidden font-semibold text-stone-950"
          >
            <Store className="h-5 w-5 shrink-0 text-teal-700" />
            <span className="hidden truncate min-[420px]:inline">{m("攤點通")}</span>
          </Link>



          <div data-testid="merchant-utility-toolbar" data-persist-horizontal-scroll="merchant-utility-toolbar" className="ml-auto flex min-w-0 flex-1 items-center gap-1 overflow-x-auto lg:flex-none [&_button]:h-11 [&_button]:w-11 [&_label]:h-11 [&_label]:min-h-11 [&_label]:w-11 [&_span[title]]:h-11 [&_span[title]]:w-11 [&_span[title]]:justify-center [&_span[title]]:px-0 [&_svg]:h-5 [&_svg]:w-5">
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
      <div className="border-b border-stone-200 bg-white px-3 py-2 sm:px-4">
        <div className="mx-auto max-w-7xl">
          <div className="hidden lg:block"><WorkspaceFunctionNavigation items={navigation} locale={locale} label={m("商戶功能")} testId="merchant-function-navigation-desktop" /></div>
          <div className="lg:hidden"><WorkspaceFunctionNavigation items={navigation} locale={locale} label={m("商戶功能")} testId="merchant-function-navigation-mobile" /></div>
        </div>
      </div>
    </>
  );
}

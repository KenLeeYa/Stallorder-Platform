"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  Building2,
  ChevronDown,
  ChevronUp,
  CreditCard,
  FileChartColumn,
  Package,
  ScrollText,
  ShieldCheck,
  WalletCards,
  Store,
} from "lucide-react";
import { LogoutButton } from "@/components/logout-button";
import { PwaControls } from "@/components/pwa-controls";
import { WorkModeSwitcher } from "@/components/work-mode-switcher";
import { hasPermission } from "@/lib/rbac";
import { buildWorkModeDestinations } from "@/lib/work-mode";
import { useMerchantMessages } from "@/lib/messages/merchant-client";
import type { WorkspaceOrganization } from "@/lib/workspace";
import type { WorkspaceRouteContext } from "@/lib/workspace-route-context";

const ORGANIZATION_STORAGE_KEY = "stallorder.organization.preference";

export function MerchantWorkspaceHeader({
  workspaces,
  displayName,
  routeContext,
  showBilling,
}: {
  workspaces: WorkspaceOrganization[];
  displayName: string;
  routeContext: WorkspaceRouteContext;
  showBilling: boolean;
}) {
  const { m } = useMerchantMessages();
  const router = useRouter();
  const [preferredOrganizationId, setPreferredOrganizationId] = useState(
    routeContext.organizationId ?? workspaces[0]?.id ?? "",
  );
  const organizationId = routeContext.organizationId ?? preferredOrganizationId;
  const [mobileOptionsOpen, setMobileOptionsOpen] = useState(false);

  const workspace = useMemo(
    () => workspaces.find((candidate) => candidate.id === organizationId) ?? workspaces[0],
    [organizationId, workspaces],
  );
  const routeStall = routeContext.stallId
    ? workspaces.flatMap((candidate) => candidate.stalls)
      .find((stall) => stall.id === routeContext.stallId)
    : undefined;
  const activeStalls = workspace?.stalls.filter((stall) => stall.isActive) ?? [];
  const showOrganizationSelector = workspaces.length > 1;
  const showStallSelector = activeStalls.length > 1;
  const singleStall = activeStalls.length === 1 ? activeStalls[0] : null;
  const workModeDestinations = useMemo(
    () => buildWorkModeDestinations(workspaces),
    [workspaces],
  );
  const selectedScope = routeStall?.organizationId === workspace?.id
    ? routeStall.id
    : (workspace?.canUseAllStalls ? "ALL_STALLS" : activeStalls[0]?.id ?? "");

  function selectOrganization(nextOrganizationId: string) {
    setPreferredOrganizationId(nextOrganizationId);
    window.localStorage.setItem(ORGANIZATION_STORAGE_KEY, nextOrganizationId);
    router.push(`/merchant/dashboard?organizationId=${nextOrganizationId}`);
  }

  function selectScope(scope: string) {
    if (!workspace) return;
    window.localStorage.setItem(ORGANIZATION_STORAGE_KEY, workspace.id);
    if (scope === "ALL_STALLS") {
      router.push(`/merchant/stalls?organizationId=${workspace.id}`);
      return;
    }
    const stall = workspace.stalls.find((candidate) => candidate.id === scope);
    if (stall) router.push(`/merchant/${stall.slug}`);
  }

  function renderFunctionNavigation(className: string, testId: string) {
    return (
      <nav data-testid={testId} className={`min-w-0 items-center gap-1 overflow-x-auto ${className}`} aria-label={m("商戶功能")}>
        <Link title={m("儀表板")} href={`/merchant/dashboard?organizationId=${workspace?.id ?? ""}`} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-stone-100">
          <BarChart3 className="h-5 w-5" /><span className="sr-only">{m("儀表板")}</span>
        </Link>
        {workspace?.roles.some((role) => role === "PLATFORM_ADMIN" || role === "ORGANIZATION_OWNER" || role === "ORGANIZATION_ADMIN" || role === "FINANCE_VIEWER") ? (
          <Link title={m("跨攤位報表")} href={`/merchant/reports/overview?organizationId=${workspace.id}`} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-stone-100">
            <FileChartColumn className="h-5 w-5" /><span className="sr-only">{m("跨攤位報表")}</span>
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
        {workspace?.roles.some((role) => hasPermission(role, "MANAGE_PAYMENT_INTEGRATIONS")) ? (
          <Link title={m("付款與金流")} href={`/merchant/payments?organizationId=${workspace.id}`} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-stone-100">
            <WalletCards className="h-5 w-5" /><span className="sr-only">{m("付款與金流")}</span>
          </Link>
        ) : null}
      </nav>
    );
  }

  return (
    <>
      <header className="z-30 border-b border-stone-200 bg-white/95 backdrop-blur md:sticky md:top-0">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-2 md:gap-3 md:px-8 md:py-3">
          <Link
            href={workspace ? `/merchant/dashboard?organizationId=${workspace.id}` : "/merchant/dashboard"}
            className="order-1 inline-flex min-h-11 min-w-0 flex-1 items-center gap-2 font-semibold text-stone-950 md:mr-auto md:flex-none"
          >
            <Store className="h-5 w-5 shrink-0 text-teal-700" />
            <span className="truncate">{m("攤點通")}</span>
          </Link>

          <div className="order-2 ml-auto flex shrink-0 items-center gap-1 md:order-3 md:ml-0">
            <PwaControls />
            <span className="hidden max-w-36 truncate text-sm text-stone-600 lg:inline">{displayName}</span>
            <LogoutButton />
            <button
              type="button"
              aria-expanded={mobileOptionsOpen}
              aria-controls="merchant-mobile-options"
              aria-label={mobileOptionsOpen ? m("收合商戶選項") : m("展開商戶選項")}
              title={mobileOptionsOpen ? m("收合商戶選項") : m("展開商戶選項")}
              onClick={() => setMobileOptionsOpen((open) => !open)}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-stone-300 bg-white text-stone-700 md:hidden"
            >
              {mobileOptionsOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
            </button>
          </div>

          <div
            id="merchant-mobile-options"
            className={`${mobileOptionsOpen ? "flex" : "hidden"} order-3 w-full min-w-0 flex-col gap-3 border-t border-stone-200 pt-3 md:order-2 md:flex md:w-auto md:flex-row md:items-end md:border-0 md:pt-0`}
          >
            <div className="flex w-full min-w-0 flex-wrap items-end gap-2 md:w-auto md:gap-3">
              {showOrganizationSelector ? (
              <label className="order-3 min-w-40 flex-1 text-xs font-medium text-stone-500 md:order-1 md:flex-none">
                {m("商家")}
                <select
                  aria-label={m("選擇商家")}
                  value={workspace?.id ?? ""}
                  onChange={(event) => selectOrganization(event.target.value)}
                  className="mt-1 block h-11 w-full min-w-0 rounded-md border border-stone-300 bg-white px-2 text-sm font-semibold text-stone-900 md:h-10 md:max-w-[190px]"
                >
                  {workspaces.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.businessName}</option>
                  ))}
                </select>
              </label>
              ) : null}

              {showStallSelector ? (
              <label className="order-2 min-w-40 flex-1 text-xs font-medium text-stone-500 md:order-2 md:flex-none">
                {m("攤位")}
                <select
                  aria-label={m("選擇攤位")}
                  value={selectedScope}
                  onChange={(event) => selectScope(event.target.value)}
                  className="mt-1 block h-11 w-full min-w-0 rounded-md border border-stone-300 bg-white px-2 text-sm font-semibold text-stone-900 md:h-10 md:max-w-[190px]"
                >
                  {workspace?.canUseAllStalls ? <option value="ALL_STALLS">{m("全部攤位")}</option> : null}
                  {activeStalls.map((stall) => <option key={stall.id} value={stall.id}>{stall.name}</option>)}
                </select>
              </label>
              ) : singleStall ? (
                <Link
                  href={`/merchant/${singleStall.slug}`}
                  aria-label={m("前往攤位 {name}", { name: singleStall.name })}
                  className="order-2 inline-flex h-11 min-w-0 flex-[1_1_44%] items-center justify-center gap-2 rounded-full border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-900 transition-colors hover:border-teal-600 hover:bg-teal-50 md:h-10 md:flex-none"
                >
                  <Store className="h-4 w-4 shrink-0 text-teal-700" />
                  <span className="truncate">{singleStall.name}</span>
                </Link>
              ) : null}

              {workspace ? (
                <WorkModeSwitcher
                  destinations={workModeDestinations}
                  currentMode="MERCHANT"
                  organizationId={workspace.id}
                  compactOnMobile
                  className="order-1 min-w-0 flex-[1_1_44%] md:order-3 md:flex-none"
                />
              ) : null}
            </div>

            {renderFunctionNavigation("hidden md:flex md:w-auto", "merchant-function-navigation-desktop")}
          </div>
        </div>
      </header>
      <div className="sticky top-0 z-30 min-w-0 overflow-x-hidden border-b border-stone-200 bg-white/95 px-4 py-1 backdrop-blur md:hidden">
        <div className="mx-auto min-w-0 max-w-full">
          {renderFunctionNavigation("flex w-full", "merchant-function-navigation-mobile")}
        </div>
      </div>
    </>
  );
}

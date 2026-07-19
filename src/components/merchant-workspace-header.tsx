"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BarChart3, Building2, CalendarClock, CreditCard, FileChartColumn, Languages, Package, Rocket, ScrollText, Store, Users } from "lucide-react";
import { LogoutButton } from "@/components/logout-button";
import { PwaControls } from "@/components/pwa-controls";
import { hasPermission } from "@/lib/rbac";
import type { WorkspaceOrganization } from "@/lib/workspace";

const ORGANIZATION_STORAGE_KEY = "stallorder.organization.preference";

export function MerchantWorkspaceHeader({
  workspaces,
  displayName,
}: {
  workspaces: WorkspaceOrganization[];
  displayName: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pathStall = workspaces
    .flatMap((workspace) => workspace.stalls)
    .find((stall) => pathname === `/merchant/${stall.slug}` || pathname.includes(`/staff/${stall.slug}`));
  const queryOrganizationId = searchParams.get("organizationId");
  const initialOrganizationId = queryOrganizationId
    ?? pathStall?.organizationId
    ?? workspaces[0]?.id
    ?? "";
  const [organizationId, setOrganizationId] = useState(initialOrganizationId);

  const workspace = useMemo(
    () => workspaces.find((candidate) => candidate.id === organizationId) ?? workspaces[0],
    [organizationId, workspaces],
  );
  const activeStalls = workspace?.stalls.filter((stall) => stall.isActive) ?? [];
  const selectedScope = pathStall?.id
    ?? (workspace?.canUseAllStalls ? "ALL_STALLS" : activeStalls[0]?.id ?? "");

  function selectOrganization(nextOrganizationId: string) {
    setOrganizationId(nextOrganizationId);
    window.localStorage.setItem(ORGANIZATION_STORAGE_KEY, nextOrganizationId);
    router.push(`/merchant/dashboard?organizationId=${nextOrganizationId}`);
  }

  function selectScope(scope: string) {
    if (!workspace) return;
    window.localStorage.setItem(ORGANIZATION_STORAGE_KEY, workspace.id);
    if (scope === "ALL_STALLS") {
      router.push(`/merchant/dashboard?organizationId=${workspace.id}`);
      return;
    }
    const stall = workspace.stalls.find((candidate) => candidate.id === scope);
    if (stall) router.push(`/merchant/${stall.slug}`);
  }

  return (
    <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 md:px-8">
        <Link href="/merchant/dashboard" className="mr-auto inline-flex min-h-11 items-center gap-2 font-semibold text-stone-950">
          <Store className="h-5 w-5 text-teal-700" />
          攤點通
        </Link>

        <label className="min-w-0 text-xs font-medium text-stone-500">
          組織
          <select
            aria-label="選擇組織"
            value={workspace?.id ?? ""}
            onChange={(event) => selectOrganization(event.target.value)}
            className="mt-1 block h-10 max-w-[190px] rounded-md border border-stone-300 bg-white px-2 text-sm font-semibold text-stone-900"
          >
            {workspaces.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{candidate.businessName}</option>
            ))}
          </select>
        </label>

        <label className="min-w-0 text-xs font-medium text-stone-500">
          檢視範圍
          <select
            aria-label="選擇攤位範圍"
            value={selectedScope}
            onChange={(event) => selectScope(event.target.value)}
            className="mt-1 block h-10 max-w-[190px] rounded-md border border-stone-300 bg-white px-2 text-sm font-semibold text-stone-900"
          >
            {workspace?.canUseAllStalls ? <option value="ALL_STALLS">全部攤位</option> : null}
            {activeStalls.map((stall) => <option key={stall.id} value={stall.id}>{stall.name}</option>)}
          </select>
        </label>

        <nav className="flex w-full min-w-0 items-center gap-1 overflow-x-auto md:w-auto" aria-label="商戶功能">
          {workspace?.roles.some((role) => role === "PLATFORM_ADMIN" || role === "ORGANIZATION_OWNER") ? (
            <Link title="開店設定" href={`/merchant/setup?organizationId=${workspace.id}`} className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-stone-100">
              <Rocket className="h-5 w-5" /><span className="sr-only">開店設定</span>
            </Link>
          ) : null}
          <Link title="儀表板" href={`/merchant/dashboard?organizationId=${workspace?.id ?? ""}`} className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-stone-100">
            <BarChart3 className="h-5 w-5" /><span className="sr-only">儀表板</span>
          </Link>
          {workspace?.roles.some((role) => role === "PLATFORM_ADMIN" || role === "ORGANIZATION_OWNER" || role === "ORGANIZATION_ADMIN" || role === "FINANCE_VIEWER") ? (
            <Link title="跨攤位報表" href={`/merchant/reports/overview?organizationId=${workspace.id}`} className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-stone-100">
              <FileChartColumn className="h-5 w-5" /><span className="sr-only">跨攤位報表</span>
            </Link>
          ) : null}
          <Link title="管理攤位" href={`/merchant/stalls?organizationId=${workspace?.id ?? ""}`} className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-stone-100">
            <Building2 className="h-5 w-5" /><span className="sr-only">管理攤位</span>
          </Link>
          {workspace?.roles.some((role) => role === "PLATFORM_ADMIN" || role === "ORGANIZATION_OWNER" || role === "ORGANIZATION_ADMIN") ? (
            <>
              <Link title="共用商品" href={`/merchant/catalog?organizationId=${workspace.id}`} className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-stone-100">
                <Package className="h-5 w-5" /><span className="sr-only">共用商品</span>
              </Link>
              <Link title="翻譯完整度" href={`/merchant/localization?organizationId=${workspace.id}`} className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-stone-100">
                <Languages className="h-5 w-5" /><span className="sr-only">翻譯完整度</span>
              </Link>
            </>
          ) : null}
          <Link title="團隊" href={`/merchant/team?organizationId=${workspace?.id ?? ""}`} className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-stone-100">
            <Users className="h-5 w-5" /><span className="sr-only">團隊</span>
          </Link>
          {workspace && (
            workspace.roles.some((role) => hasPermission(role, "VIEW_AUDIT_LOGS"))
            || workspace.stalls.some((stall) => stall.roles.some((role) => hasPermission(role, "MANAGE_OPERATIONAL_ALERTS")))
          ) ? (
            <Link title="稽核與營運警示" href={`/merchant/operations?organizationId=${workspace.id}`} className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-stone-100">
              <ScrollText className="h-5 w-5" /><span className="sr-only">稽核與營運警示</span>
            </Link>
          ) : null}
          {workspace?.roles.some((role) => hasPermission(role, "VIEW_BILLING")) ? (
            <Link title="訂閱與帳務" href={`/merchant/billing?organizationId=${workspace.id}`} className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-stone-100">
              <CreditCard className="h-5 w-5" /><span className="sr-only">訂閱與帳務</span>
            </Link>
          ) : null}
          {workspace?.roles.some((role) => hasPermission(role, "MANAGE_REPORT_SCHEDULES")) ? (
            <Link title="報表排程" href={`/merchant/report-schedules?organizationId=${workspace.id}`} className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-stone-100">
              <CalendarClock className="h-5 w-5" /><span className="sr-only">報表排程</span>
            </Link>
          ) : null}
        </nav>

        <PwaControls />
        <span className="hidden max-w-36 truncate text-sm text-stone-600 lg:inline">{displayName}</span>
        <LogoutButton />
      </div>
    </header>
  );
}

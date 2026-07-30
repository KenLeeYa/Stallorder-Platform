import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  Building2,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Clock3,
  Copy,
  Gauge,
  Languages,
  ListTree,
  MapPinned,
  MessageCircle,
  MonitorUp,
  Settings2,
  SlidersHorizontal,
  Store,
  TabletSmartphone,
  Truck,
  UserRoundCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import { hasPermission } from "@/lib/rbac";
import { requireWorkspacePage } from "@/lib/workspace";
import { resolveDeliveryFeatureState } from "@/server/delivery-platforms/delivery-feature-flags";

type PageProps = { params: Promise<{ stallId: string }> };

function SettingsLink({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-12 max-w-full items-center gap-2 rounded-md border border-stone-300 bg-white px-3 py-2.5 text-sm font-semibold text-stone-900 transition-colors hover:border-teal-600 hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
    >
      <Icon className="h-4 w-4 shrink-0 text-teal-700" />
      <span className="min-w-0">{label}</span>
    </Link>
  );
}

export default async function EditStallPage({ params }: PageProps) {
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
        返回攤位管理
      </Link>

      <header className="mt-4 border-b border-stone-200 pb-5">
        <p className="text-sm font-semibold text-teal-800">{workspace.businessName}</p>
        <h1 className="mt-1 text-3xl font-semibold">{stall.name}</h1>
        <p className="mt-2 text-sm text-stone-500">{stall.slug}</p>
      </header>

      <section aria-labelledby="stall-settings-title" className="border-b border-stone-200 py-6">
        <h2 id="stall-settings-title" className="text-lg font-semibold">攤位設定</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          <SettingsLink href={`/merchant/stalls/${stall.id}/settings/basic`} icon={Store} label="基本資料" />
          <SettingsLink href={`/merchant/stalls/${stall.id}/settings/operations`} icon={Activity} label="營運狀態" />
          <SettingsLink href={`/merchant/stalls/${stall.id}/settings/business-hours`} icon={Clock3} label="營業時間" />
          <SettingsLink href={`/merchant/stalls/${stall.id}/settings/modules`} icon={SlidersHorizontal} label="營運模組與內用桌位" />
          <SettingsLink href={`/merchant/stalls/${stall.id}/settings/templates`} icon={Copy} label="多攤位範本" />
          <SettingsLink href={`/merchant/stalls/${stall.id}/settings/members`} icon={UserRoundCog} label="攤位成員" />
        </div>
      </section>

      <section aria-labelledby="operational-tools-title" className="border-b border-stone-200 py-6">
        <h2 id="operational-tools-title" className="text-lg font-semibold">營運工具</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          <SettingsLink href={`/merchant/stalls/${stall.id}/kitchen/stations`} icon={ListTree} label="KDS 工作站" />
          <SettingsLink href={`/merchant/stalls/${stall.id}/kitchen/settings`} icon={Settings2} label="KDS 設定" />
          <SettingsLink href={`/merchant/stalls/${stall.id}/display`} icon={MonitorUp} label="CDS 取餐顯示" />
          <SettingsLink href={`/merchant/stalls/${stall.id}/capacity`} icon={Gauge} label="產能與等候時間" />
          <SettingsLink href={`/merchant/stalls/${stall.id}/locations`} icon={MapPinned} label="常用地點" />
          <SettingsLink href={`/merchant/stalls/${stall.id}/schedule`} icon={CalendarRange} label="出攤行程" />
          <SettingsLink href={`/merchant/stalls/${stall.id}/line`} icon={MessageCircle} label="LINE 通知" />
          {canManageDelivery ? (
            <SettingsLink href={`/merchant/integrations/delivery?stallId=${stall.id}`} icon={Truck} label="外送平台整合" />
          ) : null}
          <SettingsLink href={`/merchant/stalls/${stall.id}/offline`} icon={TabletSmartphone} label="離線裝置" />
        </div>
      </section>

      <section aria-labelledby="organization-settings-title" className="py-6">
        <h2 id="organization-settings-title" className="text-lg font-semibold">組織管理</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {workspace.roles.some((role) => hasPermission(role, "MANAGE_ORGANIZATION")) ? (
            <SettingsLink href={`/merchant/organization?organizationId=${workspace.id}&stallId=${stall.id}`} icon={Building2} label="商家資料" />
          ) : null}
          {canManageLocalization ? (
            <SettingsLink href={`/merchant/localization?organizationId=${workspace.id}&stallId=${stall.id}`} icon={Languages} label="翻譯完整度" />
          ) : null}
          {canManageEvents ? (
            <SettingsLink href={`/merchant/events?organizationId=${workspace.id}&stallId=${stall.id}`} icon={CalendarDays} label="市集活動" />
          ) : null}
          {canManageTeam ? (
            <SettingsLink href={`/merchant/team?organizationId=${workspace.id}&stallId=${stall.id}`} icon={Users} label="團隊與權限" />
          ) : null}
          {canManageReportSchedules ? (
            <SettingsLink href={`/merchant/report-schedules?organizationId=${workspace.id}&stallId=${stall.id}`} icon={CalendarClock} label="排程寄送" />
          ) : null}
        </div>
      </section>
    </main>
  );
}

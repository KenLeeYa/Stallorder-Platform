"use client";

import Link from "next/link";
import {
  Activity,
  Building2,
  CalendarClock,
  CalendarDays,
  CalendarOff,
  CalendarRange,
  Clock3,
  Copy,
  Gauge,
  Dices,
  Languages,
  ListTree,
  MapPinned,
  MapPinCheck,
  MessageCircle,
  MonitorUp,
  Percent,
  Printer,
  Rocket,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Store,
  TabletSmartphone,
  Truck,
  Utensils,
  UserRoundCog,
  Users,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import { useMerchantMessages } from "@/lib/messages/merchant-client";

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
      className="inline-flex min-h-14 w-full min-w-0 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 py-2.5 text-left text-sm font-semibold text-stone-900 transition-colors hover:border-teal-600 hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 sm:min-h-12 sm:w-auto"
    >
      <Icon className="h-4 w-4 shrink-0 text-teal-700" />
      <span className="min-w-0">{label}</span>
    </Link>
  );
}

export function StallSettingsOverview({
  workspaceId,
  stallId,
  canManageLocalization,
  canManageEvents,
  canManageTeam,
  canManageAttendance,
  canManageOrdering,
  canManageReportSchedules,
  canManageOrganization,
  canManageDelivery,
  kdsEnabled,
  showMerchantSetup,
  multiStallMode,
}: {
  workspaceId: string;
  stallId: string;
  canManageLocalization: boolean;
  canManageEvents: boolean;
  canManageTeam: boolean;
  canManageAttendance: boolean;
  canManageOrdering: boolean;
  canManageReportSchedules: boolean;
  canManageOrganization: boolean;
  canManageDelivery: boolean;
  kdsEnabled: boolean;
  showMerchantSetup: boolean;
  multiStallMode: boolean;
}) {
  const { m } = useMerchantMessages();

  return (
    <>
      <section aria-labelledby="stall-settings-title" className="border-b border-stone-200 py-6">
        <h2 id="stall-settings-title" className="text-lg font-semibold">{m("攤位設定")}</h2>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <SettingsLink href={`/merchant/stalls/${stallId}/settings/basic`} icon={Store} label={m("基本資料")} />
          <SettingsLink href={`/merchant/stalls/${stallId}/settings/operations`} icon={Activity} label={m("營運狀態")} />
          <SettingsLink href={`/merchant/stalls/${stallId}/settings/business-hours`} icon={Clock3} label={m("營業時間")} />
          <SettingsLink href={`/merchant/stalls/${stallId}/settings/special-hours`} icon={CalendarOff} label={m("特殊營業日與公休公告")} />
          <SettingsLink href={`/merchant/stalls/${stallId}/settings/dine-in`} icon={Utensils} label={m("內用點餐")} />
          <SettingsLink href={`/merchant/stalls/${stallId}/settings/dining-tables`} icon={MapPinned} label={m("內用桌位與專屬 QR")} />
          <SettingsLink href={`/merchant/stalls/${stallId}/settings/online-ordering`} icon={CalendarClock} label={m("線上點餐與預約")} />
          <SettingsLink href={`/merchant/stalls/${stallId}/settings/staff-delivery`} icon={Truck} label={m("店員外送點餐")} />
          <SettingsLink href={`/merchant/stalls/${stallId}/settings/printing`} icon={Printer} label={m("訂單列印")} />
          <SettingsLink href={`/merchant/stalls/${stallId}/settings/kds`} icon={SlidersHorizontal} label={m("廚房 KDS")} />
          <SettingsLink href={`/merchant/stalls/${stallId}/settings/payments`} icon={WalletCards} label={m("付款方式")} />
          <SettingsLink href={`/merchant/stalls/${stallId}/settings/discounts`} icon={Percent} label={m("結帳折扣")} />
          <SettingsLink href={`/merchant/stalls/${stallId}/settings/lottery`} icon={Dices} label={m("抽抽樂推薦")} />
          <SettingsLink href={`/merchant/stalls/${stallId}/settings/languages`} icon={Languages} label={m("QR 點餐語系")} />
          {canManageOrdering ? (
            <SettingsLink href={`/merchant/stalls/${stallId}/settings/order-limits`} icon={ShieldCheck} label={m("安全與訂單限制")} />
          ) : null}
          {multiStallMode ? <SettingsLink href={`/merchant/stalls/${stallId}/settings/templates`} icon={Copy} label={m("多攤位範本")} /> : null}
          <SettingsLink href={`/merchant/stalls/${stallId}/settings/members`} icon={UserRoundCog} label={m("攤位成員")} />
          {canManageAttendance ? <SettingsLink href={`/merchant/stalls/${stallId}/attendance`} icon={MapPinCheck} label={m("員工定位打卡")} /> : null}
          {showMerchantSetup ? (
            <SettingsLink href={`/merchant/setup?organizationId=${workspaceId}`} icon={Rocket} label={m("開店設定")} />
          ) : null}
        </div>
      </section>

      <section aria-labelledby="operational-tools-title" className="border-b border-stone-200 py-6">
        <h2 id="operational-tools-title" className="text-lg font-semibold">{m("營運工具")}</h2>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {kdsEnabled ? <SettingsLink href={`/merchant/stalls/${stallId}/kitchen/stations`} icon={ListTree} label={m("KDS 工作站")} /> : null}
          {kdsEnabled ? <SettingsLink href={`/merchant/stalls/${stallId}/kitchen/settings`} icon={Settings2} label={m("KDS 設定")} /> : null}
          <SettingsLink href={`/merchant/stalls/${stallId}/display`} icon={MonitorUp} label={m("CDS 取餐顯示")} />
          <SettingsLink href={`/merchant/stalls/${stallId}/capacity`} icon={Gauge} label={m("產能與等候時間")} />
          <SettingsLink href={`/merchant/stalls/${stallId}/locations`} icon={MapPinned} label={m("常用地點")} />
          <SettingsLink href={`/merchant/stalls/${stallId}/schedule`} icon={CalendarRange} label={m("出攤行程")} />
          <SettingsLink href={`/merchant/stalls/${stallId}/line`} icon={MessageCircle} label={m("LINE 通知")} />
          {canManageDelivery ? (
            <SettingsLink href={`/merchant/integrations/delivery?stallId=${stallId}`} icon={Truck} label={m("外送平台整合")} />
          ) : null}
          <SettingsLink href={`/merchant/stalls/${stallId}/offline`} icon={TabletSmartphone} label={m("離線裝置")} />
        </div>
      </section>

      <section aria-labelledby="organization-settings-title" className="py-6">
        <h2 id="organization-settings-title" className="text-lg font-semibold">{m("組織管理")}</h2>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {canManageOrganization ? (
            <SettingsLink href={`/merchant/organization?organizationId=${workspaceId}&stallId=${stallId}`} icon={Building2} label={m("商家資料")} />
          ) : null}
          {canManageLocalization ? (
            <SettingsLink href={`/merchant/localization?organizationId=${workspaceId}&stallId=${stallId}`} icon={Languages} label={m("翻譯完整度")} />
          ) : null}
          {canManageEvents ? (
            <SettingsLink href={`/merchant/events?organizationId=${workspaceId}&stallId=${stallId}`} icon={CalendarDays} label={m("市集活動")} />
          ) : null}
          {canManageTeam ? (
            <SettingsLink href={`/merchant/team?organizationId=${workspaceId}&stallId=${stallId}`} icon={Users} label={m("團隊與權限")} />
          ) : null}
          {canManageReportSchedules ? (
            <SettingsLink href={`/merchant/report-schedules?organizationId=${workspaceId}&stallId=${stallId}`} icon={CalendarClock} label={m("排程寄送")} />
          ) : null}
        </div>
      </section>
    </>
  );
}

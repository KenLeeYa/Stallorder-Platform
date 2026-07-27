import Link from "next/link";
import { ChefHat, ListTree, Settings2 } from "lucide-react";
import { WorkModeSwitcher } from "@/components/work-mode-switcher";
import type { WorkModeDestination } from "@/lib/work-mode";

type Props = {
  active: "BOARD" | "STATIONS" | "SETTINGS";
  stall: { id: string; organizationId: string; slug: string; name: string };
  availableStalls: Array<{ slug: string; name: string }>;
  canManage: boolean;
  workModeDestinations: WorkModeDestination[];
};

export function KitchenNavigation({ active, stall, availableStalls, canManage, workModeDestinations }: Props) {
  const links = [
    {
      key: "BOARD" as const,
      href: `/kitchen?stall=${encodeURIComponent(stall.slug)}`,
      label: "生產看板",
      icon: ChefHat,
    },
    ...(canManage ? [
      {
        key: "STATIONS" as const,
        href: `/merchant/stalls/${stall.id}/kitchen/stations`,
        label: "工作站設定",
        icon: ListTree,
      },
      {
        key: "SETTINGS" as const,
        href: `/merchant/stalls/${stall.id}/kitchen/settings`,
        label: "KDS 設定",
        icon: Settings2,
      },
    ] : []),
  ];
  return (
    <header className="border-b border-stone-200 bg-white">
      <div className="mx-auto max-w-[1600px] px-4 py-4 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <ChefHat className="h-7 w-7 shrink-0 text-teal-700" />
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold">廚房生產系統</h1>
              <p className="truncate text-sm text-stone-600">{stall.name}</p>
            </div>
          </div>
          <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
            <WorkModeSwitcher
              destinations={workModeDestinations}
              currentMode="KITCHEN"
              organizationId={stall.organizationId}
              stallId={stall.id}
              className="w-full sm:w-auto"
            />
            {availableStalls.length > 1 ? (
              <form method="get" className="flex items-end gap-2">
                <label className="block min-w-0 text-xs font-medium text-stone-500" htmlFor="kitchen-stall">
                  廚房攤位
                  <select id="kitchen-stall" name="stall" defaultValue={stall.slug} className="mt-1 block h-10 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-900">
                    {availableStalls.map((candidate) => <option key={candidate.slug} value={candidate.slug}>{candidate.name}</option>)}
                  </select>
                </label>
                <button type="submit" className="h-10 rounded-md bg-stone-900 px-3 text-sm font-semibold text-white">切換</button>
              </form>
            ) : null}
          </div>
        </div>
        <nav className="mt-4 flex gap-1 overflow-x-auto" aria-label="KDS 導覽">
          {links.map(({ key, href, label, icon: Icon }) => (
            <Link
              key={key}
              href={href}
              className={`inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-semibold ${active === key ? "border-teal-700 text-teal-800" : "border-transparent text-stone-600 hover:text-stone-950"}`}
            >
              <Icon className="h-4 w-4" />{label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

import Link from "next/link";
import { ChevronRight, Store } from "lucide-react";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { defaultPathForRole } from "@/lib/auth";
import { publicMessages } from "@/lib/messages/public";
import { resolvePrimaryRole } from "@/lib/rbac";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";

type PageProps = { searchParams: Promise<{ organizationId?: string }> };

export default async function SelectStallPage({ searchParams }: PageProps) {
  const [{ organizationId }, { workspaces }, requestLocale] = await Promise.all([
    searchParams,
    requireWorkspacePage(),
    getRequestAppLocale(),
  ]);
  const { locale } = requestLocale;
  const workspace = requireWorkspaceOrganization(workspaces, organizationId);
  const activeStalls = workspace.stalls.filter((stall) => stall.isActive);

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-10 md:px-8">
      <div className="flex items-center gap-3">
        <Store className="h-7 w-7 text-teal-700" />
        <div>
          <h1 className="text-2xl font-semibold">{publicMessages.get(locale, "selectStallTitle")}</h1>
          <p className="mt-1 text-sm text-stone-600">{workspace.businessName}</p>
        </div>
      </div>
      <div className="mt-7 divide-y divide-stone-200 border-y border-stone-200">
        {workspace.canUseAllStalls ? (
          <Link href={`/merchant/dashboard?organizationId=${workspace.id}`} className="flex min-h-20 items-center justify-between gap-4 px-2 py-4 hover:bg-white">
            <div><div className="font-semibold">{publicMessages.get(locale, "selectAllStalls")}</div><div className="mt-1 text-sm text-stone-500">{publicMessages.get(locale, "selectOrganizationWorkspace")}</div></div>
            <ChevronRight className="h-5 w-5 text-stone-400" />
          </Link>
        ) : null}
        {activeStalls.map((stall) => {
          const role = resolvePrimaryRole(stall.roles);
          return role ? (
            <Link key={stall.id} href={defaultPathForRole(role, stall.slug)} className="flex min-h-20 items-center justify-between gap-4 px-2 py-4 hover:bg-white">
              <div><div className="font-semibold">{stall.name}</div><div className="mt-1 text-sm text-stone-500">{publicMessages.get(locale, "selectStallCode", { code: stall.code })}</div></div>
              <ChevronRight className="h-5 w-5 text-stone-400" />
            </Link>
          ) : null;
        })}
      </div>
      {activeStalls.length === 0 ? <p className="mt-8 text-sm text-stone-600">{publicMessages.get(locale, "selectNoStalls")}</p> : null}
    </main>
  );
}

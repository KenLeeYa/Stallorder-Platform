import Link from "next/link";
import { Building2, ChevronRight } from "lucide-react";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { publicMessages } from "@/lib/messages/public";
import { requireMemberWorkspacePage } from "@/lib/workspace";

export default async function SelectOrganizationPage() {
  const [{ workspaces }, requestLocale] = await Promise.all([
    requireMemberWorkspacePage(),
    getRequestAppLocale(),
  ]);
  const { locale } = requestLocale;

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-10 md:px-8">
      <div className="flex items-center gap-3">
        <Building2 className="h-7 w-7 text-teal-700" />
        <div>
          <h1 className="text-2xl font-semibold">{publicMessages.get(locale, "selectOrganizationTitle")}</h1>
          <p className="mt-1 text-sm text-stone-600">{publicMessages.get(locale, "selectOrganizationSubtitle")}</p>
        </div>
      </div>
      <div className="mt-7 divide-y divide-stone-200 border-y border-stone-200">
        {workspaces.map((workspace) => (
          <Link
            key={workspace.id}
            href={workspace.canUseAllStalls
              ? `/merchant/dashboard?organizationId=${workspace.id}`
              : `/select-stall?organizationId=${workspace.id}`}
            className="flex min-h-20 items-center justify-between gap-4 px-2 py-4 hover:bg-white"
          >
            <div>
              <div className="font-semibold">{workspace.businessName}</div>
              <div className="mt-1 text-sm text-stone-500">{publicMessages.get(locale, "selectOrganizationStalls", { count: workspace.stalls.length })}</div>
            </div>
            <ChevronRight className="h-5 w-5 text-stone-400" />
          </Link>
        ))}
      </div>
    </main>
  );
}

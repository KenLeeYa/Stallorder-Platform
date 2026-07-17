import Link from "next/link";
import { Building2, ChevronRight } from "lucide-react";
import { requireWorkspacePage } from "@/lib/workspace";

export default async function SelectOrganizationPage() {
  const { workspaces } = await requireWorkspacePage();

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-10 md:px-8">
      <div className="flex items-center gap-3">
        <Building2 className="h-7 w-7 text-teal-700" />
        <div>
          <h1 className="text-2xl font-semibold">選擇組織</h1>
          <p className="mt-1 text-sm text-stone-600">可用工作區</p>
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
              <div className="mt-1 text-sm text-stone-500">可存取 {workspace.stalls.length} 個攤位</div>
            </div>
            <ChevronRight className="h-5 w-5 text-stone-400" />
          </Link>
        ))}
      </div>
    </main>
  );
}

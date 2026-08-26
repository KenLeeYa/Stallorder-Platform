import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, CheckCircle2, FlaskConical, LockKeyhole, Puzzle } from "lucide-react";
import { hasPermission } from "@/lib/rbac";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";
import { getCompetitiveModuleReadiness } from "@/server/competitive-enhancements/module-readiness";

type PageProps = { searchParams: Promise<{ organizationId?: string }> };
const presentations = {
  CORE_READY: { label: "核心已運作", className: "bg-emerald-50 text-emerald-800", icon: CheckCircle2 },
  LOCAL_VERIFICATION: { label: "本機測試中", className: "bg-violet-50 text-violet-800", icon: FlaskConical },
  EXTERNAL_LOCKED: { label: "外部驗證前關閉", className: "bg-amber-50 text-amber-800", icon: LockKeyhole },
  DISABLED: { label: "預設關閉", className: "bg-stone-100 text-stone-700", icon: LockKeyhole },
} as const;

export default async function EnhancementsPage({ searchParams }: PageProps) {
  const { organizationId } = await searchParams;
  const { workspaces } = await requireWorkspacePage();
  if (!organizationId && workspaces.length > 1) redirect("/select-organization");
  const workspace = requireWorkspaceOrganization(workspaces, organizationId);
  if (!workspace.roles.some((role) => hasPermission(role, "MANAGE_ORGANIZATION"))) notFound();
  const modules = await getCompetitiveModuleReadiness(workspace.id);
  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
      <header className="border-b border-stone-200 pb-5"><p className="text-sm font-semibold text-teal-800">{workspace.businessName}</p><h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold"><Puzzle className="h-7 w-7 text-teal-700" />系統強化模組</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">集中確認核心、會員、全通路、總部、供應、活動、API 與分析模組；顯示「本機測試中」不代表已核准上線。</p></header>
      <section className="grid gap-4 py-6 sm:grid-cols-2 xl:grid-cols-4">{modules.map((module) => { const presentation = presentations[module.status]; const Icon = presentation.icon; const href = `${module.setupPath}?organizationId=${encodeURIComponent(workspace.id)}`; return <article key={module.code} className="flex min-h-64 flex-col rounded-xl border border-stone-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><p className="text-xs font-semibold text-teal-700">{module.code}</p><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${presentation.className}`}><Icon className="h-3.5 w-3.5" />{presentation.label}</span></div><h2 className="mt-3 text-lg font-semibold">{module.label}</h2><p className="mt-2 text-sm leading-6 text-stone-600">{module.description}</p><p className="mt-3 text-xs text-stone-500">風險類型：{module.risk === "CORE" ? "核心" : module.risk === "EXTERNAL" ? "外部依賴" : "受控功能"}</p><Link href={href} className="mt-auto inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold hover:border-teal-600 hover:bg-teal-50">前往檢查<ArrowRight className="h-4 w-4" /></Link></article>; })}</section>
    </main>
  );
}

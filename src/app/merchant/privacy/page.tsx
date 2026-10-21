import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getPagePrincipal } from "@/lib/auth";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { getWorkspaceAccess } from "@/lib/workspace";
import { complianceEnabled } from "@/server/compliance/contracts";
import { PrivacyRequestPanel } from "@/components/privacy-request-panel";
import { PrivacyWorkbench } from "@/components/privacy-workbench";
import { complianceMfaAvailable } from "@/server/compliance/step-up";
export const dynamic = "force-dynamic";
export default async function PrivacyPage({ searchParams }: { searchParams: Promise<{ organizationId?: string }> }) {
  if (!complianceEnabled()) notFound();
  const principal = await getPagePrincipal(); if (!principal) redirect("/login");
  const workspaces = await getWorkspaceAccess(principal.user.id, principal.user.platformRole);
  const query = await searchParams;
  const workspace = query.organizationId ? workspaces.find((item) => item.id === query.organizationId) : workspaces[0];
  if (!workspace || !z.uuid().safeParse(workspace.id).success) notFound();
  const { locale } = await getRequestAppLocale();
  return <main><PrivacyRequestPanel organizationId={workspace.id} locale={locale} />
    {workspace.roles.includes("ORGANIZATION_OWNER") && <PrivacyWorkbench organizationId={workspace.id} locale={locale} mfaAvailable={complianceMfaAvailable(principal.user.authUserId)} />}
  </main>;
}

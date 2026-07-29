import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { MerchantSetupBackLink } from "@/components/merchant-setup-back-link";
import { StallSettingsBackLink } from "@/components/stall-settings-back-link";
import { StallBusinessHoursManager } from "@/components/stall-business-hours-manager";
import { StallEditor } from "@/components/stall-editor";
import { StallModulesManager } from "@/components/stall-modules-manager";
import { StallSettingsShell } from "@/components/stall-settings-shell";
import { StallTeamManager } from "@/components/stall-team-manager";
import { StallTemplateCopyManager } from "@/components/stall-template-copy-manager";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/rbac";
import { getStallModuleState } from "@/lib/stall-modules";
import { requireWorkspacePage } from "@/lib/workspace";

const sectionLabels = {
  basic: "基本資料",
  operations: "營運狀態",
  "business-hours": "營業時間",
  modules: "營運模組與內用桌位",
  templates: "多攤位範本",
  members: "攤位成員",
} as const;

type SettingsSection = keyof typeof sectionLabels;
type PageProps = {
  params: Promise<{ stallId: string; section: string }>;
  searchParams: Promise<{ source?: string }>;
};

function isSettingsSection(value: string): value is SettingsSection {
  return value in sectionLabels;
}

export default async function StallSettingsSectionPage({ params, searchParams }: PageProps) {
  const { stallId, section: rawSection } = await params;
  const { source } = await searchParams;
  if (!isSettingsSection(rawSection)) notFound();

  const { workspaces } = await requireWorkspacePage();
  const workspace = workspaces.find((candidate) => candidate.stalls.some((stall) => stall.id === stallId));
  const workspaceStall = workspace?.stalls.find((stall) => stall.id === stallId);
  if (!workspace || !workspaceStall) notFound();

  const roles = [...new Set([...workspace.roles, ...workspaceStall.roles])];
  if (!roles.some((role) => hasPermission(role, "MANAGE_STALL"))) notFound();
  if (rawSection === "members" && !roles.some((role) => hasPermission(role, "MANAGE_STAFF"))) notFound();

  const stall = await prisma.stall.findUnique({
    where: { id: stallId, organizationId: workspace.id },
    select: {
      id: true,
      name: true,
      slug: true,
      code: true,
      description: true,
      address: true,
      phone: true,
      timezone: true,
      currency: true,
      businessStatus: true,
      orderingEnabled: true,
      isActive: true,
    },
  });
  if (!stall) notFound();

  let content: ReactNode;

  if (rawSection === "basic" || rawSection === "operations") {
    content = (
      <StallEditor
        organizationId={workspace.id}
        stallId={stall.id}
        section={rawSection}
        initial={{
          name: stall.name,
          code: stall.code,
          description: stall.description,
          address: stall.address,
          phone: stall.phone,
          timezone: stall.timezone,
          currency: stall.currency,
          businessStatus: stall.businessStatus,
          orderingEnabled: stall.orderingEnabled,
          isActive: stall.isActive,
        }}
      />
    );
  } else if (rawSection === "business-hours") {
    const businessHours = await prisma.stallBusinessHour.findMany({
      where: { stallId, organizationId: workspace.id },
      orderBy: { dayOfWeek: "asc" },
      select: { dayOfWeek: true, opensAt: true, closesAt: true, isClosed: true },
    });
    content = <StallBusinessHoursManager stallId={stall.id} initialHours={businessHours} />;
  } else if (rawSection === "modules") {
    const moduleState = await getStallModuleState(stall.id, workspace.id);
    content = (
      <StallModulesManager
        stallId={stall.id}
        stallSlug={stall.slug}
        appUrl={process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}
        initialState={moduleState}
      />
    );
  } else if (rawSection === "templates") {
    content = (
      <StallTemplateCopyManager
        stallId={stall.id}
        sourceStalls={workspace.stalls
          .filter((candidate) => (
            candidate.id !== stall.id
            && [...workspace.roles, ...candidate.roles].some((role) => hasPermission(role, "MANAGE_STALL"))
          ))
          .map((candidate) => ({ id: candidate.id, name: candidate.name }))}
      />
    );
  } else {
    const memberships = await prisma.stallMembership.findMany({
      where: { stallId: stall.id, organizationId: workspace.id },
      orderBy: { createdAt: "asc" },
      include: { profile: { select: { id: true, displayName: true, email: true } } },
    });
    content = (
      <StallTeamManager
        stallId={stall.id}
        initialMemberships={memberships.map((membership) => ({
          id: membership.id,
          role: membership.role as "STALL_MANAGER" | "STAFF" | "KITCHEN",
          isActive: membership.isActive,
          profile: membership.profile,
        }))}
      />
    );
  }

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-4xl px-4 py-7 md:px-8">
      {source === "setup"
        ? <MerchantSetupBackLink organizationId={workspace.id} />
        : <StallSettingsBackLink stallId={stall.id} />}
      <header className="mt-4 border-b border-stone-200 pb-5">
        <p className="text-sm font-semibold text-teal-800">{workspace.businessName}</p>
        <h1 className="mt-1 text-3xl font-semibold">{stall.name}</h1>
        <p className="mt-2 text-sm text-stone-600">{sectionLabels[rawSection]}</p>
      </header>
      <div className="py-7">
        <StallSettingsShell showToolbar={false}>{content}</StallSettingsShell>
      </div>
    </main>
  );
}

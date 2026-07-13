import { notFound, redirect } from "next/navigation";
import { hasPermission } from "@/lib/rbac";
import { requireWorkspacePage } from "@/lib/workspace";

type PageProps = { params: Promise<{ stallId: string }> };

export default async function StallOrdersRoute({ params }: PageProps) {
  const { stallId } = await params;
  const { workspaces } = await requireWorkspacePage();
  const workspace = workspaces.find((candidate) => candidate.stalls.some((stall) => stall.id === stallId));
  const stall = workspace?.stalls.find((candidate) => candidate.id === stallId);
  if (!workspace || !stall) notFound();
  if (![...workspace.roles, ...stall.roles].some((role) => hasPermission(role, "VIEW_ORDERS"))) notFound();
  redirect(`/staff/${stall.slug}`);
}

import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { QrPrintPreview, type QrPrintItem } from "@/components/qr-print-preview";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/rbac";
import { normalizeQrPrintRequest } from "@/lib/qr-print-layout";
import { requireWorkspacePage } from "@/lib/workspace";

type PageProps = {
  params: Promise<{ stallId: string }>;
  searchParams: Promise<{ target?: string; paper?: string; tableId?: string }>;
};

export default async function QrPrintPage({ params, searchParams }: PageProps) {
  const [{ stallId }, query, { workspaces }] = await Promise.all([
    params,
    searchParams,
    requireWorkspacePage(),
  ]);
  const request = normalizeQrPrintRequest(query);
  if (request.target === "table" && !request.tableId) notFound();

  const workspace = workspaces.find((candidate) => candidate.stalls.some((stall) => stall.id === stallId));
  const workspaceStall = workspace?.stalls.find((stall) => stall.id === stallId);
  if (!workspace || !workspaceStall) notFound();
  const roles = [...new Set([...workspace.roles, ...workspaceStall.roles])];
  if (!roles.some((role) => (
    hasPermission(role, "MANAGE_STALL")
    || hasPermission(role, "MANAGE_ORDERING")
    || hasPermission(role, "MANAGE_PRODUCTS")
  ))) notFound();

  const stall = await prisma.stall.findFirst({
    where: { id: stallId, organizationId: workspace.id },
    select: {
      id: true,
      name: true,
      slug: true,
      qrCodes: {
        where: {
          diningTableId: null,
          fulfillmentTypeContext: null,
          state: { in: ["ACTIVE", "PAUSED"] },
        },
        orderBy: [{ tokenVersion: "desc" }, { createdAt: "desc" }],
        take: 1,
        select: { id: true, token: true },
      },
      diningTables: {
        where: {
          isActive: true,
          ...(request.target === "table" ? { id: request.tableId ?? undefined } : {}),
        },
        orderBy: [{ floor: { sortOrder: "asc" } }, { sortOrder: "asc" }, { label: "asc" }],
        select: {
          id: true,
          code: true,
          label: true,
          qrCodes: {
            where: { state: { in: ["ACTIVE", "PAUSED"] } },
            orderBy: [{ tokenVersion: "desc" }, { createdAt: "desc" }],
            take: 1,
            select: { id: true, token: true },
          },
        },
      },
    },
  });
  if (!stall) notFound();

  const appOrigin = await resolveQrApplicationOrigin();
  const qrUrl = (token: string) => `${appOrigin}/q/${encodeURIComponent(token)}`;
  const items: QrPrintItem[] = request.target === "stall"
    ? stall.qrCodes.map((qrCode) => ({ id: qrCode.id, label: stall.name, url: qrUrl(qrCode.token) }))
    : stall.diningTables.flatMap((table) => table.qrCodes[0]
      ? [{ id: table.id, code: table.code, label: table.label, url: qrUrl(table.qrCodes[0].token) }]
      : []);

  return (
    <QrPrintPreview
      stallId={stall.id}
      stallName={stall.name}
      target={request.target}
      paper={request.paper}
      items={items}
      backHref={request.target === "stall" ? `/merchant/${stall.slug}` : `/merchant/stalls/${stall.id}/settings/dining-tables`}
    />
  );
}

async function resolveQrApplicationOrigin() {
  if (process.env.NODE_ENV !== "production") {
    const requestHeaders = await headers();
    const host = requestHeaders.get("host") ?? "";
    if (/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/u.test(host)) return `http://${host}`;
  }
  if (process.env.NEXT_PUBLIC_APP_URL) return new URL(process.env.NEXT_PUBLIC_APP_URL).origin;
  return "https://app.qidaigo.com";
}

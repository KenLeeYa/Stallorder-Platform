import type { PrintJobStatus, Prisma } from "@prisma/client";

export const primaryPrintJobsQuery = {
  orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  select: {
    id: true,
    status: true,
    reprintOfId: true,
    amendmentId: true,
    isRoutingCopy: true,
    documentType: true,
  },
} satisfies Prisma.PrintJobFindManyArgs;

type SelectedPrintJob = Prisma.PrintJobGetPayload<{ select: typeof primaryPrintJobsQuery.select }>;
type PrintJob = Omit<SelectedPrintJob, "amendmentId"> & { amendmentId?: string | null };

// Input uses primaryPrintJobsQuery ordering. A reprint can itself be reprinted.
export function resolvePrimaryPrintStatus(jobs: readonly PrintJob[]): PrintJobStatus | null {
  const primary = jobs.find((job) => job.reprintOfId === null && !job.isRoutingCopy && !job.amendmentId);
  if (!primary) return null;
  const initialStatus = resolveDocumentStatus(jobs, primary);
  if (initialStatus !== "SUCCEEDED") return initialStatus;
  const amendments = jobs.filter((job) => job.reprintOfId === null && job.amendmentId);
  const amendmentStatuses = amendments.map((job) => resolveDocumentStatus(jobs, job));
  return amendmentStatuses.find((status) => status === "FAILED" || status === "CANCELLED")
    ?? amendmentStatuses.find((status) => status !== "SUCCEEDED") ?? "SUCCEEDED";
}

function resolveDocumentStatus(jobs: readonly PrintJob[], primary: PrintJob): PrintJobStatus {

  const children = new Map<string, PrintJob[]>();
  for (const job of jobs) {
    if (job.reprintOfId === null || job.isRoutingCopy || job.documentType !== primary.documentType
      || (job.amendmentId ?? null) !== (primary.amendmentId ?? null)) continue;
    const siblings = children.get(job.reprintOfId) ?? [];
    siblings.push(job);
    children.set(job.reprintOfId, siblings);
  }

  const family = new Set([primary.id]);
  const pending = [primary.id];
  for (let index = 0; index < pending.length; index += 1) {
    for (const child of children.get(pending[index]) ?? []) {
      if (family.has(child.id)) continue;
      family.add(child.id);
      pending.push(child.id);
    }
  }

  let status = primary.status;
  for (const job of jobs) {
    if (!family.has(job.id)) continue;
    // Later spare copies cannot revoke an already confirmed physical output.
    if (job.status === "SUCCEEDED") return "SUCCEEDED";
    status = job.status;
  }
  return status;
}

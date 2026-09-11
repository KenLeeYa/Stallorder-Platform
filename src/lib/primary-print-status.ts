import type { PrintJobStatus, Prisma } from "@prisma/client";

export const primaryPrintJobsQuery = {
  orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  select: {
    id: true,
    status: true,
    reprintOfId: true,
    isRoutingCopy: true,
    documentType: true,
  },
} satisfies Prisma.PrintJobFindManyArgs;

type PrintJob = Prisma.PrintJobGetPayload<{ select: typeof primaryPrintJobsQuery.select }>;

// Input uses primaryPrintJobsQuery ordering. A reprint can itself be reprinted.
export function resolvePrimaryPrintStatus(jobs: readonly PrintJob[]): PrintJobStatus | null {
  const primary = jobs.find((job) => job.reprintOfId === null && !job.isRoutingCopy);
  if (!primary) return null;

  const children = new Map<string, PrintJob[]>();
  for (const job of jobs) {
    if (job.reprintOfId === null || job.isRoutingCopy || job.documentType !== primary.documentType) continue;
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

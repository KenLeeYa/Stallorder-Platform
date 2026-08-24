import "server-only";

import { prisma } from "@/lib/prisma";

export async function getPaygCloseDashboard(now = new Date()) {
  const [automaticFlag, jobs, unclosedPeriods] = await Promise.all([
    prisma.billingFeatureFlag.findUnique({
      where: { code: "PAYG_AUTOMATIC_INVOICE_CLOSE_ENABLED" },
      select: { isEnabled: true },
    }),
    prisma.paygCloseJob.findMany({
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 100,
    }),
    prisma.subscription.count({
      where: {
        status: "ACTIVE",
        pricingEffectiveAt: { not: null },
        billingPeriodEnd: { lte: now },
        plan: { code: "PAYG" },
      },
    }),
  ]);
  const latestRunAt = jobs[0]?.updatedAt ?? null;
  const targetPeriod = jobs[0]?.billingPeriod ?? null;
  const targetJobs = targetPeriod
    ? jobs.filter((job) => job.billingPeriod.getTime() === targetPeriod.getTime())
    : [];
  const failed = targetJobs.filter((job) => job.status === "FAILED").length;
  const stale = Boolean(
    automaticFlag?.isEnabled
    && (!latestRunAt || now.getTime() - latestRunAt.getTime() > 2 * 60 * 60_000),
  );
  return {
    automaticEnabled: automaticFlag?.isEnabled ?? false,
    latestRunAt,
    targetPeriod,
    eligible: targetJobs.length,
    succeeded: targetJobs.filter((job) => job.status === "SUCCEEDED").length,
    skipped: targetJobs.filter((job) => job.status === "SKIPPED").length,
    failed,
    retryCount: targetJobs.reduce((total, job) => total + Math.max(job.attemptCount - 1, 0), 0),
    unclosedPeriods,
    alert: stale || failed > 0 || unclosedPeriods > 0,
    stale,
  };
}

import type { PrismaClient } from "@prisma/client";

const organizationId = "11111111-1111-4111-8111-111111111111";
const seedId = "22222222-2222-4222-8222-222222222222";

export async function prepareSingleActiveStallFixture(prisma: PrismaClient) {
  const database = new URL(process.env.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(database.hostname)
    || database.port !== (process.env.CI ? "54322" : "55722")) throw Error("SINGLE_STALL_LOCAL_TARGET_REQUIRED");
  const rows = await prisma.stall.findMany({ where: { organizationId }, select: { id: true, slug: true, name: true, isActive: true, updatedAt: true } });
  if (!rows.some(row => row.id === seedId && row.slug === "aming-chicken" && row.isActive)) throw Error("SINGLE_STALL_SEED_REQUIRED");
  const extras = rows.filter(row => row.id !== seedId && row.isActive);
  // Exact synthetic fixtures created by cash-shift and multi-stall E2E cases.
  if (extras.some(row => !((/^cash-shift-e2e-[a-f0-9]{8}$/.test(row.slug) && row.name === "現金交班 QA")
    || (/^e2e-night-market-two-[a-f0-9]{8}$/.test(row.slug) && row.name === "E2E 夜市二號攤")))) throw Error("SINGLE_STALL_UNKNOWN_EXTRA");
  const changed: Array<{ row: typeof extras[number]; appliedAt: Date }> = [];
  const restore = async () => {
    let drift = false;
    for (const { row, appliedAt } of changed) {
      try {
        const result = await prisma.stall.updateMany({ where: { id: row.id, organizationId, slug: row.slug, isActive: false, updatedAt: appliedAt }, data: { isActive: true, updatedAt: row.updatedAt } });
        if (result.count !== 1) drift = true;
      } catch { drift = true; }
    }
    if (drift) throw Error("SINGLE_STALL_RESTORE_DRIFT");
  };
  try {
    for (const row of extras) {
      const appliedAt = new Date();
      const result = await prisma.stall.updateMany({ where: { id: row.id, organizationId, slug: row.slug, isActive: true, updatedAt: row.updatedAt }, data: { isActive: false, updatedAt: appliedAt } });
      if (result.count !== 1) throw Error("SINGLE_STALL_PREPARE_DRIFT");
      changed.push({ row, appliedAt });
    }
    return restore;
  } catch (error) { await restore(); throw error; }
}

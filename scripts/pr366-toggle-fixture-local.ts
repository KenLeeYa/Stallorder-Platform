import { PrismaClient } from "@prisma/client";

const database = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1"].includes(database.hostname) || database.port !== "55722") {
  throw new Error("PR366_TOGGLE_LOCAL_DATABASE_REQUIRED");
}

const prisma = new PrismaClient();
const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";

async function main() {
try {
  const category = await prisma.productCategory.findFirstOrThrow({
    where: { organizationId, isActive: true },
    select: { id: true },
  });
  let created = 0;
  for (let index = 1; index <= 3; index++) {
    const name = `PR366 Toggle QA ${index}`;
    const existing = await prisma.product.findFirst({ where: { organizationId, name } });
    if (existing) continue;
    await prisma.product.create({
      data: {
        organizationId,
        categoryId: category.id,
        name,
        description: "Isolated PR366 toggle QA fixture",
        defaultPrice: 50,
        stallProducts: { create: { organizationId, stallId, isEnabled: true, stockRemaining: 100 } },
      },
    });
    created++;
  }
  const total = await prisma.product.count({
    where: {
      organizationId,
      isActive: true,
      kind: "SINGLE",
      stallProducts: { some: { stallId, isEnabled: true } },
    },
  });
  if (total < 7) throw new Error("PR366_TOGGLE_CATALOG_STILL_INCOMPLETE");
  console.log(`toggle_fixture_created=${created} eligible_singles=${total}`);
} finally {
  await prisma.$disconnect();
}
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "PR366_TOGGLE_FIXTURE_ERROR");
  process.exitCode = 1;
});

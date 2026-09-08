import type { PrismaClient } from "@prisma/client";

// Supply only missing navigation examples; never replace retained local fixtures.
export async function prepareCatalogNavigationFixture(prisma: PrismaClient) {
  const database = new URL(process.env.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(database.hostname)
    || database.port !== (process.env.CI ? "54322" : "55722")) {
    throw new Error("DEDICATED_CATALOG_FIXTURE_DATABASE_REQUIRED");
  }
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const noteIds: string[] = [];
  let groupId = "";
  const restore = async () => {
    await prisma.reusableProductNote.deleteMany({ where: { id: { in: noteIds } } });
    if (groupId) await prisma.productNoteGroup.delete({ where: { id: groupId } });
  };
  try {
    if (!await prisma.productNoteGroup.findFirst({ where: { organizationId, name: "冰量" } })) {
      groupId = (await prisma.productNoteGroup.create({ data: { organizationId, name: "冰量",
        options: { create: { organizationId, name: "去冰", priceDelta: 0 } } } })).id;
    }
    const names = ["不加胡椒", ...Array.from({ length: 20 }, (_, index) => `QA 捲動註記 ${index + 1}`)];
    for (const name of names) {
      if (!await prisma.reusableProductNote.findUnique({ where: { organizationId_name: { organizationId, name } } })) {
        noteIds.push((await prisma.reusableProductNote.create({ data: { organizationId, name } })).id);
      }
    }
    return restore;
  } catch (error) {
    await restore();
    throw error;
  }
}

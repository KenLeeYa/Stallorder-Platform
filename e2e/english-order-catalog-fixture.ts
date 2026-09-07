import { randomUUID } from "node:crypto";
import { expect, type PlaywrightWorkerArgs } from "@playwright/test";
import type { PrismaClient } from "@prisma/client";

// These English checkout journeys need a complete translated catalog, independent
// of whichever extra products the local demo store currently contains.
export async function createEnglishOrderCatalogFixture(prisma: PrismaClient, playwright: PlaywrightWorkerArgs["playwright"]) {
  if (!["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL ?? "").hostname)) throw new Error("LOCAL_ENGLISH_CATALOG_TEST_ONLY");
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const stallId = "22222222-2222-4222-8222-222222222222";
  const settings = await prisma.stallOrderingSettings.findUniqueOrThrow({ where: { stallId }, select: { enabledLocales: true } });
  const visibility = await prisma.stallProduct.findMany({ where: { stallId }, select: { id: true, isEnabled: true } });
  const groupTranslationIds: string[] = [], optionTranslationIds: string[] = [];
  const untranslatedAssignmentIds: string[] = [];
  const origin = process.env.PLAYWRIGHT_APP_URL ?? "http://localhost:3001";
  const request = await playwright.request.newContext({ baseURL: origin });
  let headers: Record<string, string> | undefined;
  const applyLocales = async (enabledLocales: string[]) => {
    const result = await request.patch(`/api/merchant/stalls/${stallId}/modules`, {
      headers, data: { operation: "UPDATE_LOCALES", enabledLocales },
    });
    expect(result.status()).toBe(200);
  };
  const restore = async () => {
    try {
      for (const { id, isEnabled } of visibility) await prisma.stallProduct.update({ where: { id }, data: { isEnabled } });
      await prisma.productNoteGroupAssignment.updateMany({ where: { id: { in: untranslatedAssignmentIds } }, data: { isActive: true } });
      await prisma.productNoteGroupTranslation.deleteMany({ where: { id: { in: groupTranslationIds } } });
      await prisma.productNoteOptionTranslation.deleteMany({ where: { id: { in: optionTranslationIds } } });
      if (headers) await applyLocales(settings.enabledLocales);
    } finally { await request.dispose(); }
  };
  try {
    const login = await request.post("/api/auth/login", { headers: { origin, "cf-connecting-ip": "198.18.16.33" },
      data: { email: "owner@stallorder.test", password: "StallOrderDemo!2026" } });
    expect(login.status()).toBe(200);
    const cookies = (await request.storageState()).cookies;
    headers = { origin, "cf-connecting-ip": "198.18.16.33", "x-csrf-token": cookies.find(cookie => cookie.name === "stallorder_csrf")!.value,
      cookie: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; ") };
    const products = await prisma.product.findMany({ where: { organizationId, name: { in: ["香酥雞排", "地瓜薯條"] } },
      include: { noteGroupAssignments: { where: { isActive: true }, include: { noteGroup: { include: { translations: true, options: { include: { translations: true } } } } } } } });
    expect(products).toHaveLength(2);
    await prisma.stallProduct.updateMany({ where: { stallId, productId: { notIn: products.map(product => product.id) } }, data: { isEnabled: false } });
    const names: Record<string, string> = { "包裝需求": "Packaging preferences", "不加胡椒": "No pepper", "加蒜": "Extra garlic", "分開裝": "Pack separately" };
    const seen = new Set<string>();
    for (const product of products) for (const assignment of product.noteGroupAssignments) {
      const { noteGroup } = assignment;
      if ((!noteGroup.translations.some(row => row.locale === "en") && !names[noteGroup.name])
        || noteGroup.options.some(option => !option.translations.some(row => row.locale === "en") && !names[option.name])) {
        // Retained examples from other tests may attach additional untranslated
        // options. Keep this English fixture scoped and restore the assignment.
        untranslatedAssignmentIds.push(assignment.id);
        await prisma.productNoteGroupAssignment.update({ where: { id: assignment.id }, data: { isActive: false } });
        continue;
      }
      if (seen.has(noteGroup.id)) continue;
      seen.add(noteGroup.id);
      if (!noteGroup.translations.some(translation => translation.locale === "en")) {
        expect(names[noteGroup.name]).toBeTruthy();
        const id = randomUUID(); groupTranslationIds.push(id);
        await prisma.productNoteGroupTranslation.create({ data: { id, organizationId, noteGroupId: noteGroup.id, locale: "en", name: names[noteGroup.name] } });
      }
      for (const option of noteGroup.options) if (!option.translations.some(translation => translation.locale === "en")) {
        expect(names[option.name]).toBeTruthy();
        const id = randomUUID(); optionTranslationIds.push(id);
        await prisma.productNoteOptionTranslation.create({ data: { id, organizationId, noteOptionId: option.id, locale: "en", name: names[option.name] } });
      }
    }
    // Use the real settings API so next start also invalidates its menu cache.
    await applyLocales(Array.from(new Set([...settings.enabledLocales, "en"])));
    return restore;
  } catch (error) {
    await restore();
    throw error;
  }
}

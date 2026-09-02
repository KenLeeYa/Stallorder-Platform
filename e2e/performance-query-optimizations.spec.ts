import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { catalogCsvHeaders } from "../src/lib/catalog-csv";

loadLocalEnv();
assertLocalDatabase();

const prisma = new PrismaClient();
const organizationId = "11111111-1111-4111-8111-111111111111";
const categoryName = "效能批次分類";
const groupName = "效能批次群組";
const productNames = ["效能批次商品 A", "效能批次商品 B", "效能批次商品 A 更新"];

test.describe("效能查詢批次化", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(cleanup);
  test.afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  test("CSV 匯入以集合操作新增及更新翻譯與攤位供應", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page);
    await page.goto(`/merchant/catalog?organizationId=${organizationId}`);

    await importCatalog(page, [
      csvRow({
        category: categoryName,
        group: groupName,
        name: productNames[0],
        description: "第一輪 A",
        price: "120",
        sortOrder: "1",
        isActive: "true",
        stallCodes: "AMING-01",
        name_en: "Batch item A",
        description_en: "First batch",
      }),
      csvRow({
        category: categoryName,
        group: groupName,
        name: productNames[1],
        description: "第一輪 B",
        price: "80",
        sortOrder: "2",
        isActive: "true",
      }),
    ]);

    const firstProducts = await prisma.product.findMany({
      where: { organizationId, name: { in: productNames.slice(0, 2) } },
      orderBy: { name: "asc" },
      include: { translations: true, stallProducts: true },
    });
    expect(firstProducts).toHaveLength(2);
    const firstA = firstProducts.find((product) => product.name === productNames[0]);
    const firstB = firstProducts.find((product) => product.name === productNames[1]);
    expect(firstA?.translations.map((translation) => translation.locale)).toContain("en");
    expect(firstA?.stallProducts).toHaveLength(1);
    expect(firstB?.stallProducts).toHaveLength(0);

    await importCatalog(page, [
      csvRow({
        id: firstA!.id,
        category: categoryName,
        group: groupName,
        name: productNames[2],
        description: "第二輪 A",
        price: "135",
        sortOrder: "3",
        isActive: "true",
      }),
      csvRow({
        id: firstB!.id,
        category: categoryName,
        group: groupName,
        name: productNames[1],
        description: "第二輪 B",
        price: "85",
        sortOrder: "4",
        isActive: "true",
        stallCodes: "AMING-01",
        name_en: "Batch item B",
        description_en: "Second batch",
      }),
    ]);

    const updatedProducts = await prisma.product.findMany({
      where: { id: { in: [firstA!.id, firstB!.id] }, organizationId },
      include: { translations: true, stallProducts: true },
    });
    const updatedA = updatedProducts.find((product) => product.id === firstA!.id);
    const updatedB = updatedProducts.find((product) => product.id === firstB!.id);
    expect(updatedA).toMatchObject({ name: productNames[2], defaultPrice: 135, sortOrder: 3 });
    expect(updatedA?.translations).toHaveLength(0);
    expect(updatedA?.stallProducts).toHaveLength(0);
    expect(updatedB).toMatchObject({ name: productNames[1], defaultPrice: 85, sortOrder: 4 });
    expect(updatedB?.translations.map((translation) => translation.locale)).toContain("en");
    expect(updatedB?.stallProducts).toHaveLength(1);

    expect(await prisma.productCategory.count({ where: { organizationId, name: categoryName } })).toBe(1);
    expect(await prisma.productGroup.count({ where: { organizationId, name: groupName } })).toBe(1);
  });
});

async function importCatalog(page: Page, rows: string[]) {
  const importInput = page.getByLabel("匯入 CSV", { exact: true });
  await expect(importInput).toHaveCount(1);
  await importInput.setInputFiles({
    name: "performance-import.csv",
    mimeType: "text/csv",
    buffer: Buffer.from([catalogCsvHeaders.join(","), ...rows].join("\n")),
  });
  const dialog = page.getByRole("dialog", { name: "CSV 匯入預覽" });
  await expect(dialog.getByRole("button", { name: "套用 2 筆有效資料" })).toBeVisible();
  const responsePromise = page.waitForResponse((response) => (
    response.url().includes("/catalog/import")
    && response.request().method() === "POST"
  ));
  await dialog.getByRole("button", { name: "套用 2 筆有效資料" }).click();
  expect((await responsePromise).status()).toBe(200);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("已套用 2 筆商品。", { exact: true })).toBeVisible();
}

function csvRow(values: Partial<Record<(typeof catalogCsvHeaders)[number], string>>) {
  return catalogCsvHeaders.map((header) => values[header] ?? "").join(",");
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill("owner@stallorder.test");
  await page.getByLabel("密碼").fill("StallOrderDemo!2026");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/merchant\/dashboard\?organizationId=/);
}

async function cleanup() {
  const products = await prisma.product.findMany({
    where: { organizationId, name: { in: productNames } },
    select: { id: true },
  });
  if (products.length > 0) {
    await prisma.product.deleteMany({ where: { id: { in: products.map((product) => product.id) } } });
  }
  await prisma.productGroup.deleteMany({ where: { organizationId, name: groupName } });
  await prisma.productCategory.deleteMany({ where: { organizationId, name: categoryName } });
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("E2E 必須設定 DATABASE_URL");
  const hostname = new URL(databaseUrl).hostname;
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error(`拒絕在非本機資料庫執行 E2E：${hostname}`);
  }
}

function loadLocalEnv() {
  let content: string;
  try {
    content = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    const value = match[2].trim();
    process.env[match[1]] = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
  }
}

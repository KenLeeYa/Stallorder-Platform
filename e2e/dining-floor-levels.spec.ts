import { expect, test, type Locator, type Page } from "@playwright/test";
import { PrismaClient, type DiningTableShape } from "@prisma/client";
import { dismissStaffStartReminder, gotoLocalPath } from "./local-navigation";

const prisma = new PrismaClient();
const stallId = "22222222-2222-4222-8222-222222222222";
const stallSlug = "aming-chicken";
const qaTableCode = "QA-F2";

let originalFloors: Array<{ id: string }> = [];
let originalTables: Array<{
  id: string;
  floorId: string | null;
  shape: DiningTableShape;
  rotationDegrees: number;
}> = [];
let originalLayoutCaptured = false;

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill("owner@stallorder.test");
  await page.getByLabel("密碼").fill("StallOrderDemo!2026");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/merchant\/dashboard\?organizationId=/, { timeout: 30_000 });
}

async function waitForReactClickHandler(control: Locator) {
  await expect.poll(() => control.evaluate((element) => {
    const propsKey = Object.keys(element).find((key) => key.startsWith("__reactProps$"));
    if (!propsKey) return false;
    const props = (element as unknown as Record<string, unknown>)[propsKey];
    return typeof props === "object"
      && props !== null
      && typeof (props as Record<string, unknown>).onClick === "function";
  }), { message: "等待 React 掛載 onClick" }).toBe(true);
}

async function acknowledgeSettingsFeedback(page: Page, message: string) {
  const dialog = page.getByRole("dialog", { name: "操作已完成", exact: true });
  await expect(dialog).toContainText(message);
  await dialog.getByRole("button", { name: "我知道了", exact: true }).click();
  await expect(dialog).toBeHidden();
}

test.beforeAll(async () => {
  const [floors, tables] = await Promise.all([
    prisma.diningFloor.findMany({ where: { stallId }, select: { id: true } }),
    prisma.diningTable.findMany({
      where: { stallId },
      select: { id: true, floorId: true, shape: true, rotationDegrees: true },
    }),
  ]);
  originalFloors = floors;
  originalTables = tables;
  originalLayoutCaptured = true;
  await prisma.diningTable.deleteMany({ where: { stallId, code: qaTableCode } });
});

test.afterAll(async () => {
  try {
    if (!originalLayoutCaptured) return;
    await prisma.diningTable.deleteMany({ where: { stallId, code: qaTableCode } });
    for (const table of originalTables) {
      await prisma.diningTable.update({
        where: { id: table.id },
        data: {
          floorId: table.floorId,
          shape: table.shape,
          rotationDegrees: table.rotationDegrees,
        },
      });
    }
    const originalFloorIds = originalFloors.map((floor) => floor.id);
    await prisma.diningFloor.deleteMany({
      where: {
        stallId,
        ...(originalFloorIds.length > 0 ? { id: { notIn: originalFloorIds } } : {}),
      },
    });
  } finally {
    await prisma.$disconnect();
  }
});

test("樓層桌型會連動商家配置、員工看板與店員點餐", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  const modulesApiPath = `/api/merchant/stalls/${stallId}/modules`;
  if (process.env.PLAYWRIGHT_PRODUCTION_SERVER !== "true") {
    const warmupResponse = await page.context().request.get(modulesApiPath);
    expect(warmupResponse.status()).toBe(405);
    await warmupResponse.dispose();
  }
  await gotoLocalPath(page, `/merchant/stalls/${stallId}/settings/modules`);

  await expect(page.getByRole("tab", { name: "1樓", exact: true })).toBeVisible();
  await page.locator('[data-field-key="new-floor:name"]').fill("2樓");
  await page.locator('[data-field-key="new-floor:sortOrder"]').fill("2");
  const createFloorResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === modulesApiPath
    && response.request().method() === "PATCH"
    && response.request().postDataJSON()?.operation === "CREATE_FLOOR"
  ));
  const createFloorButton = page.getByTestId("create-dining-floor");
  await waitForReactClickHandler(createFloorButton);
  await createFloorButton.click();
  expect((await createFloorResponse).status()).toBe(200);
  await expect(page.getByRole("tab", { name: "2樓", exact: true })).toHaveAttribute("aria-selected", "true");
  await acknowledgeSettingsFeedback(page, "樓層已新增。");

  const tableForm = page.locator('[data-field-key="new-table:code"]').locator("xpath=ancestor::div[contains(@class,'border-b')][1]");
  await tableForm.locator('[data-field-key="new-table:code"]').fill(qaTableCode);
  await tableForm.locator('[data-field-key="new-table:label"]').fill("QA 2樓桌");
  await tableForm.locator('[data-field-key="new-table:shape"]').selectOption("DIAMOND");
  await tableForm.locator('[data-field-key="new-table:rotationDegrees"]').selectOption("45");
  const createTableResponse = page.waitForResponse((response) => (
    response.url().endsWith(`/api/merchant/stalls/${stallId}/modules`)
    && response.request().method() === "PATCH"
    && response.request().postDataJSON()?.operation === "CREATE_TABLE"
  ));
  await tableForm.getByRole("button", { name: "新增", exact: true }).click();
  expect((await createTableResponse).status()).toBe(200);
  await acknowledgeSettingsFeedback(page, "桌位與專屬 QR 已建立。");

  const floorEditor = page.getByRole("region", { name: "桌位平面配置" });
  const qaTable = floorEditor.getByRole("button", { name: "移動 QA 2樓桌" });
  await expect(qaTable).toBeVisible();
  await expect(qaTable.locator("polygon")).toHaveCount(1);

  const createdTable = await prisma.diningTable.findFirstOrThrow({
    where: { stallId, code: qaTableCode },
    select: { id: true },
  });
  const floorSelect = page.locator(`[data-field-key="table-${createdTable.id}:floorId"]`);
  await floorSelect.selectOption({ label: "1樓" });
  await expect(page.getByText("請先儲存「QA 2樓桌」的樓層變更，再儲存桌位位置。")).toBeVisible();
  await page.getByRole("tab", { name: "1樓", exact: true }).click();
  await expect(page.getByRole("button", { name: "儲存桌位位置", exact: true })).toBeDisabled();
  await page.locator(`[data-field-key="table-${createdTable.id}:floorId"]`).selectOption({ label: "2樓" });
  await page.getByRole("tab", { name: "2樓", exact: true }).click();
  await expect(qaTable).toBeVisible();

  await page.goto(`/staff/${stallSlug}/floor`);
  await page.getByRole("tab", { name: "2樓", exact: true }).click();
  await expect(page.getByRole("button", { name: /^QA 2樓桌，/ })).toBeVisible();

  await page.goto(`/staff/${stallSlug}`);
  await dismissStaffStartReminder(page);
  await page.getByRole("button", { name: "店員點餐" }).click();
  const composer = page.getByRole("dialog", { name: "店員點餐" });
  await composer.getByRole("button", { name: "內用", exact: true }).click();
  const tableSelect = composer.getByLabel("桌位");
  await expect(tableSelect.locator('optgroup[label="1樓"]')).toHaveCount(1);
  await expect(tableSelect.locator('optgroup[label="2樓"] option', { hasText: "QA 2樓桌" })).toHaveCount(1);
});

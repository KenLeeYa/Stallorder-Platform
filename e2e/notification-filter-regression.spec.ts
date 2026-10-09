import { expect, test } from "@playwright/test";
import { gotoLocalPath, loginLocalTestAccount } from "./local-navigation";

test.use({ serviceWorkers: "block" });

test("notification filter click refetches unchanged filters and clears private content on denial", async ({ page }) => {
  test.setTimeout(90_000);
  await loginLocalTestAccount(page, "owner@stallorder.test", "StallOrderDemo!2026");
  const item = {
    source: "APPLICATION", id: "33333333-3333-4333-8333-333333333333", category: "APPLICATION",
    createdAt: new Date().toISOString(), readAt: null, title: "Synthetic private notification",
    message: "Synthetic private detail", target: { kind: "APPLICATION_STATUS" },
  };
  const requests: string[] = [];
  let denied = false;
  // Exercise the real mounted form with synthetic responses; this is not provider authorization proof.
  await page.route("**/api/notifications?*", async route => {
    requests.push(route.request().url());
    if (denied) return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Synthetic expired session" }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      version: "v1", items: [item], nextCursor: null, unreadCount: 1,
      from: "2026-10-01T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z",
    }) });
  });
  await page.route(`**/api/notifications/APPLICATION/${item.id}?*`, route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ version: "v1", item }),
  }));
  await gotoLocalPath(page, "/notifications?kind=PERSONAL");
  const list = page.getByRole("region", { name: "通知列表", exact: true });
  await expect(list).toBeVisible();
  const before = requests.length;
  const initialQuery = requests.at(-1);
  await page.getByRole("button", { name: "套用篩選", exact: true }).click();
  await expect.poll(() => requests.length).toBe(before + 1);
  expect(requests.at(-1)).toBe(initialQuery);
  await list.getByRole("button").filter({ hasText: item.title }).click();
  const detail = page.getByRole("region", { name: "通知詳情", exact: true });
  await expect(detail).toContainText(item.message);
  denied = true;
  await page.getByRole("button", { name: "套用篩選", exact: true }).click();
  await expect(page.getByText("登入或權限已變更，通知內容已清除。", { exact: true })).toBeVisible();
  await expect(list).toBeHidden();
  await expect(detail).toBeHidden();
  await expect(page.getByText(item.message, { exact: true })).toHaveCount(0);
});

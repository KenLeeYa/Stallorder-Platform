import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

let css: string;
test.beforeAll(async () => {
  css = (await postcss([tailwindcss()]).process(await readFile("src/app/globals.css", "utf8"), {
    from: "src/app/globals.css",
  })).css;
});

for (const width of [320, 390, 768, 1440]) {
  test(`compact ordering checkboxes and setting switches preserve forms and touch targets at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.setContent(`<!doctype html><html lang="zh-TW"><body>
      <main class="mx-auto max-w-xl p-4"><h1 class="text-2xl font-bold">勾選餐點與功能開關</h1>
      <form class="mt-4 grid gap-3">
        <label class="flex items-center gap-3"><input type="checkbox" name="enabled" class="h-4 w-4" checked>啟用功能</label>
        <label class="flex items-center gap-3"><input type="checkbox" name="utensils" class="ordering-checkbox">需要免洗餐具</label>
        <label class="flex items-start gap-3"><input type="checkbox" name="terms" class="ordering-checkbox" required>我已閱讀並同意條款，確認後才可送出表單</label>
        <fieldset class="flex gap-4"><legend>權限範圍</legend>
          <label class="flex items-center gap-2"><input type="checkbox" name="scope" value="catalog">商品</label>
          <label class="flex items-center gap-2"><input type="checkbox" name="scope" value="orders">訂單</label>
        </fieldset>
        <label class="flex items-center gap-3"><input type="checkbox" name="locked" disabled checked>權限不足（停用）</label>
        <label class="flex items-center gap-3"><input type="checkbox" name="mixed">部分選取</label>
        <button class="min-h-11 rounded border p-2" type="submit">儲存設定</button>
        <button class="min-h-11 rounded border p-2" type="reset">還原設定</button>
      </form>
      <div class="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-3">
        <label class="ordering-checkbox-target grid place-items-center self-start print:hidden"><input type="checkbox" class="ordering-checkbox" aria-label="選取餐點"></label>
        <div>牛肉河粉<br>不要香菜</div>
      </div></main></body></html>`);
    await page.addStyleTag({ content: css });
    await page.locator('[name="mixed"]').evaluate((input: HTMLInputElement) => { input.indeterminate = true; });

    const utensils = page.getByRole("checkbox", { name: "需要免洗餐具" });
    await page.getByText("需要免洗餐具", { exact: true }).click();
    await expect(utensils).toBeChecked();
    await utensils.focus();
    await page.keyboard.press("Space");
    await expect(utensils).not.toBeChecked();
    expect(await page.locator("form").evaluate((form: HTMLFormElement) => form.checkValidity())).toBe(false);
    await page.getByRole("checkbox", { name: /我已閱讀/ }).check();
    await page.getByRole("checkbox", { name: "商品", exact: true }).check();
    await page.getByRole("checkbox", { name: "訂單", exact: true }).check();
    expect(await page.locator("form").evaluate((form: HTMLFormElement) => ({ valid: form.checkValidity(), entries: Array.from(new FormData(form).entries()) }))).toEqual({
      valid: true, entries: [["enabled", "on"], ["terms", "on"], ["scope", "catalog"], ["scope", "orders"]],
    });
    await expect(page.getByRole("checkbox", { name: /權限不足/ })).toBeDisabled();
    const item = page.getByRole("checkbox", { name: "選取餐點" });
    await item.locator("..").click({ position: { x: 2, y: 2 } });
    await expect(item).toBeChecked();
    await item.focus();
    await page.keyboard.press("Space");
    await expect(item).not.toBeChecked();

    for (const mode of ["standard", "senior"]) {
      for (const theme of ["light", "dark"]) {
        await page.locator("html").evaluate((html, settings) => {
          html.dataset.interfaceMode = settings.mode;
          html.dataset.theme = settings.theme;
        }, { mode, theme });
        const controls = await page.locator('input[type="checkbox"]:not(.ordering-checkbox)').evaluateAll((inputs) => inputs.map((input) => {
          const box = input.getBoundingClientRect();
          const style = getComputedStyle(input);
          return { width: box.width, height: box.height, appearance: style.appearance, background: style.backgroundImage };
        }));
        for (const control of controls) {
          expect(control.width).toBeGreaterThanOrEqual(44);
          expect(control.height).toBeGreaterThanOrEqual(44);
          expect(control.appearance).toBe("none");
          expect(control.background).not.toBe("none");
        }
        const selections = await page.locator(".ordering-checkbox").evaluateAll((inputs) => inputs.map((input) => {
          const box = input.getBoundingClientRect();
          const target = input.closest("label")!.getBoundingClientRect();
          return { width: box.width, height: box.height, targetWidth: target.width, targetHeight: target.height, appearance: getComputedStyle(input).appearance };
        }));
        for (const selection of selections) {
          expect(selection.width).toBeGreaterThanOrEqual(24);
          expect(selection.width).toBeLessThanOrEqual(28);
          expect(selection.height).toBe(selection.width);
          expect(selection.targetWidth).toBeGreaterThanOrEqual(44);
          expect(selection.targetHeight).toBeGreaterThanOrEqual(44);
          expect(selection.appearance).toBe("auto");
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        if (theme === "light") await page.screenshot({ path: testInfo.outputPath(`toggles-${width}-${mode}.png`) });
      }
    }
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await utensils.check();
    await expect(utensils).toBeChecked();
    await page.getByRole("button", { name: "還原設定" }).click();
    await expect(utensils).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: "啟用功能" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: /我已閱讀/ })).not.toBeChecked();
    await page.emulateMedia({ media: "print" });
    await expect(item).toBeHidden();
  });
}

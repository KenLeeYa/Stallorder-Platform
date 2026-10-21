import { expect, it } from "vitest";
import sharp from "sharp";
import jsQR from "jsqr";
import { renderPickupPng } from "./pickup-render";

it("renders a real self-hosted PNG that an independent camera decoder reads without PII", async () => {
  const token = "qidaigo:pickup:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const png = await renderPickupPng(token);
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  expect(decoded?.data).toBe(token);
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const publicMenuViewSource = readFileSync(
  fileURLToPath(new URL("./public-menu-view.tsx", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");

const dialogSource = readFileSync(
  fileURLToPath(new URL("./location-guide-dialog.tsx", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");

describe("public location guide image framing", () => {
  it("passes the saved framing from the public menu into the guide dialog", () => {
    expect(publicMenuViewSource).toContain("guideImagePositionX={menu.stall.locationGuideImagePositionX}");
    expect(publicMenuViewSource).toContain("guideImagePositionY={menu.stall.locationGuideImagePositionY}");
    expect(publicMenuViewSource).toContain("guideImageZoom={menu.stall.locationGuideImageZoom}");
  });

  it("applies the shared framing style in a fixed preview viewport", () => {
    expect(dialogSource).toContain('data-testid="public-location-guide-image"');
    expect(dialogSource).toContain("locationGuideImageStyle({");
    expect(dialogSource).toContain("positionX: guideImagePositionX");
    expect(dialogSource).toContain("positionY: guideImagePositionY");
    expect(dialogSource).toContain("zoom: guideImageZoom");
  });
});

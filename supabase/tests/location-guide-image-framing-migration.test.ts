import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL("../migrations/20260901170000_location_guide_image_framing.sql", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");

describe("location guide image framing migration", () => {
  it("adds bounded independent framing columns to stalls", () => {
    expect(migration).toContain("location_guide_image_position_x smallint not null default 50");
    expect(migration).toContain("location_guide_image_position_y smallint not null default 50");
    expect(migration).toContain("location_guide_image_zoom smallint not null default 100");
    expect(migration).toContain("location_guide_image_position_x between 0 and 100");
    expect(migration).toContain("location_guide_image_position_y between 0 and 100");
    expect(migration).toContain("location_guide_image_zoom between 100 and 200");
  });
});

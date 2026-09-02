import { describe, expect, it } from "vitest";
import { locationGuideImageStyle, normalizeLocationGuideImageFraming } from "./location-guide-image-framing";

describe("location guide image framing", () => {
  it("builds the same focus and zoom style used by merchant preview and public Menu", () => {
    expect(locationGuideImageStyle({ positionX: 35, positionY: 70, zoom: 140 })).toEqual({
      objectPosition: "35% 70%",
      transform: "scale(1.4)",
      transformOrigin: "35% 70%",
    });
  });

  it("uses safe defaults and clamps persisted values", () => {
    expect(normalizeLocationGuideImageFraming({ positionX: -5, positionY: 120, zoom: 250 })).toEqual({
      positionX: 0,
      positionY: 100,
      zoom: 200,
    });
    expect(normalizeLocationGuideImageFraming({})).toEqual({
      positionX: 50,
      positionY: 50,
      zoom: 100,
    });
  });
});

import { describe, expect, it } from "vitest";
import { normalizeAlertSoundOptions } from "./browser-alert-sound";

describe("alert sound settings", () => {
  it("uses audible, bounded defaults", () => {
    expect(normalizeAlertSoundOptions()).toEqual({
      preset: "URGENT",
      volume: 100,
      repeatCount: 2,
      customUrl: null,
    });
  });

  it("bounds merchant-controlled volume and repeat values", () => {
    expect(normalizeAlertSoundOptions({ volume: 1, repeatCount: 9 })).toMatchObject({
      volume: 10,
      repeatCount: 3,
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  clampFloorCoordinate,
  initialFloorPosition,
  moveFloorPosition,
} from "./dining-floor-layout";

describe("桌位平面配置", () => {
  it("將座標限制在畫布可用範圍", () => {
    expect(clampFloorCoordinate(-20)).toBe(0);
    expect(clampFloorCoordinate(900)).toBe(820);
    expect(clampFloorCoordinate(123.6)).toBe(124);
  });

  it("新桌位依 5x5 格位分散排列", () => {
    expect(initialFloorPosition(0)).toEqual({ layoutX: 60, layoutY: 80 });
    expect(initialFloorPosition(6)).toEqual({ layoutX: 250, layoutY: 265 });
    expect(initialFloorPosition(24)).toEqual({ layoutX: 820, layoutY: 820 });
  });

  it("鍵盤移動不會超出畫布", () => {
    expect(moveFloorPosition({ layoutX: 0, layoutY: 0 }, "ArrowLeft")).toEqual({ layoutX: 0, layoutY: 0 });
    expect(moveFloorPosition({ layoutX: 800, layoutY: 800 }, "ArrowRight", true)).toEqual({ layoutX: 820, layoutY: 800 });
  });
});

import { describe, expect, it } from "vitest";
import {
  DEFAULT_DINING_FLOOR_NAME,
  DINING_TABLE_SHAPES,
  getDiningFloorTabs,
  getUnsavedDiningTableFloorMoves,
  isDiningTableRotation,
} from "./dining-floor";

describe("內用樓層", () => {
  it("舊桌位在尚未實體化前顯示虛擬 1 樓", () => {
    expect(getDiningFloorTabs([], [{ floorId: null }])).toEqual([{
      id: null,
      key: "virtual-first-floor",
      name: DEFAULT_DINING_FLOOR_NAME,
      sortOrder: -1,
      isVirtual: true,
    }]);
  });

  it("實體樓層依排序顯示且不再加入虛擬樓層", () => {
    expect(getDiningFloorTabs([
      { id: "floor-2", name: "2樓", sortOrder: 2 },
      { id: "floor-1", name: "1樓", sortOrder: 1 },
    ], [{ floorId: "floor-1" }]).map((floor) => floor.name)).toEqual(["1樓", "2樓"]);
  });

  it("六種桌型固定且旋轉只能使用 15 度倍數", () => {
    expect(DINING_TABLE_SHAPES).toEqual([
      "CIRCLE",
      "ELLIPSE",
      "SQUARE",
      "RECTANGLE",
      "DIAMOND",
      "TRIANGLE",
    ]);
    expect(isDiningTableRotation(0)).toBe(true);
    expect(isDiningTableRotation(345)).toBe(true);
    expect(isDiningTableRotation(14)).toBe(false);
    expect(isDiningTableRotation(360)).toBe(false);
  });

  it("樓層變更必須先儲存，才可連同新樓層的平面位置送出", () => {
    const savedTables = [
      { id: "table-a", floorId: "floor-1", label: "A 桌" },
      { id: "table-b", floorId: "floor-2", label: "B 桌" },
    ];
    const movedTables = [
      { ...savedTables[0], floorId: "floor-2", layoutX: 70, layoutY: 40 },
      { ...savedTables[1], layoutX: 20, layoutY: 30 },
    ];

    expect(getUnsavedDiningTableFloorMoves(movedTables, savedTables)).toEqual([movedTables[0]]);
    expect(getUnsavedDiningTableFloorMoves(movedTables, movedTables)).toEqual([]);
  });
});

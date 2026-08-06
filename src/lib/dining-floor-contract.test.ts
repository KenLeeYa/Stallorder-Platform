import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  diningFloorFields,
  diningTableLayoutEntrySchema,
  diningTablePresentationFields,
} from "./dining-floor-contract";

const tablePresentationSchema = z.object(diningTablePresentationFields);
const floorSchema = z.object(diningFloorFields);

describe("內用樓層資料契約", () => {
  it("接受虛擬 1 樓的 null floorId 與六種桌型", () => {
    expect(tablePresentationSchema.safeParse({
      floorId: null,
      shape: "CIRCLE",
      rotationDegrees: 45,
    }).success).toBe(true);
  });

  it("拒絕非 15 度倍數旋轉", () => {
    const result = tablePresentationSchema.safeParse({
      floorId: null,
      shape: "SQUARE",
      rotationDegrees: 14,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("旋轉角度必須是 15 度的倍數。");
  });

  it("驗證樓層名稱、排序與桌位座標", () => {
    expect(floorSchema.safeParse({ name: "2樓", sortOrder: 2 }).success).toBe(true);
    expect(floorSchema.safeParse({ name: "", sortOrder: 2 }).success).toBe(false);
    expect(diningTableLayoutEntrySchema.safeParse({
      tableId: "11111111-1111-4111-8111-111111111111",
      layoutX: 821,
      layoutY: 80,
    }).success).toBe(false);
  });
});

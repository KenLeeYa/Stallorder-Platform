import { z } from "zod";
import { DINING_TABLE_SHAPES } from "@/lib/dining-floor";

const uuid = z.string().uuid("識別資料格式不正確，請重新整理後再試。");

export const diningFloorFields = {
  name: z.string().trim()
    .min(1, "請輸入樓層名稱。")
    .max(40, "樓層名稱不可超過 40 個字元。"),
  sortOrder: z.number().int("排序必須是整數。")
    .min(0, "排序不可小於 0。")
    .max(10_000, "排序不可超過 10000。"),
};

export const diningTablePresentationFields = {
  floorId: uuid.nullable(),
  shape: z.enum(DINING_TABLE_SHAPES, { error: "請選擇有效的桌型。" }),
  rotationDegrees: z.number().int("旋轉角度必須是整數。")
    .min(0, "旋轉角度不可小於 0 度。")
    .max(345, "旋轉角度不可超過 345 度。")
    .refine((value) => value % 15 === 0, "旋轉角度必須是 15 度的倍數。"),
};

export const diningTableLayoutEntrySchema = z.object({
  tableId: uuid,
  layoutX: z.number().int().min(0).max(820),
  layoutY: z.number().int().min(0).max(820),
}).strict();

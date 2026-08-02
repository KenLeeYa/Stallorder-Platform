import { z } from "zod";
import { kitchenBoardModes } from "@/lib/kitchen-board-contract";

export * from "@/lib/kitchen-board-contract";

const uuid = z.string().uuid();
export const kitchenBoardQuerySchema = z.object({ stationId: uuid.optional() }).strict();
const stationFields = {
  name: z.string().trim().min(1).max(80),
  code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{0,31}$/),
  description: z.string().trim().min(1).max(300).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000),
  isActive: z.boolean(),
};

export const kitchenStationCommandSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("CREATE_STATION"), ...stationFields }).strict(),
  z.object({ operation: z.literal("UPDATE_STATION"), stationId: uuid, ...stationFields }).strict(),
  z.object({ operation: z.literal("DELETE_STATION"), stationId: uuid }).strict(),
  z.object({
    operation: z.literal("CREATE_ASSIGNMENT"),
    stationId: uuid,
    categoryId: uuid.nullable(),
    productId: uuid.nullable(),
  }).strict().refine(
    (value) => Number(value.categoryId !== null) + Number(value.productId !== null) === 1,
    { message: "分類與商品必須擇一。" },
  ),
  z.object({ operation: z.literal("DELETE_ASSIGNMENT"), assignmentId: uuid }).strict(),
]);

export const kitchenSettingsSchema = z.object({
  warningMinutes: z.number().int().min(1).max(120),
  criticalMinutes: z.number().int().min(2).max(240),
  defaultView: z.enum(kitchenBoardModes),
}).strict().refine(
  (value) => value.criticalMinutes > value.warningMinutes,
  { path: ["criticalMinutes"], message: "嚴重逾時必須大於警示時間。" },
);

const kitchenFieldLabels: Record<string, string> = {
  name: "工作站名稱",
  code: "工作站代碼",
  description: "工作站說明",
  sortOrder: "排序",
  isActive: "啟用狀態",
  stationId: "工作站",
  categoryId: "分類",
  productId: "商品",
  warningMinutes: "警示時間",
  criticalMinutes: "嚴重逾時時間",
  defaultView: "預設顯示模式",
};

export function getKitchenFieldErrors(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = typeof issue.path[0] === "string" ? issue.path[0] : "_form";
    if (fieldErrors[field]) continue;
    const label = kitchenFieldLabels[field] ?? "欄位";
    fieldErrors[field] = issue.code === "custom"
      ? issue.message
      : `「${label}」輸入不正確，請依欄位限制重新輸入。`;
  }
  return fieldErrors;
}

export const kitchenTaskCommandSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("UPDATE_TASK"),
    taskId: uuid,
    status: z.enum(["PENDING", "PREPARING", "COMPLETED"]),
  }).strict(),
  z.object({ operation: z.literal("COMPLETE_ORDER"), orderId: uuid }).strict(),
]);

import { z } from "zod";
import {
  diningFloorFields,
  diningTableLayoutEntrySchema,
  diningTablePresentationFields,
} from "@/lib/dining-floor-contract";
import { QR_LOCALES } from "@/lib/qr-order-i18n";

const uuid = z.string().uuid("識別資料格式不正確，請重新整理後再試。");
const tableFields = {
  code: z.string().trim()
    .min(1, "請輸入桌位代碼。")
    .max(20, "桌位代碼不可超過 20 個字元。")
    .regex(/^[A-Z0-9-]+$/, "桌位代碼僅可使用英文字母、數字或連字號。"),
  label: z.string().trim()
    .min(1, "請輸入桌位名稱。")
    .max(40, "桌位名稱不可超過 40 個字元。"),
  sortOrder: z.number().int("排序必須是整數。").min(0, "排序不可小於 0。").max(10_000, "排序不可超過 10000。"),
  isActive: z.boolean(),
  ...diningTablePresentationFields,
};
const paymentFields = {
  code: z.string().trim()
    .min(1, "請輸入付款方式代碼。")
    .max(30, "付款方式代碼不可超過 30 個字元。")
    .regex(/^[A-Z0-9_-]+$/, "付款方式代碼僅可使用英文字母、數字、底線或連字號，不能輸入中文。"),
  name: z.string().trim()
    .min(1, "請輸入付款方式名稱。")
    .max(50, "付款方式名稱不可超過 50 個字元。"),
  kind: z.enum(["CASH", "LINE_PAY", "JKO_PAY", "CUSTOM"], { error: "請選擇有效的付款方式類型。" }),
  isEnabled: z.boolean(),
  sortOrder: z.number().int("排序必須是整數。").min(0, "排序不可小於 0。").max(10_000, "排序不可超過 10000。"),
};
const discountFields = {
  name: z.string().trim()
    .min(1, "請輸入折扣名稱。")
    .max(50, "折扣名稱不可超過 50 個字元。"),
  rateBps: z.number().int("付款比例必須是整數百分比。")
    .min(1, "付款比例至少為 1%。")
    .max(10_000, "付款比例不可超過 100%。"),
  isEnabled: z.boolean(),
  sortOrder: z.number().int("排序必須是整數。").min(0, "排序不可小於 0。").max(10_000, "排序不可超過 10000。"),
};

const lotteryDiscountChancesSchema = z.array(z.object({
  discountOptionId: uuid,
  winRateBps: z.number().int("各折扣中獎率必須是整數百分比。")
    .min(1, "已選折扣的中獎率必須大於 0%。")
    .max(10_000, "各折扣中獎率不可超過 100%。"),
}).strict())
  .max(20, "抽抽樂最多可設定 20 個折扣獎項。")
  .superRefine((chances, context) => {
    if (new Set(chances.map((chance) => chance.discountOptionId)).size !== chances.length) {
      context.addIssue({ code: "custom", message: "同一個折扣不可重複加入抽抽樂。" });
    }
    if (chances.reduce((total, chance) => total + chance.winRateBps, 0) > 10_000) {
      context.addIssue({ code: "custom", message: "所有折扣的中獎率合計不可超過 100%。" });
    }
  });

export const stallModuleCommandSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("UPDATE_MODULES"),
    dineInEnabled: z.boolean(),
    deliveryModuleEnabled: z.boolean(),
    staffDeliveryEnabled: z.boolean(),
    printModuleEnabled: z.boolean(),
    paymentModuleEnabled: z.boolean(),
    discountModuleEnabled: z.boolean(),
    discountApprovalThresholdBps: z.number().int("經理核准門檻必須是整數百分比。")
      .min(0, "經理核准門檻不可小於 0%。")
      .max(10_000, "經理核准門檻不可超過 100%。"),
    takeoutPreorderEnabled: z.boolean(),
    preorderMinLeadMinutes: z.number().int("最少提前時間必須是整數分鐘。")
      .min(15, "最少提前時間不可少於 15 分鐘。")
      .max(1440, "最少提前時間不可超過 1440 分鐘。"),
    preorderMaxDays: z.number().int("最多預約天數必須是整數。")
      .min(1, "最多預約天數不可少於 1 天。")
      .max(30, "最多預約天數不可超過 30 天。"),
    preorderSlotMinutes: z.union([z.literal(5), z.literal(15), z.literal(30), z.literal(60), z.literal(120)], {
      error: "預約時段間隔只能選擇 5、15、30、60 或 120 分鐘。",
    }),
    lotteryEnabled: z.boolean(),
    lotteryDiscountOptionId: uuid.nullable(),
    lotteryDiscountWinRateBps: z.number().int("折扣中獎率必須是整數百分比。")
      .min(0, "折扣中獎率不可小於 0%。")
      .max(10_000, "折扣中獎率不可超過 100%。"),
    lotteryDiscountChances: lotteryDiscountChancesSchema.optional(),
  }).strict(),
  z.object({
    operation: z.literal("UPDATE_LOCALES"),
    enabledLocales: z.array(z.enum(QR_LOCALES)).min(1, "至少需要保留一種 QR 點餐語系。")
      .max(QR_LOCALES.length, "QR 點餐語系數量不正確。")
      .refine((locales) => locales.includes("zh-TW"), "繁體中文為必要語系，無法停用。")
      .refine((locales) => new Set(locales).size === locales.length, "語系不可重複。"),
  }).strict(),
  z.object({ operation: z.literal("CREATE_FLOOR"), ...diningFloorFields }).strict(),
  z.object({ operation: z.literal("UPDATE_FLOOR"), floorId: uuid, ...diningFloorFields }).strict(),
  z.object({ operation: z.literal("DELETE_FLOOR"), floorId: uuid }).strict(),
  z.object({ operation: z.literal("CREATE_TABLE"), ...tableFields }).strict(),
  z.object({ operation: z.literal("UPDATE_TABLE"), tableId: uuid, ...tableFields }).strict(),
  z.object({
    operation: z.literal("UPDATE_TABLE_LAYOUT"),
    floorId: uuid.nullable(),
    tables: z.array(diningTableLayoutEntrySchema).min(1, "至少需要一個桌位才能儲存位置。").max(100, "一次最多可儲存 100 個桌位。")
      .refine((tables) => new Set(tables.map((table) => table.tableId)).size === tables.length, "桌位不可重複。"),
  }).strict(),
  z.object({ operation: z.literal("DELETE_TABLE"), tableId: uuid }).strict(),
  z.object({ operation: z.literal("ROTATE_TABLE_QR"), tableId: uuid }).strict(),
  z.object({ operation: z.literal("CREATE_PAYMENT_OPTION"), ...paymentFields }).strict(),
  z.object({ operation: z.literal("UPDATE_PAYMENT_OPTION"), paymentOptionId: uuid, ...paymentFields }).strict(),
  z.object({ operation: z.literal("DELETE_PAYMENT_OPTION"), paymentOptionId: uuid }).strict(),
  z.object({ operation: z.literal("CREATE_DISCOUNT"), ...discountFields }).strict(),
  z.object({ operation: z.literal("UPDATE_DISCOUNT"), discountId: uuid, ...discountFields }).strict(),
  z.object({ operation: z.literal("DELETE_DISCOUNT"), discountId: uuid }).strict(),
]);

export type StallModuleFieldErrors = Record<string, string>;

const fieldLabels: Record<string, string> = {
  code: "代碼",
  label: "桌位名稱",
  sortOrder: "排序",
  name: "名稱",
  kind: "付款方式類型",
  discountApprovalThresholdBps: "經理核准門檻",
  preorderMinLeadMinutes: "最少提前時間",
  preorderMaxDays: "最多預約天數",
  preorderSlotMinutes: "預約時段間隔",
  lotteryDiscountOptionId: "中獎折扣",
  lotteryDiscountWinRateBps: "折扣中獎率",
  lotteryDiscountChances: "多折扣中獎率",
  enabledLocales: "QR 點餐語系",
  rateBps: "付款比例",
  floorId: "樓層",
  shape: "桌型",
  rotationDegrees: "旋轉角度",
  tables: "桌位位置",
};

export function getStallModuleFieldErrors(error: z.ZodError): StallModuleFieldErrors {
  const fieldErrors: StallModuleFieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path.find((segment): segment is string => (
      typeof segment === "string" && Object.prototype.hasOwnProperty.call(fieldLabels, segment)
    ));
    if (field && !fieldErrors[field]) {
      fieldErrors[field] = /[\u3400-\u9fff]/u.test(issue.message)
        ? issue.message
        : `「${fieldLabels[field]}」的格式或內容不符合輸入要求。`;
    }
  }
  return fieldErrors;
}

export function getStallModuleFieldLabel(field: string, operation: unknown) {
  if (field === "code" && (operation === "CREATE_PAYMENT_OPTION" || operation === "UPDATE_PAYMENT_OPTION")) {
    return "付款方式代碼";
  }
  if (field === "code" && (operation === "CREATE_TABLE" || operation === "UPDATE_TABLE")) {
    return "桌位代碼";
  }
  if (field === "name" && (operation === "CREATE_PAYMENT_OPTION" || operation === "UPDATE_PAYMENT_OPTION")) {
    return "付款方式名稱";
  }
  if (field === "name" && (operation === "CREATE_DISCOUNT" || operation === "UPDATE_DISCOUNT")) {
    return "折扣名稱";
  }
  if (field === "name" && (operation === "CREATE_FLOOR" || operation === "UPDATE_FLOOR")) {
    return "樓層名稱";
  }
  return fieldLabels[field] ?? field;
}

type ModuleSettingsForSave = {
  takeoutPreorderEnabled: boolean;
  preorderMinLeadMinutes: number;
  preorderMaxDays: number;
  preorderSlotMinutes: 5 | 15 | 30 | 60 | 120;
  lotteryEnabled: boolean;
  lotteryDiscountOptionId: string | null;
  lotteryDiscountWinRateBps: number;
  lotteryDiscountChances?: Array<{ discountOptionId: string; winRateBps: number }>;
};

export function normalizeDisabledModuleSettings<T extends ModuleSettingsForSave>(settings: T): T {
  return {
    ...settings,
    ...(!settings.takeoutPreorderEnabled ? {
      preorderMinLeadMinutes: 15,
      preorderMaxDays: 1,
      preorderSlotMinutes: 5 as const,
    } : {}),
    ...(!settings.lotteryEnabled ? {
      lotteryDiscountOptionId: null,
      lotteryDiscountWinRateBps: 0,
      ...(settings.lotteryDiscountChances ? { lotteryDiscountChances: [] } : {}),
    } : {}),
  };
}

export function getModuleDuplicateCodeFieldErrors(operation: unknown, target: unknown) {
  const fields = Array.isArray(target)
    ? target.map((field) => String(field).toLowerCase())
    : [];
  const constraint = typeof target === "string" ? target.toLowerCase() : "";
  const exactFieldTarget = fields.length === 2
    && fields.includes("code")
    && (fields.includes("stall_id") || fields.includes("stallid"));
  const paymentTarget = exactFieldTarget || constraint === "payment_options_stall_code_key";
  const tableTarget = exactFieldTarget || constraint === "dining_tables_stall_code_key";
  const floorTarget = (fields.length === 2
      && fields.includes("name")
      && (fields.includes("stall_id") || fields.includes("stallid")))
    || constraint === "dining_floors_stall_id_name_key"
    || constraint === "dining_floors_stall_name_key";

  if ((operation === "CREATE_PAYMENT_OPTION" || operation === "UPDATE_PAYMENT_OPTION") && paymentTarget) {
    return { code: "此付款方式代碼已被使用，請改用其他代碼。" };
  }
  if ((operation === "CREATE_TABLE" || operation === "UPDATE_TABLE") && tableTarget) {
    return { code: "此桌位代碼已被使用，請改用其他代碼。" };
  }
  if ((operation === "CREATE_FLOOR" || operation === "UPDATE_FLOOR") && floorTarget) {
    return { name: "此樓層名稱已被使用，請改用其他名稱。" };
  }
  return undefined;
}

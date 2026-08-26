import { z } from "zod";
import { catalogVersionStatuses } from "@/server/catalog-versions/catalog-version-contract";

const menuKeySchema = z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,39}$/, "菜單代碼格式不正確。");

export const catalogVersionCommandSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("CREATE_DRAFT"),
    name: z.string().trim().min(1, "請輸入版本名稱。").max(120, "版本名稱不可超過 120 個字元。"),
    menuKey: menuKeySchema.default("DEFAULT"),
    sourceVersionId: z.string().uuid().nullable().default(null),
  }),
  z.object({
    operation: z.literal("TRANSITION"),
    versionId: z.string().uuid(),
    nextStatus: z.enum(catalogVersionStatuses),
    scheduledPublishAt: z.string().datetime({ offset: true }).nullable().default(null),
  }).superRefine((value, context) => {
    if (value.nextStatus === "SCHEDULED" && !value.scheduledPublishAt) {
      context.addIssue({
        code: "custom",
        path: ["scheduledPublishAt"],
        message: "排程發布必須指定時間。",
      });
    }
  }),
]);

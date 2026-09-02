import { z } from "zod";
import type { SpecialClosureView } from "@/lib/special-closures-client";

export * from "@/lib/special-closures-client";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_CLOSURE_DAYS = 366;

const dateField = z.string().regex(DATE_PATTERN, "日期格式必須為 YYYY-MM-DD。").refine(
  (value) => new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value,
  "日期不存在。",
);
const timeField = z.string().regex(TIME_PATTERN, "時間格式必須為 HH:mm。");

const closureFieldShape = {
  startsOn: dateField,
  endsOn: dateField,
  opensAt: timeField.nullable().optional().default(null),
  closesAt: timeField.nullable().optional().default(null),
  title: z.string().trim().min(1, "請輸入公告標題。").max(80, "公告標題最多 80 個字。"),
  message: z.string().trim().max(240, "公告內容最多 240 個字。"),
};

function validateClosureFields(
  value: z.infer<z.ZodObject<typeof closureFieldShape>>,
  context: z.RefinementCtx,
) {
  const startsAt = Date.parse(`${value.startsOn}T00:00:00.000Z`);
  const endsAt = Date.parse(`${value.endsOn}T00:00:00.000Z`);
  if (endsAt < startsAt) {
    context.addIssue({ code: "custom", path: ["endsOn"], message: "結束日期不得早於開始日期。" });
    return;
  }
  if ((endsAt - startsAt) / 86_400_000 + 1 > MAX_CLOSURE_DAYS) {
    context.addIssue({ code: "custom", path: ["endsOn"], message: "單次公休區間最多 366 天。" });
  }
  if (Boolean(value.opensAt) !== Boolean(value.closesAt)) {
    context.addIssue({ code: "custom", path: [value.opensAt ? "closesAt" : "opensAt"], message: "請同時設定開始與結束時間。" });
  } else if (value.opensAt && value.closesAt && value.closesAt <= value.opensAt) {
    context.addIssue({ code: "custom", path: ["closesAt"], message: "結束時間必須晚於開始時間。" });
  }
}

const createSpecialClosureSchema = z.object({
  operation: z.literal("CREATE"),
  ...closureFieldShape,
}).strict().superRefine(validateClosureFields);

const updateSpecialClosureSchema = z.object({
  operation: z.literal("UPDATE"),
  closureId: z.string().uuid(),
  ...closureFieldShape,
}).strict().superRefine(validateClosureFields);

export const specialClosureCommandSchema = z.discriminatedUnion("operation", [
  createSpecialClosureSchema,
  updateSpecialClosureSchema,
  z.object({ operation: z.literal("DELETE"), closureId: z.string().uuid() }).strict(),
]);

export function serializeSpecialClosure(closure: {
  id: string;
  startsOn: Date;
  endsOn: Date;
  opensAt?: string | null;
  closesAt?: string | null;
  title: string;
  message: string;
}): SpecialClosureView {
  return {
    id: closure.id,
    startsOn: closure.startsOn.toISOString().slice(0, 10),
    endsOn: closure.endsOn.toISOString().slice(0, 10),
    opensAt: closure.opensAt ?? null,
    closesAt: closure.closesAt ?? null,
    title: closure.title,
    message: closure.message,
  };
}

import { z } from "zod";
import type { SpecialClosureView } from "@/lib/special-closures-client";

export * from "@/lib/special-closures-client";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CLOSURE_DAYS = 366;

const dateField = z.string().regex(DATE_PATTERN, "日期格式必須為 YYYY-MM-DD。").refine(
  (value) => new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value,
  "日期不存在。",
);

const closureFieldShape = {
  startsOn: dateField,
  endsOn: dateField,
  title: z.string().trim().min(1, "請輸入公告標題。").max(80, "公告標題最多 80 個字。"),
  message: z.string().trim().max(240, "公告內容最多 240 個字。"),
};

const createSpecialClosureSchema = z.object({
  operation: z.literal("CREATE"),
  ...closureFieldShape,
}).strict().superRefine((value, context) => {
  const startsAt = Date.parse(`${value.startsOn}T00:00:00.000Z`);
  const endsAt = Date.parse(`${value.endsOn}T00:00:00.000Z`);
  if (endsAt < startsAt) {
    context.addIssue({ code: "custom", path: ["endsOn"], message: "結束日期不得早於開始日期。" });
    return;
  }
  if ((endsAt - startsAt) / 86_400_000 + 1 > MAX_CLOSURE_DAYS) {
    context.addIssue({ code: "custom", path: ["endsOn"], message: "單次公休區間最多 366 天。" });
  }
});

export const specialClosureCommandSchema = z.discriminatedUnion("operation", [
  createSpecialClosureSchema,
  z.object({ operation: z.literal("DELETE"), closureId: z.string().uuid() }).strict(),
]);

export function serializeSpecialClosure(closure: {
  id: string;
  startsOn: Date;
  endsOn: Date;
  title: string;
  message: string;
}): SpecialClosureView {
  return {
    id: closure.id,
    startsOn: closure.startsOn.toISOString().slice(0, 10),
    endsOn: closure.endsOn.toISOString().slice(0, 10),
    title: closure.title,
    message: closure.message,
  };
}

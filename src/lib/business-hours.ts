import { z } from "zod";

const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "時間格式必須為 HH:mm。");

export const businessHoursSchema = z.object({
  hours: z.array(z.object({
    dayOfWeek: z.number().int().min(0).max(6),
    opensAt: time,
    closesAt: time,
    isClosed: z.boolean(),
  }).strict()).length(7).refine(
    (hours) => new Set(hours.map((hour) => hour.dayOfWeek)).size === 7,
    "每個星期日只能設定一次。",
  ),
}).strict();

export const defaultBusinessHours = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek,
  opensAt: "17:00",
  closesAt: "23:00",
  isClosed: dayOfWeek === 1,
}));

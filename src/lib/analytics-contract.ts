import { z } from "zod";
// 1 = Web, 2 = Native. Category 1 = billing, 2 = application; kind 1 = issue, 2 = suggestion.
const surface = z.union([z.literal(1), z.literal(2)]);
export const productEventSchema = z.discriminatedUnion("event", [
    z.object({ event: z.literal("notification_preference_changed"), surface, category: z.union([z.literal(1), z.literal(2)]), enabled: z.union([z.literal(0), z.literal(1)]) }).strict(),
    z.object({ event: z.literal("feedback_submitted"), surface, kind: z.union([z.literal(1), z.literal(2)]), outcome: z.literal(1) }).strict(),
]);
export type ProductEvent = z.infer<typeof productEventSchema>;

import { z } from "zod";

const uuid = z.uuid();
const slug = z.string().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/);
export const inboxScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("PERSONAL") }).strict(),
  z.object({ kind: z.literal("ORGANIZATION"), organizationId: uuid }).strict(),
  z.object({ kind: z.literal("ADMIN_APPLICATION"), applicationId: uuid }).strict(),
  z.object({ kind: z.literal("STALL"), stallSlug: slug }).strict(),
]);
export const inboxSourceSchema = z.enum(["BILLING", "APPLICATION", "STAFF_ORDER"]);
export const inboxRefSchema = z.object({ source: inboxSourceSchema, id: uuid }).strict();
export const inboxQuerySchema = z.object({
  scope: inboxScopeSchema, category: inboxSourceSchema.optional(), unreadOnly: z.boolean().default(false),
  from: z.iso.datetime().optional(), to: z.iso.datetime().optional(),
  cursor: z.string().max(2048).optional(), limit: z.number().int().min(1).max(50).default(20),
}).strict();
export const inboxTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("BILLING_HOME"), organizationId: uuid }).strict(),
  z.object({ kind: z.literal("APPLICATION_STATUS") }).strict(),
  z.object({ kind: z.literal("ADMIN_APPLICATION"), applicationId: uuid }).strict(),
  z.object({ kind: z.literal("STAFF_BOARD"), stallSlug: slug }).strict(),
]);
export const inboxItemSchema = inboxRefSchema.extend({
  category: inboxSourceSchema, createdAt: z.iso.datetime(), readAt: z.iso.datetime().nullable(),
  title: z.string(), message: z.string(), target: inboxTargetSchema,
}).strict();
export const inboxPreferencesSchema = z.object({
  version: z.number().int().positive(), billingVisible: z.boolean(), applicationVisible: z.boolean(),
  staffOrderVisible: z.boolean(), analyticsConsent: z.boolean(),
}).strict();
export const inboxPreferenceCommandSchema = inboxPreferencesSchema.partial().required({ version: true })
  .refine(value => Object.keys(value).length > 1, "至少選擇一項偏好。");
export const inboxListSchema = z.object({
  version: z.literal("v1"), items: z.array(inboxItemSchema), nextCursor: z.string().nullable(),
  unreadCount: z.number().int().nonnegative(), from: z.iso.datetime(), to: z.iso.datetime(),
}).strict();
export type InboxScope = z.infer<typeof inboxScopeSchema>;
export type InboxRef = z.infer<typeof inboxRefSchema>;
export type InboxQuery = z.infer<typeof inboxQuerySchema>;
export type InboxItem = z.infer<typeof inboxItemSchema>;
export type InboxPreferences = z.infer<typeof inboxPreferencesSchema>;
export type InboxPreferenceCommand = z.infer<typeof inboxPreferenceCommandSchema>;
export type InboxList = z.infer<typeof inboxListSchema>;
export function inboxTargetPath(target: z.infer<typeof inboxTargetSchema>) {
  const parsed = inboxTargetSchema.parse(target);
  switch (parsed.kind) {
    case "BILLING_HOME": return `/merchant/billing?organizationId=${parsed.organizationId}`;
    case "APPLICATION_STATUS": return "/onboarding/status";
    case "ADMIN_APPLICATION": return `/admin/merchant-applications/${parsed.applicationId}`;
    case "STAFF_BOARD": return `/staff/${encodeURIComponent(parsed.stallSlug)}`;
  }
}
export function inboxScopeParams(scope: InboxScope) { return new URLSearchParams(Object.entries(scope)).toString(); }

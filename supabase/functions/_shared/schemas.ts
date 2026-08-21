import { z } from "zod";

const SINGLE_LINE_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
const MULTILINE_CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const PHONE_NUMBER = /^\+?[0-9][0-9 ().-]*$/;
const singleLineText = (maximum: number) => z.string().trim().max(maximum).refine(
  (value) => !SINGLE_LINE_CONTROL_CHARACTERS.test(value),
  "invalid single-line text",
);
const multilineText = (maximum: number) => z.string().trim().max(maximum).refine(
  (value) => !MULTILINE_CONTROL_CHARACTERS.test(value),
  "invalid multiline text",
);
const optionalPhone = z.union([
  z.literal(""),
  z.string().trim().min(6).max(30).regex(PHONE_NUMBER),
]);
const canonicalUuid = (value: string) => value.toLowerCase();
const uuid = z.string().uuid().transform(canonicalUuid);

type PublicOrderLineIdentity = {
  productId: string;
  quantity: number;
  note: string;
  noteOptionIds: readonly string[];
  bundleChoiceIds: readonly string[];
};

export function canonicalPublicOrderLine(item: Omit<PublicOrderLineIdentity, "quantity">) {
  return JSON.stringify([
    canonicalUuid(item.productId),
    item.note.trim(),
    item.noteOptionIds.map(canonicalUuid).sort(),
    item.bundleChoiceIds.map(canonicalUuid).sort(),
  ]);
}

export function canonicalPublicOrderBehavior(items: readonly PublicOrderLineIdentity[]) {
  const canonicalItems = items
    .map((item) => JSON.stringify([canonicalPublicOrderLine(item), item.quantity]))
    .sort();
  return JSON.stringify(canonicalItems);
}

export const issueOrderSessionSchema = z.object({
  qrToken: z.string().trim().min(24).max(200),
  deviceId: uuid,
  sessionRequestId: uuid.optional(),
  orderingMode: z.enum(["DEFAULT", "DELIVERY", "PREORDER"]).default("DEFAULT"),
  includeMenu: z.boolean().default(true),
}).strict();

export const createPublicOrderSchema = z.object({
  qrToken: z.string().trim().min(24).max(200),
  orderSessionToken: z.string().min(40).max(200),
  deviceId: uuid,
  idempotencyKey: uuid,
  clientOrderId: uuid.optional(),
  turnstileIdempotencyKey: uuid.optional(),
  customerName: singleLineText(50).optional().default(""),
  customerPhone: optionalPhone.optional().default(""),
  deliveryAddress: multilineText(300).optional().default(""),
  customerNote: multilineText(1000).optional().default(""),
  waitAcknowledged: z.boolean().default(false),
  orderingMode: z.enum(["DEFAULT", "DELIVERY", "PREORDER"]).default("DEFAULT"),
  scheduledPickupAt: z.string().datetime({ offset: true }).nullable().default(null),
  lotteryDrawId: uuid.nullable().default(null),
  items: z.array(z.object({
    productId: uuid,
    quantity: z.number().int().min(1).max(100),
    note: multilineText(1000).optional().default(""),
    noteOptionIds: z.array(uuid).max(50).default([]),
    bundleChoiceIds: z.array(uuid).max(50).default([]),
  })).min(1).max(100),
  turnstileToken: z.string().min(1).max(2048),
}).strict().superRefine((value, context) => {
  if (new Set(value.items.map(canonicalPublicOrderLine)).size !== value.items.length) {
    context.addIssue({ code: "custom", path: ["items"], message: "duplicate item configurations" });
  }
  value.items.forEach((item, index) => {
    if (new Set(item.noteOptionIds.map(canonicalUuid)).size !== item.noteOptionIds.length) {
      context.addIssue({ code: "custom", path: ["items", index, "noteOptionIds"], message: "duplicate note options" });
    }
    if (new Set(item.bundleChoiceIds.map(canonicalUuid)).size !== item.bundleChoiceIds.length) {
      context.addIssue({ code: "custom", path: ["items", index, "bundleChoiceIds"], message: "duplicate bundle choices" });
    }
  });
  if (value.orderingMode === "DELIVERY") {
    if (value.customerPhone.length < 6) {
      context.addIssue({ code: "custom", path: ["customerPhone"], message: "invalid delivery phone" });
    }
    if (value.deliveryAddress.length < 1) {
      context.addIssue({ code: "custom", path: ["deliveryAddress"], message: "delivery address required" });
    }
    if (value.lotteryDrawId) {
      context.addIssue({ code: "custom", path: ["lotteryDrawId"], message: "lottery is takeaway only" });
    }
  }
  if (value.orderingMode === "PREORDER" && !value.scheduledPickupAt) {
    context.addIssue({ code: "custom", path: ["scheduledPickupAt"], message: "preorder time required" });
  }
});

export function createPublicOrderValidationCode(error: z.ZodError) {
  const [issue] = error.issues;
  return error.issues.length === 1
    && issue?.code === "custom"
    && issue.path.length === 1
    && issue.path[0] === "scheduledPickupAt"
    && issue.message === "preorder time required"
    ? "PREORDER_TIME_REQUIRED"
    : "INVALID_REQUEST";
}

export const getPublicOrderSchema = z.object({
  trackingToken: z.string().min(40).max(200),
  deviceId: uuid,
}).strict();

const trackedOrderIdentitySchema = z.object({
  trackingToken: z.string().min(40).max(200),
  deviceId: uuid,
}).strict();

export const manageLineLinkSchema = z.discriminatedUnion("action", [
  trackedOrderIdentitySchema.extend({ action: z.literal("STATUS") }).strict(),
  trackedOrderIdentitySchema.extend({ action: z.literal("START") }).strict(),
  trackedOrderIdentitySchema.extend({ action: z.literal("REVOKE") }).strict(),
]);

export const prepareReorderSchema = trackedOrderIdentitySchema.strict();

export type PublicOrderInput = z.infer<typeof createPublicOrderSchema>;
export type IssueOrderSessionInput = z.infer<typeof issueOrderSessionSchema>;
export type GetPublicOrderInput = z.infer<typeof getPublicOrderSchema>;

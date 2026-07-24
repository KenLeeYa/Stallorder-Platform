import { z } from "zod";
import { multilineText, singleLineText } from "./input-validation";

const uuid = z.string().uuid();
const optionalText = (maximum: number) => multilineText({ maximum }).nullable();
const httpsUrl = z.string().trim().url().max(500).refine(
  (value) => value.startsWith("https://"),
  "網址必須使用 HTTPS。",
).nullable();
const coordinate = z.number().finite();
const timestamp = z.string().datetime({ offset: true });
const reason = multilineText({
  minimum: 3,
  maximum: 300,
  requiredMessage: "請填寫至少 3 個字的操作原因。",
});

const locationFields = {
  name: singleLineText({ minimum: 1, maximum: 100, requiredMessage: "請填寫地點名稱。" }),
  address: singleLineText({ minimum: 1, maximum: 300, requiredMessage: "請填寫地址。" }),
  latitude: coordinate.min(-90).max(90).nullable(),
  longitude: coordinate.min(-180).max(180).nullable(),
  mapUrl: httpsUrl,
  instructions: optionalText(500),
  isActive: z.boolean(),
};

function validateCoordinatePair(
  value: { latitude: number | null; longitude: number | null },
  context: z.RefinementCtx,
) {
  if ((value.latitude === null) !== (value.longitude === null)) {
    context.addIssue({
      code: "custom",
      path: [value.latitude === null ? "latitude" : "longitude"],
      message: "經緯度必須同時填寫或同時留空。",
    });
  }
}

const createLocation = z.object({ operation: z.literal("CREATE"), ...locationFields })
  .strict().superRefine(validateCoordinatePair);
const updateLocation = z.object({ operation: z.literal("UPDATE"), locationId: uuid, ...locationFields })
  .strict().superRefine(validateCoordinatePair);

export const stallLocationCommandSchema = z.union([
  createLocation,
  updateLocation,
  z.object({ operation: z.literal("DELETE"), locationId: uuid, reason }).strict(),
]);

const eventFields = {
  name: singleLineText({ minimum: 1, maximum: 150, requiredMessage: "請填寫活動名稱。" }),
  slug: z.string().trim().min(1).max(100).regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "活動代稱只能使用小寫英數字與連字號。",
  ),
  description: optionalText(1000),
  venueName: singleLineText({ minimum: 1, maximum: 150, requiredMessage: "請填寫場地名稱。" }),
  address: singleLineText({ minimum: 1, maximum: 300, requiredMessage: "請填寫活動地址。" }),
  latitude: coordinate.min(-90).max(90).nullable(),
  longitude: coordinate.min(-180).max(180).nullable(),
  startsAt: timestamp,
  endsAt: timestamp,
  organizer: optionalText(150),
  publicUrl: httpsUrl,
  isPublic: z.boolean(),
};

function validateEvent(
  value: { latitude: number | null; longitude: number | null; startsAt: string; endsAt: string },
  context: z.RefinementCtx,
) {
  validateCoordinatePair(value, context);
  if (Date.parse(value.endsAt) <= Date.parse(value.startsAt)) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "活動結束時間必須晚於開始時間。" });
  }
}

const createEvent = z.object({ operation: z.literal("CREATE"), ...eventFields })
  .strict().superRefine(validateEvent);
const updateEvent = z.object({ operation: z.literal("UPDATE"), eventId: uuid, ...eventFields })
  .strict().superRefine(validateEvent);

export const marketEventCommandSchema = z.union([
  createEvent,
  updateEvent,
  z.object({ operation: z.literal("DELETE"), eventId: uuid, reason }).strict(),
]);

const scheduleFields = {
  locationId: uuid.nullable(),
  marketEventId: uuid.nullable(),
  startsAt: timestamp,
  endsAt: timestamp,
  orderingOpensAt: timestamp.nullable(),
  orderingClosesAt: timestamp.nullable(),
  specialNotice: optionalText(500),
  menuOverrideId: uuid.nullable(),
  autoOpenEnabled: z.boolean(),
  autoCloseEnabled: z.boolean(),
};

function validateSchedule(
  value: {
    locationId: string | null;
    marketEventId: string | null;
    startsAt: string;
    endsAt: string;
    orderingOpensAt: string | null;
    orderingClosesAt: string | null;
  },
  context: z.RefinementCtx,
) {
  if (!value.locationId && !value.marketEventId) {
    context.addIssue({ code: "custom", path: ["locationId"], message: "行程至少需要一個地點或活動。" });
  }
  const startsAt = Date.parse(value.startsAt);
  const endsAt = Date.parse(value.endsAt);
  const orderingOpensAt = value.orderingOpensAt ? Date.parse(value.orderingOpensAt) : startsAt;
  const orderingClosesAt = value.orderingClosesAt ? Date.parse(value.orderingClosesAt) : endsAt;
  if (endsAt <= startsAt) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "行程結束時間必須晚於開始時間。" });
  }
  if (orderingClosesAt <= orderingOpensAt) {
    context.addIssue({ code: "custom", path: ["orderingClosesAt"], message: "停止接單時間必須晚於開放接單時間。" });
  }
}

const createSchedule = z.object({ operation: z.literal("CREATE"), ...scheduleFields })
  .strict().superRefine(validateSchedule);
const updateSchedule = z.object({ operation: z.literal("UPDATE"), scheduleId: uuid, ...scheduleFields })
  .strict().superRefine(validateSchedule);

export const stallScheduleCommandSchema = z.union([
  createSchedule,
  updateSchedule,
  z.object({ operation: z.literal("DELETE"), scheduleId: uuid, reason }).strict(),
  z.object({
    operation: z.literal("COPY_WEEKLY"),
    scheduleId: uuid,
    weeks: z.number().int().min(1).max(12),
    reason,
  }).strict(),
  z.object({
    operation: z.literal("SET_STATUS"),
    scheduleId: uuid,
    status: z.enum(["OPEN", "DELAYED", "CANCELLED", "COMPLETED"]),
    reason,
    specialNotice: optionalText(500),
  }).strict(),
  z.object({
    operation: z.literal("ASSIGN_QR_CONTEXT"),
    qrCodeId: uuid,
    scheduleId: uuid.nullable(),
    fulfillmentType: z.enum(["TAKEOUT", "DINE_IN", "DELIVERY"]).nullable(),
    reason,
  }).strict(),
]);

export type StallLocationCommand = z.infer<typeof stallLocationCommandSchema>;
export type MarketEventCommand = z.infer<typeof marketEventCommandSchema>;
export type StallScheduleCommand = z.infer<typeof stallScheduleCommandSchema>;

export type ScheduleCapabilities = {
  locationLimit: number | null;
  scheduleLimit: number | null;
  multipleLocations: boolean;
  recurringCopy: boolean;
  automaticOrdering: boolean;
  eventSchedule: boolean;
};

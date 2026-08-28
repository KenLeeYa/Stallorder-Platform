import { z } from "zod";

const latitude = z.number().finite().min(-90).max(90);
const longitude = z.number().finite().min(-180).max(180);

export const attendancePolicyCommandSchema = z.object({
  operation: z.literal("UPDATE_POLICY"),
  enabled: z.boolean(),
  latitude: latitude.nullable(),
  longitude: longitude.nullable(),
  radiusMeters: z.number().int().min(50).max(500),
  maxAccuracyMeters: z.number().int().min(20).max(200),
  requireRotatingCode: z.literal(true, {
    error: "Web 定位打卡必須啟用店內動態驗證碼。",
  }),
  locationEvidenceDays: z.number().int().min(7).max(365),
}).strict().superRefine((value, context) => {
  if ((value.latitude === null) !== (value.longitude === null)) {
    context.addIssue({ code: "custom", message: "緯度與經度必須一起設定。" });
  }
  if (value.enabled && (value.latitude === null || value.longitude === null)) {
    context.addIssue({ code: "custom", message: "啟用定位打卡前，請先設定店家位置。" });
  }
});

export const attendanceReviewCommandSchema = z.object({
  operation: z.literal("REVIEW_EVENT"),
  eventId: z.string().uuid(),
  decision: z.enum(["ACCEPTED", "REJECTED"]),
  note: z.string().trim().min(2, "請填寫覆核原因。").max(500),
}).strict();

export const attendanceManagerCommandSchema = z.discriminatedUnion("operation", [
  attendancePolicyCommandSchema,
  attendanceReviewCommandSchema,
]);

export const attendanceAttemptSchema = z.object({
  eventType: z.enum(["CLOCK_IN", "CLOCK_OUT"]),
  challengeToken: z.string().min(32).max(2048),
  latitude,
  longitude,
  accuracyMeters: z.number().finite().min(0).max(10_000),
  capturedAt: z.string().datetime({ offset: true }),
  rotatingCode: z.string().regex(/^\d{6}$/).optional(),
  clientPlatform: z.literal("WEB"),
}).strict();

export type AttendancePolicyCommand = z.infer<typeof attendancePolicyCommandSchema>;
export type AttendanceManagerCommand = z.infer<typeof attendanceManagerCommandSchema>;
export type AttendanceAttempt = z.infer<typeof attendanceAttemptSchema>;

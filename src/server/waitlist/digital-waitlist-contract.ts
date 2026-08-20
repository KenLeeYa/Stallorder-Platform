import { z } from "zod";

const opaqueTokenSchema = z.string()
  .min(32)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/);

export const digitalWaitlistJoinSchema = z.object({
  stallId: z.string().uuid(),
  partySize: z.number().int().min(1).max(20),
  displayName: z.string().trim().min(1).max(80),
  deviceId: z.string().uuid(),
}).strict();

export const digitalWaitlistStatusSchema = z.object({
  publicToken: opaqueTokenSchema,
}).strict();

export const digitalWaitlistSeatingExchangeSchema = z.object({
  publicToken: opaqueTokenSchema,
  seatingToken: opaqueTokenSchema,
  deviceId: z.string().uuid(),
}).strict();

export const digitalWaitlistTransitionSchema = z.object({
  expectedVersion: z.number().int().positive(),
  operation: z.enum(["NOTIFY", "CANCEL", "MARK_NO_SHOW", "SEAT"]),
  diningTableId: z.string().uuid().nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.operation === "SEAT" && !value.diningTableId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["diningTableId"],
      message: "SEAT requires diningTableId",
    });
  }
  if (value.operation !== "SEAT" && value.diningTableId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["diningTableId"],
      message: "diningTableId is allowed only for SEAT",
    });
  }
});

export type DigitalWaitlistOperation = z.infer<
  typeof digitalWaitlistTransitionSchema
>["operation"];

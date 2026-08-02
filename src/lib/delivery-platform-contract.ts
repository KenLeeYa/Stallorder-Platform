import { z } from "zod";
import {
  deliveryCapabilities,
  deliveryProviders,
} from "@/server/delivery-platforms/delivery-platform-types";

const nullableTrimmed = (max: number) => z.string().trim().max(max).nullable().optional();

export const deliveryStallQuerySchema = z.object({
  stallId: z.string().uuid(),
}).strict();

export const deliveryConnectionRequestSchema = z.object({
  stallId: z.string().uuid(),
  provider: z.enum(["UBER_EATS", "FOODPANDA"]),
  merchantContactName: z.string().trim().min(2).max(120),
  merchantContactEmail: z.string().trim().email().max(320),
  merchantContactPhone: z.string().trim().min(6).max(30).nullable().optional(),
  externalVendorCode: nullableTrimmed(120),
  externalChainCode: nullableTrimmed(120),
  currentProvider: nullableTrimmed(120),
  requestedCapabilities: z.array(z.enum(deliveryCapabilities)).min(1).max(20),
  merchantNote: nullableTrimmed(2000),
}).strict();

export const deliveryConnectionCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("PAUSE") }).strict(),
  z.object({ action: z.literal("DISCONNECT") }).strict(),
]);

export const deliveryStoreMappingSchema = z.object({
  externalStoreId: z.string().trim().min(1).max(200),
  idempotencyKey: z.string().uuid(),
}).strict();

export const deliveryMenuMappingSchema = z.object({
  internalEntityType: z.enum(["CATEGORY", "PRODUCT", "MODIFIER_GROUP", "MODIFIER_ITEM"]),
  internalEntityId: z.string().uuid(),
  externalEntityId: z.string().trim().min(1).max(200),
  externalParentId: nullableTrimmed(200),
}).strict();

export const deliveryAdminReviewSchema = z.object({
  action: z.enum(["REQUEST_INFORMATION", "APPROVE_CONFIGURATION", "REJECT"]),
  adminNote: z.string().trim().min(2).max(2000),
}).strict();

export const deliveryAdminConnectionCommandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("SET_STATUS"),
    status: z.enum(["TESTING", "ACTIVE", "PAUSED", "DISCONNECTED"]),
  }).strict(),
  z.object({
    action: z.literal("VERIFY_STORE"),
    mappingId: z.string().uuid(),
  }).strict(),
  z.object({
    action: z.literal("RETRY_JOB"),
    jobId: z.string().uuid(),
  }).strict(),
  z.object({
    action: z.literal("CREATE_MOCK"),
    organizationId: z.string().uuid(),
    stallId: z.string().uuid(),
  }).strict(),
]);

export const deliveryWebhookPathSchema = z.object({
  provider: z.enum(deliveryProviders),
  connectionId: z.string().uuid(),
}).strict();

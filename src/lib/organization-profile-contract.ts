import { z } from "zod";

const phonePattern = /^\+?[0-9][0-9 ().-]{5,29}$/;

export const updateOrganizationProfileSchema = z.object({
  businessName: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().min(6).max(30).regex(phonePattern),
  operatingMode: z.enum(["SINGLE_STALL", "MULTI_STALL"]),
}).strict();

export type OrganizationProfileInput = z.infer<typeof updateOrganizationProfileSchema>;

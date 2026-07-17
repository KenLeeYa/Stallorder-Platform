import { z } from "zod";

export const organizationInvitationSchema = z.object({
  email: z.string().trim().email().max(120).transform((value) => value.toLowerCase()),
  role: z.enum(["ORGANIZATION_OWNER", "ORGANIZATION_ADMIN", "FINANCE_VIEWER", "STALL_MANAGER", "STAFF", "KITCHEN"]),
  stallId: z.string().uuid().nullable(),
}).strict();

export const organizationInvitationRoles = ["ORGANIZATION_OWNER", "ORGANIZATION_ADMIN", "FINANCE_VIEWER"] as const;
export const stallInvitationRoles = ["STALL_MANAGER", "STAFF", "KITCHEN"] as const;

import { z } from "zod";

export const stallRoles = ["STALL_MANAGER", "STAFF", "KITCHEN"] as const;

export const stallMembershipSchema = z.object({
  email: z.string().trim()
    .min(1, "請輸入帳號 Email。")
    .email("請輸入有效的 Email 格式。")
    .max(120, "帳號 Email 不可超過 120 個字元。")
    .transform((value) => value.toLowerCase()),
  role: z.enum(stallRoles, { error: "請選擇有效的攤位角色。" }),
}).strict();

export const stallMembershipUpdateSchema = z.object({
  role: z.enum(stallRoles, { error: "請選擇有效的攤位角色。" }),
  isActive: z.boolean(),
}).strict();

const membershipFieldLabels = {
  email: "帳號 Email",
  role: "角色",
  isActive: "啟用狀態",
} as const;

export function getStallMembershipFieldErrors(error: z.ZodError) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.path.find((segment): segment is keyof typeof membershipFieldLabels => (
      typeof segment === "string" && Object.prototype.hasOwnProperty.call(membershipFieldLabels, segment)
    ));
    if (field && !fieldErrors[field]) {
      fieldErrors[field] = /[\u3400-\u9fff]/u.test(issue.message)
        ? issue.message
        : `「${membershipFieldLabels[field]}」的格式或內容不符合輸入要求。`;
    }
  }
  return fieldErrors;
}

export function getStallMembershipConflictFieldErrors() {
  return { role: "此成員已具有相同角色。" };
}

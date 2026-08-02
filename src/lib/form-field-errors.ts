import type { z } from "zod";

export type FieldErrors = Record<string, string>;

export function getZodFieldErrors(
  error: z.ZodError,
  labels: Record<string, string> = {},
): FieldErrors {
  const fieldErrors: FieldErrors = {};
  for (const issue of error.issues) {
    const field = [...issue.path].reverse().find((segment): segment is string => typeof segment === "string") ?? "_form";
    if (fieldErrors[field]) continue;
    const label = labels[field] ?? "欄位";
    fieldErrors[field] = /[\u3400-\u9fff]/.test(issue.message)
      ? issue.message
      : `「${label}」輸入不正確，請依欄位限制重新輸入。`;
  }
  return fieldErrors;
}

export function parseFieldErrors(value: unknown): FieldErrors {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => (
    typeof entry[1] === "string" && Boolean(entry[1].trim())
  )));
}

export function withoutFieldError(fieldErrors: FieldErrors, field: string): FieldErrors {
  if (!fieldErrors[field]) return fieldErrors;
  const next = { ...fieldErrors };
  delete next[field];
  return next;
}

export function focusFirstInvalidField(
  container: ParentNode | null,
  fieldErrors: FieldErrors,
) {
  const field = Object.keys(fieldErrors).find((candidate) => candidate !== "_form");
  if (!field) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      container?.querySelector<HTMLElement>(`[data-field-key="${CSS.escape(field)}"]`)?.focus();
    });
  });
}

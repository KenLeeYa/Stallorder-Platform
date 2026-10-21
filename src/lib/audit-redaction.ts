const sensitiveField = /password|secret|token|authorization|cookie|credential|private.?key|customer.?name|phone|email|address|note|payload|ciphertext|receipt|message|stack/i;
const sensitiveText = /(?:[a-z][a-z0-9+.-]*:\/\/|bearer\s|eyJ[A-Za-z0-9_-]+\.)/i;
export function redactAuditValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[TRUNCATED]";
  if (typeof value === "string") return sensitiveText.test(value) ? "[REDACTED]" : value.replace(/[\r\n]/g, " ").slice(0, 200);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => redactAuditValue(entry, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined).slice(0, 50).map(([name, entry]) => [
    name.slice(0, 80), sensitiveField.test(name) ? "[REDACTED]" : redactAuditValue(entry, depth + 1),
  ]));
  return null;
}

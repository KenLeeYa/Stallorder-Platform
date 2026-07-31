const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const INTERNAL_WHITESPACE = /\s/u;

export function normalizeProtectedSecret(rawValue, name = "PROTECTED_SECRET") {
  const original = typeof rawValue === "string" ? rawValue : "";
  const value = original.replace(/\uFEFF/gu, "").trim();

  if (!value) {
    throw new Error(`${name}_MISSING`);
  }
  if (CONTROL_CHARACTERS.test(value)) {
    throw new Error(`${name}_CONTAINS_CONTROL_CHARACTER`);
  }
  if (INTERNAL_WHITESPACE.test(value)) {
    throw new Error(`${name}_CONTAINS_WHITESPACE`);
  }

  return {
    value,
    changed: value !== original,
  };
}

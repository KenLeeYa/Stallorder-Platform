import { appendFile } from "node:fs/promises";
import { normalizeProtectedSecret } from "./lib/protected-secret.mjs";

try {
  const output = required("GITHUB_ENV");
  const { value, changed } = normalizeProtectedSecret(
    process.env.VERCEL_TOKEN,
    "VERCEL_TOKEN",
  );

  console.log(`::add-mask::${value}`);
  await appendFile(output, `VERCEL_TOKEN=${value}\n`, { encoding: "utf8" });
  console.log(JSON.stringify({
    event: "protected_vercel_token_normalized",
    changed,
  }));
} catch (error) {
  console.error(JSON.stringify({
    event: "protected_vercel_token_normalization_failed",
    reason: error instanceof Error ? error.message : "UNKNOWN",
  }));
  process.exitCode = 1;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name}_MISSING`);
  }
  return value;
}

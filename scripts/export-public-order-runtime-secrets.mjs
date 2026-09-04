import { appendFile } from "node:fs/promises";

const requiredSecretNames = [
  "ABUSE_HASH_SECRET",
  "TOKEN_DERIVATION_SECRET",
  "TURNSTILE_SECRET_KEY",
];

const accessToken = required("SUPABASE_ACCESS_TOKEN");
const projectRef = required("SUPABASE_PROJECT_REF");
const output = required("GITHUB_ENV");
const prefix = process.env.PUBLIC_ORDER_SECRET_PREFIX?.trim() ?? "";

if (prefix && !/^[A-Z][A-Z0-9_]*_$/u.test(prefix)) {
  throw new Error("PUBLIC_ORDER_SECRET_PREFIX_INVALID");
}

try {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/secrets`,
    {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) throw new Error(`SUPABASE_PROJECT_SECRETS_${response.status}`);
  const secrets = await response.json();
  const values = requiredSecretNames.map((name) => {
    const value = secrets.find((secret) => secret.name === name)?.value;
    if (!value) throw new Error(`SUPABASE_PROJECT_SECRET_MISSING_${name}`);
    console.log(`::add-mask::${value}`);
    return [`${prefix}${name}`, value];
  });
  if (values[0][1] === values[1][1]) {
    throw new Error("PUBLIC_ORDER_HASH_SECRETS_MUST_DIFFER");
  }

  await appendFile(
    output,
    values.map(([name, value]) => `${name}=${value}`).join("\n") + "\n",
    { encoding: "utf8" },
  );
  console.log(JSON.stringify({
    event: "public_order_runtime_secrets_exported",
    projectRef,
    variableNames: values.map(([name]) => name),
  }));
} catch (error) {
  console.error(JSON.stringify({
    event: "public_order_runtime_secrets_export_failed",
    projectRef,
    reason: error instanceof Error ? error.message : "UNKNOWN",
  }));
  process.exitCode = 1;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_MISSING`);
  return value;
}

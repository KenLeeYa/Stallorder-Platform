export function requireEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required secret: ${name}`);
  return value;
}

export function getServiceRoleKey() {
  return Deno.env.get("SUPABASE_SECRET_KEY")?.trim()
    || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
    || requireEnv("SUPABASE_SECRET_KEY");
}

const canonicalPublicOrigins = [
  "https://stallorder-platform.vercel.app",
  "https://app.qidaigo.com",
];

export function getAllowedOrigins() {
  const configured = (Deno.env.get("PUBLIC_APP_ORIGINS")
    ?? [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ].join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set([...configured, ...canonicalPublicOrigins])];
}

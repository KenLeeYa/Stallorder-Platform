export function trustedPublicOrderClientIp(
  request: Request,
  production = process.env.NODE_ENV === "production",
) {
  const vercelClientIp = singleIp(request.headers.get("x-vercel-forwarded-for"));
  if (vercelClientIp) return vercelClientIp;
  if (production) return null;

  return singleIp(
    request.headers.get("x-real-ip")
    || request.headers.get("x-forwarded-for"),
  );
}

export function publicOrderUpstreamIpHeaders(clientIp: string | null): Record<string, string> {
  return clientIp ? { "x-real-ip": clientIp } : {};
}

function singleIp(value: string | null) {
  const candidate = value?.trim();
  return candidate && !candidate.includes(",") ? candidate : null;
}

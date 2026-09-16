import "server-only";

import { resolveDrAccessMode, verifyCloudflareAccessJwt } from "@/lib/cloudflare-access";
import { safeEqual } from "@/lib/security";

// Operators are selected by the audience-bound Cloudflare Access policy.
// The generated Vercel origin additionally requires an explicit deployment probe credential.
export async function authorizeDrOperatorRequest(
  request: Request,
  allowAutomation = false,
  environment: Record<string, string | undefined> = process.env,
) {
  if (environment.DR_OPERATOR_PROBE_ENABLED !== "true"
    || environment.DR_ACCESS_ENFORCEMENT_ENABLED !== "true") return false;
  const hostname = new URL(request.url).hostname;
  const mode = resolveDrAccessMode(hostname, environment);
  if (mode === "vercel-standard") {
    const expected = environment.DR_OPERATOR_PROBE_SECRET?.trim();
    return allowAutomation
      && environment.VERCEL === "1"
      && hostname === environment.VERCEL_URL
      && Boolean(expected && expected.length >= 16
        && safeEqual(request.headers.get("x-stallorder-dr-probe") ?? "", expected));
  }
  if (mode !== "cloudflare-access") return false;
  const token = request.headers.get("cf-access-jwt-assertion")?.trim();
  const teamDomain = environment.CLOUDFLARE_ACCESS_TEAM_DOMAIN?.trim();
  const audience = environment.CLOUDFLARE_ACCESS_AUD?.trim();
  if (!token || !teamDomain || !audience) return false;
  try {
    const claims = await verifyCloudflareAccessJwt(token, { teamDomain, audience });
    if (claims.type !== "app") return false;
    if (typeof claims.email === "string" && claims.email.trim()
      && typeof claims.sub === "string" && claims.sub.trim()) return true;
    return allowAutomation && claims.sub === ""
      && typeof claims.common_name === "string" && Boolean(claims.common_name.trim());
  } catch {
    return false;
  }
}

import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload,
} from "jose";

type DrAccessEnvironment = {
  [key: string]: string | undefined;
  DR_ACCESS_ENFORCEMENT_ENABLED?: string;
  DR_ACCESS_HOSTNAME?: string;
  CLOUDFLARE_ACCESS_TEAM_DOMAIN?: string;
  CLOUDFLARE_ACCESS_AUD?: string;
};

export type DrAccessMode = "none" | "cloudflare-access" | "vercel-standard" | "reject";

const remoteKeySets = new Map<string, JWTVerifyGetKey>();

export function resolveDrAccessMode(
  hostname: string | null,
  environment: DrAccessEnvironment = process.env,
): DrAccessMode {
  if (environment.DR_ACCESS_ENFORCEMENT_ENABLED !== "true") return "none";

  const requestHostname = normalizeHostname(hostname);
  const accessHostname = normalizeHostname(environment.DR_ACCESS_HOSTNAME ?? null);
  if (!requestHostname || !accessHostname) return "reject";
  if (requestHostname === accessHostname) return "cloudflare-access";
  if (requestHostname.endsWith(".vercel.app")) return "vercel-standard";
  return "reject";
}

export async function authorizeDrAccessRequest({
  hostname,
  headers,
  environment = process.env,
  keySet,
}: {
  hostname: string | null;
  headers: Headers;
  environment?: DrAccessEnvironment;
  keySet?: JWTVerifyGetKey;
}): Promise<boolean> {
  const mode = resolveDrAccessMode(hostname, environment);
  if (mode === "none" || mode === "vercel-standard") return true;
  if (mode === "reject") return false;

  const token = headers.get("Cf-Access-Jwt-Assertion")?.trim();
  const teamDomain = environment.CLOUDFLARE_ACCESS_TEAM_DOMAIN?.trim();
  const audience = environment.CLOUDFLARE_ACCESS_AUD?.trim();
  if (!token || !teamDomain || !audience) return false;

  try {
    await verifyCloudflareAccessJwt(token, { teamDomain, audience, keySet });
    return true;
  } catch {
    return false;
  }
}

export async function verifyCloudflareAccessJwt(
  token: string,
  {
    teamDomain,
    audience,
    keySet,
  }: {
    teamDomain: string;
    audience: string;
    keySet?: JWTVerifyGetKey;
  },
): Promise<JWTPayload> {
  const issuer = normalizeTeamDomain(teamDomain);
  if (!/^[A-Za-z0-9_-]{16,256}$/u.test(audience)) {
    throw new Error("CLOUDFLARE_ACCESS_AUD_INVALID");
  }
  const verificationKeySet = keySet ?? getRemoteKeySet(issuer);
  const result = await jwtVerify(token, verificationKeySet, {
    issuer,
    audience,
  });
  return result.payload;
}

function getRemoteKeySet(teamDomain: string): JWTVerifyGetKey {
  const existing = remoteKeySets.get(teamDomain);
  if (existing) return existing;
  const keySet = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
  remoteKeySets.set(teamDomain, keySet);
  return keySet;
}

function normalizeTeamDomain(value: string): string {
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.port
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
    || !/^[a-z0-9-]+\.cloudflareaccess\.com$/u.test(parsed.hostname)
  ) {
    throw new Error("CLOUDFLARE_ACCESS_TEAM_DOMAIN_INVALID");
  }
  return parsed.origin;
}

function normalizeHostname(value: string | null): string {
  const candidate = value?.trim().toLowerCase();
  if (!candidate) return "";
  try {
    return new URL(`https://${candidate}`).hostname;
  } catch {
    return "";
  }
}

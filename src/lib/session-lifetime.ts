export const AUTH_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
export const AUTH_SESSION_REFRESH_WINDOW_MS = 2 * 24 * 60 * 60 * 1_000;
export const AUTH_SESSION_ABSOLUTE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const LEGACY_AUTH_SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1_000;

export function shouldRefreshAuthSession(expiresAt: string, now = Date.now()) {
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry)
    && expiry > now
    && expiry - now <= AUTH_SESSION_REFRESH_WINDOW_MS;
}

export function nextAuthSessionCheckAt(expiresAt: string, now = Date.now()) {
  const expiry = Date.parse(expiresAt);
  const regularCheckAt = now + 12 * 60 * 60 * 1_000;
  if (!Number.isFinite(expiry) || expiry <= now) return regularCheckAt;
  return Math.max(now + 15 * 60 * 1_000, Math.min(regularCheckAt, expiry - AUTH_SESSION_REFRESH_WINDOW_MS));
}

export function isAuthSessionFamilyExpired(firstIssuedAt: Date, now = Date.now()) {
  return now - firstIssuedAt.getTime() >= AUTH_SESSION_ABSOLUTE_MAX_AGE_MS;
}

export function authSessionFamilyExpiresAt(firstIssuedAt: Date) {
  return new Date(firstIssuedAt.getTime() + AUTH_SESSION_ABSOLUTE_MAX_AGE_MS);
}

export function nextAuthSessionExpiresAt(firstIssuedAt: Date, now = Date.now()) {
  return new Date(Math.min(
    now + AUTH_SESSION_MAX_AGE_SECONDS * 1_000,
    authSessionFamilyExpiresAt(firstIssuedAt).getTime(),
  ));
}

export function authSessionDeviceMatches(
  storedDeviceId: string | null,
  presentedDeviceId: string | undefined,
): presentedDeviceId is string {
  return Boolean(
    storedDeviceId
    && presentedDeviceId
    && storedDeviceId === presentedDeviceId,
  );
}

export function canUpgradeLegacyUnboundAuthSession(input: {
  storedDeviceId: string | null;
  presentedDeviceId: string | undefined;
  issuedAt: Date;
  expiresAt: Date;
}) {
  const lifetimeMs = input.expiresAt.getTime() - input.issuedAt.getTime();
  return input.storedDeviceId === null
    && Boolean(input.presentedDeviceId)
    && lifetimeMs > 0
    && lifetimeMs <= LEGACY_AUTH_SESSION_MAX_AGE_MS;
}

const refreshLeadTimeMs = 5 * 60_000;

export function millisecondsUntilSessionRefresh(expiresAt: string, now = Date.now()) {
  const expiration = Date.parse(expiresAt);
  if (!Number.isFinite(expiration)) return 0;
  return Math.max(0, expiration - now - refreshLeadTimeMs);
}

export function shouldRefreshSession(expiresAt: string, now = Date.now()) {
  return millisecondsUntilSessionRefresh(expiresAt, now) === 0;
}

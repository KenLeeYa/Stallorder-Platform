import "server-only";

import type { SessionPrincipal } from "@/lib/auth";
import { CSRF_COOKIE } from "@/lib/auth";
import { getCookieValue, hashToken, isTrustedOrigin, safeEqual } from "@/lib/security";

export function validateCsrf(request: Request, principal: SessionPrincipal) {
  return validateCsrfHash(request, principal.csrfTokenHash);
}

export function validateCsrfHash(request: Request, csrfTokenHash: string) {
  if (!isTrustedOrigin(request)) return false;

  const headerToken = request.headers.get("x-csrf-token");
  const cookieToken = getCookieValue(request, CSRF_COOKIE);
  if (!headerToken || !cookieToken || !safeEqual(headerToken, cookieToken)) return false;

  return safeEqual(hashToken(headerToken), csrfTokenHash);
}

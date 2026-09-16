import "server-only";

import { authorizePlatformAdminApiRequest } from "@/lib/authorization";

export const healthResponseHeaders = {
  "cache-control": "private, no-store",
  "x-robots-tag": "noindex, nofollow, noarchive",
  vary: "Accept, Cookie",
};

export async function authorizeHealthApiRequest(request: Request) {
  const result = await authorizePlatformAdminApiRequest(request);
  if (!result.ok) {
    for (const [name, value] of Object.entries(healthResponseHeaders)) {
      result.response.headers.set(name, value);
    }
  }
  return result;
}

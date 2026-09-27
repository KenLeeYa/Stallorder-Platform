import "server-only";
import { z } from "zod";
import { readBoundedText } from "@/server/delivery-platforms/bounded-text-reader";
import { type MiniAppBinding, validateMiniAppBinding } from "./configuration";

const claimsSchema = z.object({
  iss: z.literal("https://access.line.me"),
  sub: z.string().regex(/^U[0-9a-f]{32}$/),
  aud: z.string(),
  exp: z.number().int().positive(),
  iat: z.number().int().positive(),
});

/** Verifies identity only; does not create sessions, consent, membership or order access. */
export async function verifyMiniAppIdentity(
  rawIdToken: string,
  trustedBinding: MiniAppBinding,
  dependencies: { fetchImpl?: typeof fetch; now?: () => number } = {},
) {
  const binding = validateMiniAppBinding(trustedBinding);
  if (!rawIdToken || rawIdToken.length > 16_384) throw new Error("LINE_MINIAPP_ID_TOKEN_INVALID");
  let response: Response;
  let payload: unknown;
  try {
    response = await (dependencies.fetchImpl ?? fetch)("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: rawIdToken, client_id: binding.channelId }),
    });
    // The provider endpoint is fixed. Drop unneeded profile/email fields immediately.
    const text = await readBoundedText(response, 32_768);
    payload = JSON.parse(text);
  } catch {
    throw new Error("LINE_MINIAPP_VERIFY_UNAVAILABLE");
  }
  const claims = claimsSchema.safeParse(payload);
  const now = dependencies.now?.() ?? Math.floor(Date.now() / 1000);
  if (!response.ok || !claims.success || claims.data.aud !== binding.channelId
    || claims.data.exp <= now || claims.data.iat > now + 60 || claims.data.iat >= claims.data.exp) {
    throw new Error("LINE_MINIAPP_ID_TOKEN_INVALID");
  }
  return {
    provider: "LINE" as const,
    // Keep this customer's MINI identity separate from operator OAuth and other Providers.
    subject: `miniapp:${binding.providerId}:${binding.internalChannel}:${binding.channelId}:${claims.data.sub}`,
    channelId: binding.channelId,
    providerId: binding.providerId,
    internalChannel: binding.internalChannel,
  };
}

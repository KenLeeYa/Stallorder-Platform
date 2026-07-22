import { randomToken, sha256Base64Url, sha256Hex } from "../_shared/crypto.ts";
import { getAllowedOrigins } from "../_shared/env.ts";
import {
  errorMessage,
  getCorsHeaders,
  HttpInputError,
  jsonResponse,
  readBoundedJson,
  statusForCode,
} from "../_shared/http.ts";
import { manageLineLinkSchema } from "../_shared/schemas.ts";
import { resolveTrackedOrder } from "../_shared/tracked-order.ts";

type IntegrationSettings = {
  displayName: string;
  officialAccountUrl: string;
};

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  let corsHeaders: Record<string, string> = {};
  const respond = (body: unknown, status: number) => jsonResponse(body, status, corsHeaders, requestId);

  try {
    corsHeaders = getCorsHeaders(request, getAllowedOrigins());
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== "POST") throw new HttpInputError("METHOD_NOT_ALLOWED", 405);
    const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
    if (contentType !== "application/json") throw new HttpInputError("INVALID_REQUEST", 415);

    const parsed = manageLineLinkSchema.safeParse(await readBoundedJson(request, 8_000));
    if (!parsed.success) throw new HttpInputError("INVALID_REQUEST", 400);
    const context = await resolveTrackedOrder({
      request,
      requestId,
      trackingToken: parsed.data.trackingToken,
      deviceId: parsed.data.deviceId,
      behavior: `line-link-${parsed.data.action.toLowerCase()}`,
    });
    const { data: integration, error: integrationError } = await context.admin
      .from("notification_integrations")
      .select("id, public_identifier, settings_json")
      .eq("organization_id", context.order.organization_id)
      .eq("stall_id", context.order.stall_id)
      .eq("provider", "LINE")
      .eq("status", "ACTIVE")
      .maybeSingle();
    if (integrationError) throw integrationError;
    const [linkingAccess, repeatAccess] = await Promise.all([
      featureAccess(context.admin, context.order.organization_id, "LINE_ORDER_LINKING"),
      featureAccess(context.admin, context.order.organization_id, "LINE_REPEAT_ORDER"),
    ]);
    const settings = publicSettings(integration?.settings_json);

    if (parsed.data.action === "STATUS") {
      const { data: link, error: linkError } = await context.admin
        .from("customer_contact_links")
        .select("consent_status")
        .eq("customer_reference_id", context.order.id)
        .eq("provider", "LINE")
        .maybeSingle();
      if (linkError) throw linkError;
      return respond({
        available: Boolean(integration) && linkingAccess === "OK",
        linked: link?.consent_status === "GRANTED",
        displayName: settings.displayName,
        officialAccountUrl: settings.officialAccountUrl,
        repeatOrderAvailable: repeatAccess === "OK",
      }, 200);
    }

    if (!integration || linkingAccess !== "OK" || !integration.public_identifier) {
      throw new HttpInputError("LINE_LINK_UNAVAILABLE", 403);
    }

    if (parsed.data.action === "REVOKE") {
      const { data, error } = await context.admin.rpc("revoke_line_contact_link", {
        p_order_id: context.order.id,
      });
      if (error) throw error;
      await writeAudit(context, requestId, "LINE_CONSENT_REVOKED", Boolean(data));
      return respond({ linked: false, revoked: Boolean(data) }, 200);
    }

    const state = randomToken(32);
    const nonce = randomToken(24);
    const codeVerifier = randomToken(48);
    const codeChallenge = await sha256Base64Url(codeVerifier);
    const origin = new URL(request.headers.get("origin") ?? "").origin;
    const redirectUri = `${origin}/api/public/line/callback`;
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const { error: sessionError } = await context.admin.rpc("start_line_link_session", {
      p_organization_id: context.order.organization_id,
      p_stall_id: context.order.stall_id,
      p_integration_id: integration.id,
      p_order_id: context.order.id,
      p_state_hash: await sha256Hex(state),
      p_ephemeral_secret: JSON.stringify({
        trackingToken: parsed.data.trackingToken,
        codeVerifier,
        nonce,
        redirectUri,
      }),
      p_expires_at: expiresAt,
    });
    if (sessionError) throw sessionError;

    const authorizationUrl = new URL("https://access.line.me/oauth2/v2.1/authorize");
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", integration.public_identifier);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("scope", "openid profile");
    authorizationUrl.searchParams.set("nonce", nonce);
    authorizationUrl.searchParams.set("code_challenge", codeChallenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    authorizationUrl.searchParams.set("bot_prompt", "aggressive");
    await writeAudit(context, requestId, "LINE_LINK_STARTED", true);
    return respond({ authorizationUrl: authorizationUrl.toString(), expiresAt }, 201);
  } catch (error) {
    const code = error instanceof HttpInputError ? error.code : "ORDER_CREATE_ERROR";
    const status = error instanceof HttpInputError ? error.status : statusForCode(code);
    if (!(error instanceof HttpInputError)) {
      console.error(JSON.stringify({
        level: "error",
        event: "LINE_LINK_EDGE_FAILED",
        requestId,
        code: safeErrorCode(error),
      }));
    }
    return respond({ error: errorMessage(code), code }, status);
  }
});

async function featureAccess(
  admin: Awaited<ReturnType<typeof resolveTrackedOrder>>["admin"],
  organizationId: string,
  code: string,
) {
  const { data, error } = await admin.rpc("notification_feature_access_code", {
    p_organization_id: organizationId,
    p_feature_code: code,
  });
  if (error) throw error;
  return String(data ?? "FEATURE_NOT_INCLUDED");
}

function publicSettings(value: unknown): IntegrationSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { displayName: "LINE 取餐通知", officialAccountUrl: "" };
  }
  const settings = value as Record<string, unknown>;
  return {
    displayName: typeof settings.displayName === "string" ? settings.displayName.slice(0, 80) : "LINE 取餐通知",
    officialAccountUrl: typeof settings.officialAccountUrl === "string" && settings.officialAccountUrl.startsWith("https://")
      ? settings.officialAccountUrl.slice(0, 500)
      : "",
  };
}

async function writeAudit(
  context: Awaited<ReturnType<typeof resolveTrackedOrder>>,
  requestId: string,
  action: string,
  changed: boolean,
) {
  const { error } = await context.admin.from("audit_logs").insert({
    organization_id: context.order.organization_id,
    stall_id: context.order.stall_id,
    action,
    entity_type: "ORDER",
    entity_id: context.order.id,
    outcome: "SUCCESS",
    request_id: requestId,
    ip_hash: context.ipHash,
    metadata: JSON.stringify({ changed }),
  });
  if (error) throw error;
}

function safeErrorCode(error: unknown) {
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : "UNKNOWN";
  return /^[A-Z0-9_]{3,80}$/.test(message) ? message : "LINE_LINK_FAILED";
}

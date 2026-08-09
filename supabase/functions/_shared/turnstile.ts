const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type TurnstileResponse = {
  success?: boolean;
  challenge_ts?: string;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
  metadata?: { result_with_testing_key?: boolean };
};

const OFFICIAL_ALWAYS_PASS_TEST_SECRET = "1x0000000000000000000000000000000AA";

export type TurnstileResult =
  | { ok: true }
  | { ok: false; code: "INVALID_TURNSTILE" | "TURNSTILE_UNAVAILABLE"; errors: string[] };

export async function verifyTurnstile(options: {
  token: string;
  remoteIp?: string;
  idempotencyKey: string;
  secret: string;
  expectedHostname?: string;
  expectedAction?: string;
  fetchImpl?: typeof fetch;
  now?: Date;
  allowTestKeys?: boolean;
  environment?: string;
}): Promise<TurnstileResult> {
  const isExplicitOfflineTest = options.secret === OFFICIAL_ALWAYS_PASS_TEST_SECRET
    && options.allowTestKeys === true
    && options.environment === "test";
  if (
    options.secret === OFFICIAL_ALWAYS_PASS_TEST_SECRET
    && (options.allowTestKeys !== true || options.environment === "production")
  ) {
    return { ok: false, code: "INVALID_TURNSTILE", errors: ["test_key_not_allowed"] };
  }
  if (isExplicitOfflineTest) return { ok: true };
  const fetchImpl = options.fetchImpl ?? fetch;
  const form = new FormData();
  form.set("secret", options.secret);
  form.set("response", options.token);
  if (options.remoteIp && options.remoteIp !== "unknown") form.set("remoteip", options.remoteIp);
  form.set("idempotency_key", options.idempotencyKey);

  try {
    const response = await fetchImpl(SITEVERIFY_URL, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { ok: false, code: "TURNSTILE_UNAVAILABLE", errors: ["upstream_error"] };
    const result = await response.json() as TurnstileResponse;
    const errors = result["error-codes"] ?? [];
    if (!result.success) return { ok: false, code: "INVALID_TURNSTILE", errors };
    const isExplicitOfficialTest = options.allowTestKeys === true
      && options.secret === OFFICIAL_ALWAYS_PASS_TEST_SECRET
      && result.metadata?.result_with_testing_key === true;
    if (!isExplicitOfficialTest && options.expectedAction && result.action !== options.expectedAction) {
      return { ok: false, code: "INVALID_TURNSTILE", errors: ["action_mismatch"] };
    }
    if (!isExplicitOfficialTest && options.expectedHostname && result.hostname !== options.expectedHostname) {
      return { ok: false, code: "INVALID_TURNSTILE", errors: ["hostname_mismatch"] };
    }
    if (!result.challenge_ts) return { ok: false, code: "INVALID_TURNSTILE", errors: ["missing_challenge_ts"] };
    const ageMs = (options.now ?? new Date()).getTime() - new Date(result.challenge_ts).getTime();
    if (!Number.isFinite(ageMs) || ageMs < -30_000 || ageMs > 300_000) {
      return { ok: false, code: "INVALID_TURNSTILE", errors: ["challenge_expired"] };
    }
    return { ok: true };
  } catch {
    return { ok: false, code: "TURNSTILE_UNAVAILABLE", errors: ["network_error"] };
  }
}

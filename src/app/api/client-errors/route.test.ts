import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  hashClientIp: vi.fn(),
  isTrustedOrigin: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({ logEvent: mocks.logEvent }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/security", () => ({
  createRequestId: () => "11111111-1111-4111-8111-111111111111",
  hashClientIp: mocks.hashClientIp,
  isTrustedOrigin: mocks.isTrustedOrigin,
}));

const validBody = {
  clientEventId: "22222222-2222-4222-8222-222222222222",
  type: "WINDOW_ERROR",
  errorName: "TypeError",
  surface: "merchant",
};

function request(body: unknown = validBody) {
  return new Request("https://app.qidaigo.com/api/client-errors", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://app.qidaigo.com" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/client-errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTrustedOrigin.mockReturnValue(true);
    mocks.hashClientIp.mockReturnValue("hashed-client-ip");
    mocks.checkRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 19,
      retryAfterSeconds: 60,
    });
  });

  it("records only the allowlisted bounded event after rate limiting", async () => {
    const route = await import("./route");
    const response = await route.POST(request());

    expect(response.status).toBe(202);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith({
      scope: "client-exception-report",
      identifier: "hashed-client-ip",
      limit: 20,
      windowMs: 60_000,
    });
    expect(mocks.logEvent).toHaveBeenCalledWith("error", "CLIENT_UNEXPECTED_ERROR", {
      requestId: "11111111-1111-4111-8111-111111111111",
      clientEventId: validBody.clientEventId,
      errorType: validBody.type,
      errorName: validBody.errorName,
      digest: undefined,
      surface: validBody.surface,
    });
  });

  it("rejects an untrusted origin before hashing or rate-limit writes", async () => {
    mocks.isTrustedOrigin.mockReturnValue(false);
    const route = await import("./route");
    const response = await route.POST(request());

    expect(response.status).toBe(403);
    expect(mocks.hashClientIp).not.toHaveBeenCalled();
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.logEvent).not.toHaveBeenCalled();
  });

  it("returns retry guidance without writing an event when the limit is exceeded", async () => {
    mocks.checkRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 47,
    });
    const route = await import("./route");
    const response = await route.POST(request());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("47");
    expect(mocks.logEvent).not.toHaveBeenCalled();
  });

  it("rejects private or arbitrary browser error fields", async () => {
    const route = await import("./route");
    const response = await route.POST(request({
      ...validBody,
      message: "customer phone and raw stack must not be accepted",
    }));

    expect(response.status).toBe(400);
    expect(mocks.logEvent).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const operationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("POST /api/public-order/:functionName", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
    vi.stubEnv("PUBLIC_ORDER_FUNCTION_ORIGIN", "https://app.qidaigo.com");
    vi.stubEnv("SUPABASE_FUNCTIONS_URL", "https://project.supabase.co/functions/v1");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("forwards and echoes one operation id while preserving the upstream request id", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return Response.json(
        { orderSessionToken: "stos_result" },
        {
          status: 201,
          headers: {
            "x-request-id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            "x-stallorder-operation-id": operationId,
          },
        },
      );
    });
    vi.stubGlobal("fetch", fetchImpl);
    const route = await import("./route");
    const response = await route.POST(new NextRequest(
      "https://app.qidaigo.com/api/public-order/create-order-session",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-real-ip": "203.0.113.8",
          "x-stallorder-operation-id": operationId,
        },
        body: JSON.stringify({ qrToken: "test-token" }),
      },
    ), { params: Promise.resolve({ functionName: "create-order-session" }) });

    const upstreamHeaders = new Headers(fetchImpl.mock.calls[0][1]?.headers);
    expect(upstreamHeaders.get("x-stallorder-operation-id")).toBe(operationId);
    expect(response.headers.get("x-stallorder-operation-id")).toBe(operationId);
    expect(response.headers.get("x-upstream-request-id"))
      .toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  });
});

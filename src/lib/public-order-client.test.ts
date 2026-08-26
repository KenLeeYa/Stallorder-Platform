import { afterEach, describe, expect, it, vi } from "vitest";

describe("getOrCreateDeviceId", () => {
  const cookieDeviceId = "11111111-1111-4111-8111-111111111111";
  const storedDeviceId = "22222222-2222-4222-8222-222222222222";
  const generatedDeviceId = "33333333-3333-4333-8333-333333333333";

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  function installBrowserStorage(cookie: string, storedValue: string | null) {
    let currentCookie = cookie;
    let currentStoredValue = storedValue;
    const storage = {
      getItem: vi.fn(() => currentStoredValue),
      setItem: vi.fn((_key: string, value: string) => {
        currentStoredValue = value;
      }),
      removeItem: vi.fn(() => {
        currentStoredValue = null;
      }),
    };
    const randomUUID = vi.fn(() => generatedDeviceId);
    vi.stubGlobal("document", {
      get cookie() {
        return currentCookie;
      },
      set cookie(value: string) {
        currentCookie = value;
      },
    });
    vi.stubGlobal("window", {
      location: { protocol: "https:", hostname: "app.qidaigo.com" },
      localStorage: storage,
    });
    vi.stubGlobal("crypto", { randomUUID });
    return {
      getCookie: () => currentCookie,
      getStoredValue: () => currentStoredValue,
      randomUUID,
      storage,
    };
  }

  it("優先沿用有效 Cookie，並同步版本化的本機備援", async () => {
    const browser = installBrowserStorage(
      `another=value; stallorder_device=${cookieDeviceId}`,
      storedDeviceId,
    );
    const { getOrCreateDeviceId } = await import("./public-order-client");

    expect(getOrCreateDeviceId()).toBe(cookieDeviceId);
    expect(JSON.parse(browser.getStoredValue() ?? "{}")).toMatchObject({
      id: cookieDeviceId,
    });
    expect(browser.randomUUID).not.toHaveBeenCalled();
  });

  it("Cookie 缺失時從有效本機備援復原，並補回一年期安全 Cookie", async () => {
    const browser = installBrowserStorage("another=value", storedDeviceId);
    const { getOrCreateDeviceId } = await import("./public-order-client");

    expect(getOrCreateDeviceId()).toBe(storedDeviceId);
    expect(browser.getCookie()).toContain(`stallorder_device=${storedDeviceId}`);
    expect(browser.getCookie()).toContain("Max-Age=31536000");
    expect(browser.getCookie()).toContain("SameSite=Lax; Secure");
    expect(JSON.parse(browser.getStoredValue() ?? "{}")).toMatchObject({
      id: storedDeviceId,
    });
    expect(browser.randomUUID).not.toHaveBeenCalled();
  });

  it("Cookie 與本機備援皆無效時產生新識別並同步兩處", async () => {
    const browser = installBrowserStorage("stallorder_device=%E0%A4%A", "invalid");
    const { getOrCreateDeviceId } = await import("./public-order-client");

    expect(getOrCreateDeviceId()).toBe(generatedDeviceId);
    expect(browser.getCookie()).toContain(`stallorder_device=${generatedDeviceId}`);
    expect(JSON.parse(browser.getStoredValue() ?? "{}")).toMatchObject({
      id: generatedDeviceId,
    });
    expect(browser.randomUUID).toHaveBeenCalledOnce();
  });

  it("不會從已逾期的本機備援復活識別碼", async () => {
    const browser = installBrowserStorage("", JSON.stringify({
      id: storedDeviceId,
      expiresAt: Date.now() - 1,
    }));
    const { getOrCreateDeviceId } = await import("./public-order-client");

    expect(getOrCreateDeviceId()).toBe(generatedDeviceId);
    expect(browser.storage.removeItem).toHaveBeenCalledWith("stallorder_device:v1");
    expect(JSON.parse(browser.getStoredValue() ?? "{}")).toMatchObject({
      id: generatedDeviceId,
    });
  });
});

describe("publicEdgeUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("設定正式 Edge Function 時直接呼叫並附上 publishable key", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL", "https://project.supabase.co/functions/v1/");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
    const { publicEdgeHeaders, publicEdgeUrl } = await import("./public-order-client");

    expect(publicEdgeUrl("create-order-session")).toBe("https://project.supabase.co/functions/v1/create-order-session");
    expect(publicEdgeHeaders()).toEqual({
      apikey: "public-test-key",
      authorization: "Bearer public-test-key",
    });
  });

  it("缺少直接呼叫設定時使用同站 API proxy", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    const { publicEdgeHeaders, publicEdgeUrl } = await import("./public-order-client");

    expect(publicEdgeUrl("create-order-session")).toBe("/api/public-order/create-order-session");
    expect(publicEdgeHeaders()).toEqual({});
  });

  it("Vercel Preview 使用同站 API proxy，避免每個預覽網域都要修改 Edge CORS", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL", "https://project.supabase.co/functions/v1/");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
    vi.stubGlobal("window", { location: { hostname: "project-preview.vercel.app" } });
    const { publicEdgeHeaders, publicEdgeUrl } = await import("./public-order-client");

    expect(publicEdgeUrl("create-order-session")).toBe("/api/public-order/create-order-session");
    expect(publicEdgeHeaders()).toEqual({});
  });
});

describe("requestPublicOrder", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  function configureDirectEdge() {
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL",
      "https://project.supabase.co/functions/v1/",
    );
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
  }

  it("routes reorder preparation through the same-site API during local Circuit B QA", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_FORCE_PUBLIC_ORDER_CIRCUIT_B", "true");
    vi.stubGlobal("window", { location: { hostname: "127.0.0.1" } });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/public/orders/sto_local_tracking/reorder");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        "content-type": "application/json",
        "x-stallorder-protocol-version": "1",
      });
      return Response.json({ orderingMode: "PREORDER", availableItems: [] });
    });
    const { requestPrepareReorder } = await import("./public-order-client");

    const response = await requestPrepareReorder({
      trackingToken: "sto_local_tracking",
      deviceId: "11111111-1111-4111-8111-111111111111",
    }, {
      fetchImpl,
      operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("uses the same-site Circuit B API when a LAN browser cannot reach loopback Edge Functions", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL", "http://127.0.0.1:54321/functions/v1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "local-public-key");
    vi.stubGlobal("window", { location: { hostname: "192.168.1.102" } });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("/api/public/order-session");
      return Response.json({ orderSessionToken: "stos_local_session" }, { status: 201 });
    });
    const { requestPublicOrder } = await import("./public-order-client");

    const response = await requestPublicOrder(
      "create-order-session",
      {
        deviceId: "11111111-1111-4111-8111-111111111111",
        sessionRequestId: "55555555-5555-4555-8555-555555555555",
      },
      {
        fetchImpl,
        operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
    );

    expect(response.status).toBe(201);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("allows local QA to force the same-site Circuit B API when Edge Runtime is stopped", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_FORCE_PUBLIC_ORDER_CIRCUIT_B", "true");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL", "http://127.0.0.1:54321/functions/v1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "local-public-key");
    vi.stubGlobal("window", { location: { hostname: "127.0.0.1" } });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("/api/public/order-session");
      return Response.json({ orderSessionToken: "stos_forced_local_session" }, { status: 201 });
    });
    const { requestPublicOrder } = await import("./public-order-client");

    const response = await requestPublicOrder(
      "create-order-session",
      {
        deviceId: "11111111-1111-4111-8111-111111111111",
        sessionRequestId: "55555555-5555-4555-8555-555555555555",
      },
      {
        fetchImpl,
        operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
    );

    expect(response.status).toBe(201);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("falls back to Circuit B with identical order identifiers and operation id", async () => {
    configureDirectEdge();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const bodies: string[] = [];
    const operationIds: Array<string | null> = [];
    const operationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/availability/config") {
        return Response.json({ orderIntake: "DUAL" });
      }
      if (url.endsWith("/create-public-order")) {
        bodies.push(String(init?.body));
        operationIds.push(new Headers(init?.headers).get("x-stallorder-operation-id"));
        return Response.json({ code: "ORDER_CREATE_ERROR" }, {
          status: 503,
          headers: { "x-stallorder-operation-id": operationId },
        });
      }
      if (url === "/api/public/orders") {
        bodies.push(String(init?.body));
        operationIds.push(new Headers(init?.headers).get("x-stallorder-operation-id"));
        return Response.json({ trackingToken: "sto_result" }, {
          status: 201,
          headers: { "x-stallorder-operation-id": operationId },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const { requestPublicOrder } = await import("./public-order-client");
    const payload = {
      deviceId: "11111111-1111-4111-8111-111111111111",
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
      clientOrderId: "33333333-3333-4333-8333-333333333333",
      turnstileIdempotencyKey: "44444444-4444-4444-8444-444444444444",
    };

    const response = await requestPublicOrder(
      "create-public-order",
      payload,
      { fetchImpl, operationId },
    );

    expect(response.status).toBe(201);
    expect(bodies).toEqual([JSON.stringify(payload), JSON.stringify(payload)]);
    expect(operationIds).toEqual([operationId, operationId]);
    expect(response.headers.get("x-stallorder-operation-id")).toBe(operationId);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/public/orders",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("does not duplicate a session when Circuit A commits before Circuit B fallback", async () => {
    configureDirectEdge();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const sessions = new Map<string, string>();
    let sessionWrites = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/availability/config") {
        return Response.json({ orderIntake: "DUAL" });
      }
      const payload = JSON.parse(String(init?.body)) as { sessionRequestId: string };
      const existingToken = sessions.get(payload.sessionRequestId);
      if (url.endsWith("/create-order-session")) {
        if (!existingToken) {
          sessionWrites += 1;
          sessions.set(payload.sessionRequestId, "stos_committed_session");
        }
        return Response.json({ code: "ORDER_CREATE_ERROR" }, { status: 503 });
      }
      if (url === "/api/public/order-session") {
        if (!existingToken) {
          sessionWrites += 1;
          sessions.set(payload.sessionRequestId, "stos_committed_session");
        }
        return Response.json({
          orderSessionToken: sessions.get(payload.sessionRequestId),
        }, { status: 200 });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const { requestPublicOrder } = await import("./public-order-client");
    const payload = {
      deviceId: "11111111-1111-4111-8111-111111111111",
      sessionRequestId: "55555555-5555-4555-8555-555555555555",
    };

    const response = await requestPublicOrder(
      "create-order-session",
      payload,
      { fetchImpl, operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      orderSessionToken: "stos_committed_session",
    });
    expect(sessionWrites).toBe(1);
    expect(sessions.size).toBe(1);
  });

  it("does not duplicate an order when Circuit A commits before Circuit B fallback", async () => {
    configureDirectEdge();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const orders = new Map<string, Record<string, unknown>>();
    let orderWrites = 0;
    const committedOrder = {
      orderNo: "A001",
      trackingToken: "sto_committed_order",
      pickupVerificationCode: "123456",
      fulfillmentType: "TAKEOUT",
      orderStatus: "WAITING_CONFIRMATION",
      paymentStatus: "UNPAID",
      totalAmount: 100,
      quotedWaitMinutes: 10,
      quotedReadyAt: "2026-08-13T00:10:00.000Z",
      scheduledPickupAt: null,
      requestedFulfillmentAt: null,
      discountAmount: 0,
      createdAt: "2026-08-13T00:00:00.000Z",
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/availability/config") {
        return Response.json({ orderIntake: "DUAL" });
      }
      const payload = JSON.parse(String(init?.body)) as { idempotencyKey: string };
      const existingOrder = orders.get(payload.idempotencyKey);
      if (url.endsWith("/create-public-order")) {
        if (!existingOrder) {
          orderWrites += 1;
          orders.set(payload.idempotencyKey, committedOrder);
        }
        return Response.json({ code: "ORDER_CREATE_ERROR" }, { status: 503 });
      }
      if (url === "/api/public/orders") {
        if (!existingOrder) {
          orderWrites += 1;
          orders.set(payload.idempotencyKey, committedOrder);
        }
        return Response.json(orders.get(payload.idempotencyKey), { status: 200 });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const { requestPublicOrder } = await import("./public-order-client");
    const payload = {
      deviceId: "11111111-1111-4111-8111-111111111111",
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
      clientOrderId: "33333333-3333-4333-8333-333333333333",
      turnstileIdempotencyKey: "44444444-4444-4444-8444-444444444444",
    };

    const response = await requestPublicOrder(
      "create-public-order",
      payload,
      { fetchImpl, operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(committedOrder);
    expect(orderWrites).toBe(1);
    expect(orders.size).toBe(1);
  });

  it("creates one operation id when the caller omits it", async () => {
    configureDirectEdge();
    let operationId: string | null = null;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/availability/config") {
        return Response.json({ orderIntake: "EDGE_PRIMARY" });
      }
      if (url.endsWith("/get-public-order")) {
        operationId = new Headers(init?.headers).get("x-stallorder-operation-id");
        return Response.json({ order: { orderNo: "A001" } }, {
          headers: { "x-stallorder-operation-id": operationId ?? "" },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const { requestPublicOrder } = await import("./public-order-client");

    const response = await requestPublicOrder(
      "get-public-order",
      { deviceId: "11111111-1111-4111-8111-111111111111" },
      { fetchImpl },
    );

    expect(operationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(response.headers.get("x-stallorder-operation-id")).toBe(operationId);
  });

  it("rejects a caller-supplied invalid operation id before transport", async () => {
    const fetchImpl = vi.fn();
    const { requestPublicOrder } = await import("./public-order-client");

    await expect(requestPublicOrder(
      "create-order-session",
      {},
      { fetchImpl, operationId: "invalid" },
    )).rejects.toThrow("INVALID_PUBLIC_ORDER_OPERATION_ID");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("lets a caller retain the operation id across a separate 5xx retry", async () => {
    configureDirectEdge();
    const operationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const sessionRequestId = "55555555-5555-4555-8555-555555555555";
    const edgeRequests: Array<{ body: string; operationId: string | null }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/availability/config") {
        return Response.json({ orderIntake: "EDGE_PRIMARY" });
      }
      if (url.endsWith("/create-order-session")) {
        edgeRequests.push({
          body: String(init?.body),
          operationId: new Headers(init?.headers).get("x-stallorder-operation-id"),
        });
        return edgeRequests.length === 1
          ? Response.json({ code: "ORDER_CREATE_ERROR" }, { status: 503 })
          : Response.json({ orderSessionToken: "stos_result" }, { status: 201 });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const { requestPublicOrder } = await import("./public-order-client");
    const payload = {
      deviceId: "11111111-1111-4111-8111-111111111111",
      sessionRequestId,
    };

    const first = await requestPublicOrder(
      "create-order-session",
      payload,
      { fetchImpl, operationId },
    );
    const retry = await requestPublicOrder(
      "create-order-session",
      payload,
      { fetchImpl, operationId },
    );

    expect([first.status, retry.status]).toEqual([503, 201]);
    expect(edgeRequests).toEqual([
      { body: JSON.stringify(payload), operationId },
      { body: JSON.stringify(payload), operationId },
    ]);
  });

  it.each([
    [429, "RATE_LIMITED"],
    [400, "INVALID_TURNSTILE"],
    [503, "TURNSTILE_UNAVAILABLE"],
    [503, "QR_ORDERING_DEGRADED"],
    [503, "QR_ORDERING_UNAVAILABLE"],
  ])("does not fall back for business rejection %s %s", async (status, code) => {
    configureDirectEdge();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/availability/config") {
        return Response.json({ orderIntake: "DUAL" });
      }
      if (url.endsWith("/create-public-order")) {
        return Response.json({ code }, { status });
      }
      throw new Error(`unexpected fallback request: ${url}`);
    });
    const { requestPublicOrder } = await import("./public-order-client");

    const response = await requestPublicOrder(
      "create-public-order",
      { deviceId: "11111111-1111-4111-8111-111111111111" },
      { fetchImpl },
    );

    expect(response.status).toBe(status);
    expect(fetchImpl.mock.calls.map(([input]) => String(input))).not.toContain(
      "/api/public/orders",
    );
  });

  it("falls back after a transport failure only when dual intake is enabled", async () => {
    configureDirectEdge();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/availability/config") {
        return Response.json({ orderIntake: "DUAL" });
      }
      if (url.endsWith("/create-order-session")) {
        throw new TypeError("network unavailable");
      }
      if (url === "/api/public/order-session") {
        return Response.json({ orderSessionToken: "stos_result" }, { status: 201 });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const { requestPublicOrder } = await import("./public-order-client");

    const response = await requestPublicOrder(
      "create-order-session",
      {
        deviceId: "11111111-1111-4111-8111-111111111111",
        sessionRequestId: "55555555-5555-4555-8555-555555555555",
      },
      { fetchImpl },
    );

    expect(response.status).toBe(201);
    expect(fetchImpl.mock.calls.map(([input]) => String(input))).toContain(
      "/api/public/order-session",
    );
  });

  it("aborts a delayed Circuit B request when the caller cancels", async () => {
    configureDirectEdge();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const abort = new AbortController();
    const fallbackRequest: {
      signal?: AbortSignal;
      reject?: (reason?: unknown) => void;
    } = {};
    const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/availability/config") {
        return Promise.resolve(Response.json({ orderIntake: "DUAL" }));
      }
      if (url.endsWith("/create-order-session")) {
        return Promise.resolve(Response.json({ code: "ORDER_CREATE_ERROR" }, { status: 503 }));
      }
      if (url === "/api/public/order-session") {
        fallbackRequest.signal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          fallbackRequest.reject = reject;
          fallbackRequest.signal?.addEventListener("abort", () => reject(
            fallbackRequest.signal?.reason,
          ), {
            once: true,
          });
        });
      }
      return Promise.reject(new Error(`unexpected request: ${url}`));
    });
    const { requestPublicOrder } = await import("./public-order-client");
    const reason = new DOMException("tracker stopped", "AbortError");

    const request = requestPublicOrder(
      "create-order-session",
      {
        deviceId: "11111111-1111-4111-8111-111111111111",
        sessionRequestId: "55555555-5555-4555-8555-555555555555",
      },
      { fetchImpl, signal: abort.signal },
    );
    await vi.waitFor(() => expect(fallbackRequest.signal).toBeDefined());

    abort.abort(reason);
    const underlyingRequestWasAborted = fallbackRequest.signal?.aborted;
    fallbackRequest.reject?.(reason);

    await expect(request).rejects.toBe(reason);
    expect(underlyingRequestWasAborted).toBe(true);
  });
});

describe("respondToFulfillmentTime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("posts only the bound device, version, and response to the same-site API", async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      ok: true,
      state: "CONFIRMED",
      version: 3,
    }));
    const { respondToFulfillmentTime } = await import("./public-order-client");
    const trackingToken = `sto_${"a".repeat(43)}`;

    const response = await respondToFulfillmentTime({
      trackingToken,
      deviceId: "11111111-1111-4111-8111-111111111111",
      version: 3,
      response: "DECLINE",
    }, { fetchImpl });

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledWith(
      `/api/public/orders/${encodeURIComponent(trackingToken)}/fulfillment-time`,
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deviceId: "11111111-1111-4111-8111-111111111111",
          version: 3,
          response: "DECLINE",
        }),
        cache: "no-store",
      }),
    );
  });
});

describe("getPublicAvailability", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("parses only the bounded public availability contract", async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      mode: "NORMAL_DR",
      activeBackend: "DR",
      promotionEpoch: 4,
      orderIntake: "DUAL",
      qrOrdering: "AVAILABLE",
      staffOnline: "DEGRADED",
      offlinePos: "AVAILABLE",
      linePay: "UNAVAILABLE",
      jkoPay: "AVAILABLE",
      updatedAt: "2026-07-29T00:00:00.000Z",
      databaseUrl: "must-not-be-copied",
    }));
    const { getPublicAvailability } = await import("./public-order-client");

    const result = await getPublicAvailability(
      "11111111-1111-4111-8111-111111111111",
      { fetchImpl, forceRefresh: true },
    );

    expect(result).toEqual({
      mode: "NORMAL_DR",
      activeBackend: "DR",
      promotionEpoch: 4,
      orderIntake: "DUAL",
      qrOrdering: "AVAILABLE",
      staffOnline: "DEGRADED",
      offlinePos: "AVAILABLE",
      linePay: "UNAVAILABLE",
      jkoPay: "AVAILABLE",
      updatedAt: "2026-07-29T00:00:00.000Z",
    });
    expect(JSON.stringify(result)).not.toContain("databaseUrl");
  });

  it("fails closed when the availability endpoint cannot be reached", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("network unavailable");
    });
    const { getPublicAvailability } = await import("./public-order-client");

    await expect(getPublicAvailability(
      "11111111-1111-4111-8111-111111111111",
      { fetchImpl, forceRefresh: true },
    )).resolves.toBeNull();
  });
});

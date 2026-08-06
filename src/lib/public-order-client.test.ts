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

  it("falls back to Circuit B on an infrastructure response with identical order identifiers", async () => {
    configureDirectEdge();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const bodies: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/availability/config") {
        return Response.json({ orderIntake: "DUAL" });
      }
      if (url.endsWith("/create-public-order")) {
        bodies.push(String(init?.body));
        return Response.json({ code: "ORDER_CREATE_ERROR" }, { status: 503 });
      }
      if (url === "/api/public/orders") {
        bodies.push(String(init?.body));
        return Response.json({ trackingToken: "sto_result" }, { status: 201 });
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
      { fetchImpl },
    );

    expect(response.status).toBe(201);
    expect(bodies).toEqual([JSON.stringify(payload), JSON.stringify(payload)]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/public/orders",
      expect.objectContaining({ method: "POST" }),
    );
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

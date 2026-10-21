import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  issueOrderSessionThroughCircuitB: vi.fn(),
  runtime: vi.fn(), principal: vi.fn(), bind: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getRequestPrincipal: mocks.principal }));
vi.mock("@/server/line-platform/runtime", () => ({ getLinePlatformRuntime: mocks.runtime }));
vi.mock("@/server/line-platform/guest-cart", () => ({ bindPlatformOrderSession: mocks.bind }));
const testOrigin = "https://app.qidaigo.com";
const operationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

vi.mock("@/server/public-order/circuit-b-service", () => ({
  PublicOrderCircuitError: class PublicOrderCircuitError extends Error {
    constructor(
      public readonly code: string,
      public readonly status: number,
      public readonly responseBody?: Record<string, unknown>,
    ) {
      super(code);
    }
  },
  issueOrderSessionThroughCircuitB: mocks.issueOrderSessionThroughCircuitB,
}));

describe("POST /api/public/order-session", () => {
  beforeEach(() => {
    vi.stubEnv("TRUSTED_APP_ORIGINS", testOrigin);
    mocks.runtime.mockReset().mockReturnValue(null); mocks.principal.mockReset().mockResolvedValue({user:{id:"member-a"}}); mocks.bind.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    mocks.issueOrderSessionThroughCircuitB.mockReset();
  });

  it("keeps the client session request id for cross-circuit replay", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    mocks.issueOrderSessionThroughCircuitB.mockResolvedValue({
      status: 201,
      body: { orderSessionToken: "stos_result" },
    });
    const body = {
      qrToken: "demo-aming-chicken-qr-2026-rotate-me",
      deviceId: "11111111-1111-4111-8111-111111111111",
      sessionRequestId: "22222222-2222-4222-8222-222222222222",
      orderingMode: "DEFAULT",
      includeMenu: true,
    };
    const route = await import("./route");
    const response = await route.POST(new Request(
      `${testOrigin}/api/public/order-session`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: testOrigin,
          "x-real-ip": "203.0.113.8",
          "x-stallorder-protocol-version": "1",
          "x-stallorder-operation-id": operationId,
        },
        body: JSON.stringify(body),
      },
    ));

    expect(response.status).toBe(201);
    expect(response.headers.get("x-stallorder-operation-id")).toBe(operationId);
    expect(response.headers.get("x-request-id")).not.toBe(operationId);
    expect(mocks.issueOrderSessionThroughCircuitB).toHaveBeenCalledWith(
      body,
      expect.objectContaining({ clientIp: "203.0.113.8" }),
    );
  });
  it.each(['disabled','invalid','member','other-owner'])('preserves the optional platform boundary for %s session requests', async mode => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    if(mode==='invalid')mocks.runtime.mockImplementation(()=>{throw new Error('INVALID_CONFIG');});
    if(mode==='member'||mode==='other-owner')mocks.runtime.mockReturnValue({environment:'local'});
    if(mode==='other-owner')mocks.bind.mockRejectedValue(new Error('CART_HANDOFF_UNAVAILABLE'));
    mocks.issueOrderSessionThroughCircuitB.mockResolvedValue({status:201,body:{orderSessionToken:'stos_result'}});
    const body={qrToken:'demo-aming-chicken-qr-2026-rotate-me',deviceId:'11111111-1111-4111-8111-111111111111',sessionRequestId:'22222222-2222-4222-8222-222222222222',orderingMode:'DEFAULT',includeMenu:true};
    const {POST}=await import('./route');
    const result=await POST(new Request(`${testOrigin}/api/public/order-session`,{method:'POST',headers:{origin:testOrigin,'content-type':'application/json','x-real-ip':'203.0.113.8','x-stallorder-protocol-version':'1'},body:JSON.stringify(body)}));
    expect(result.status).toBe(mode==='other-owner'?403:201);
    if(mode==='member'||mode==='other-owner')expect(mocks.bind).toHaveBeenCalledWith({orderSessionToken:'stos_result',deviceId:body.deviceId,qrToken:body.qrToken},{user:{id:'member-a'}});
    else expect(mocks.bind).not.toHaveBeenCalled();
  });

});

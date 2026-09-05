import { describe, expect, it } from "vitest";
import { clientErrorSurface, clientExceptionPayload } from "./client-exception-reporting";

describe("client exception reporting", () => {
  it("reports only a coarse route surface and safe diagnostics", () => {
    const payload = clientExceptionPayload({
      type: "REACT_BOUNDARY",
      error: new TypeError("customer phone 0912345678"),
      digest: "safe_digest-123",
      pathname: "/order/sto_secret_tracking_token",
    });

    expect(payload).toMatchObject({
      type: "REACT_BOUNDARY",
      errorName: "TypeError",
      digest: "safe_digest-123",
      surface: "order",
    });
    expect(JSON.stringify(payload)).not.toContain("0912345678");
    expect(JSON.stringify(payload)).not.toContain("sto_secret_tracking_token");
  });

  it("normalizes untrusted route segments", () => {
    expect(clientErrorSurface("/%E0%A4%A")).toBe("unknown");
    expect(clientErrorSurface("/")).toBe("home");
  });
});

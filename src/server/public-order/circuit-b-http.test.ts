import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPerformanceTiming } from "@/lib/performance-timing";
import { circuitBFailureResponse } from "@/server/public-order/circuit-b-http";

describe("Circuit B failure diagnostics", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs only allowlisted Prisma and SQLSTATE diagnostics", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new Prisma.PrismaClientKnownRequestError(
      "secret raw query and connection details",
      {
        code: "P2010",
        clientVersion: "test",
        meta: {
          code: "40P01",
          message: "deadlock detail containing sensitive query text",
          query: "select secret from private_table",
        },
      },
    );

    const response = circuitBFailureResponse(
      error,
      "request-test",
      timing(),
      "ORDER_SESSION_CIRCUIT_B_FAILED",
    );

    expect(response.status).toBe(500);
    expect(consoleError).toHaveBeenCalledTimes(1);
    const record = JSON.parse(String(consoleError.mock.calls[0][0])) as Record<string, unknown>;
    expect(record).toMatchObject({
      event: "ORDER_SESSION_CIRCUIT_B_FAILED",
      requestId: "request-test",
      circuit: "B",
      errorName: "PrismaClientKnownRequestError",
      prismaCode: "P2010",
      sqlState: "40P01",
    });
    expect(JSON.stringify(record)).not.toContain("secret raw query");
    expect(JSON.stringify(record)).not.toContain("sensitive query");
    expect(JSON.stringify(record)).not.toContain("private_table");
  });

  it("omits SQLSTATE values outside the transient allowlist", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new Prisma.PrismaClientKnownRequestError("hidden", {
      code: "P2010",
      clientVersion: "test",
      meta: { code: "23505" },
    });

    circuitBFailureResponse(
      error,
      "request-test",
      timing(),
      "ORDER_SESSION_CIRCUIT_B_FAILED",
    );

    const record = JSON.parse(String(consoleError.mock.calls[0][0])) as Record<string, unknown>;
    expect(record).not.toHaveProperty("sqlState");
  });
});

function timing() {
  return createPerformanceTiming({
    route: "/api/public/order-session",
    requestId: "request-test",
    logger: () => undefined,
  });
}

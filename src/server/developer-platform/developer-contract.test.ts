import { describe, expect, it } from "vitest";
import { developerCommandSchema } from "@/server/developer-platform/developer-contract";

describe("developer platform command contract", () => {
  it("normalizes and de-duplicates public API scopes", () => {
    const parsed = developerCommandSchema.parse({
      operation: "CREATE_API_KEY",
      name: "ERP read only",
      scopes: ["catalog:read", "catalog:read", "orders:read"],
      stallIds: [],
      expiresAt: "2027-08-26T00:00:00.000Z",
    });

    expect(parsed.operation).toBe("CREATE_API_KEY");
    if (parsed.operation !== "CREATE_API_KEY") throw new Error("unexpected command");
    expect(parsed.scopes).toEqual(["catalog:read", "orders:read"]);
  });

  it.each([
    "http://hooks.example.test/stallorder",
    "https://127.0.0.1/hook",
    "https://localhost/hook",
    "https://user:password@hooks.example.test/hook",
  ])("rejects an unsafe webhook URL: %s", (url) => {
    const parsed = developerCommandSchema.safeParse({
      operation: "CREATE_WEBHOOK_ENDPOINT",
      name: "測試端點",
      url,
      eventTypes: ["ORDER_COMPLETED"],
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts a bounded HTTPS webhook subscription", () => {
    const parsed = developerCommandSchema.parse({
      operation: "CREATE_WEBHOOK_ENDPOINT",
      name: "ERP 訂單同步",
      url: "https://hooks.example.test/stallorder",
      eventTypes: ["ORDER_COMPLETED", "ORDER_CANCELLED", "ORDER_COMPLETED"],
    });

    expect(parsed.operation).toBe("CREATE_WEBHOOK_ENDPOINT");
    if (parsed.operation !== "CREATE_WEBHOOK_ENDPOINT") throw new Error("unexpected command");
    expect(parsed.eventTypes).toEqual(["ORDER_COMPLETED", "ORDER_CANCELLED"]);
  });
});

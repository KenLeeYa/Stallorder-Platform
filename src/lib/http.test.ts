import { describe, expect, it } from "vitest";
import { readJson } from "./http";

describe("readJson", () => {
  it("accepts bounded JSON with a charset parameter", async () => {
    const result = await readJson(new Request("https://stallorder.test/api", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ name: "測試" }),
    }));

    expect(result).toEqual({ data: { name: "測試" } });
  });

  it("rejects unrelated content types before parsing", async () => {
    const result = await readJson(new Request("https://stallorder.test/api", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ name: "測試" }),
    }));

    expect(result.error?.status).toBe(415);
  });

  it("rejects oversized request bodies even without content-length", async () => {
    const result = await readJson(new Request("https://stallorder.test/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(32_001) }),
    }));

    expect(result.error?.status).toBe(413);
  });
});

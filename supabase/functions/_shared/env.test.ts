import { describe, expect, it, vi } from "vitest";
import { getAllowedOrigins } from "./env";

describe("Edge Function Origin 白名單", () => {
  it("預設允許本機與正式 QR 點餐網域", () => {
    vi.stubGlobal("Deno", { env: { get: () => undefined } });

    expect(getAllowedOrigins()).toEqual(expect.arrayContaining([
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "https://stallorder-platform.vercel.app",
      "https://app.qidaigo.com",
      "https://staging.qidaigo.com",
    ]));
  });

  it("保留正式站與 Vercel production alias", () => {
    vi.stubGlobal("Deno", { env: { get: () => "https://preview.example.com" } });

    expect(getAllowedOrigins()).toEqual([
      "https://preview.example.com",
      "https://stallorder-platform.vercel.app",
      "https://app.qidaigo.com",
      "https://staging.qidaigo.com",
    ]);
  });
});

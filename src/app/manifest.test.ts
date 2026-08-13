import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

describe("PWA manifest launch contract", () => {
  it("opens the server-side session-aware launch route", () => {
    expect(manifest().start_url).toBe("/launch");
  });
});

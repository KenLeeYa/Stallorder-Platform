import { afterEach, describe, expect, it, vi } from "vitest";
import { getSupabaseBrowserUrl, isSupabaseBrowserConfigured } from "./supabase-browser";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Supabase browser endpoint", () => {
  it("uses the dedicated Realtime URL when configured", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_REALTIME_URL", " http://127.0.0.1:56321 ");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55431");

    expect(getSupabaseBrowserUrl()).toBe("http://127.0.0.1:56321");
  });

  it("falls back to the shared Supabase URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_REALTIME_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", " https://project.supabase.co ");

    expect(getSupabaseBrowserUrl()).toBe("https://project.supabase.co");
  });

  it("still requires a real publishable key", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_REALTIME_URL", "http://127.0.0.1:56321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "replace-with-key");
    expect(isSupabaseBrowserConfigured()).toBe(false);

    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "local-publishable-key");
    expect(isSupabaseBrowserConfigured()).toBe(true);
  });
});

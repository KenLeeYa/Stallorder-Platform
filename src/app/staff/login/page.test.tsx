import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/components/locale-provider";

vi.mock("@/lib/supabase-auth", () => ({
  isSupabaseAuthConfigured: () => false,
}));

vi.mock("@/server/auth/oauth/provider-registry", () => ({
  getOAuthLoginUiConfig: async () => ({
    oauthOnly: false,
    providers: [
      { provider: "GOOGLE", requested: true, configured: true, enabled: true },
      { provider: "LINE", requested: true, configured: true, enabled: true },
      { provider: "APPLE", requested: false, configured: false, enabled: false },
      { provider: "MICROSOFT", requested: false, configured: false, enabled: false },
    ],
  }),
}));

import StaffLoginPage from "./page";

describe("staff login page", () => {
  it("renders its own staff entry with enabled identity providers", async () => {
    const page = await StaffLoginPage();
    const html = renderToStaticMarkup(
      <LocaleProvider initialLocale="zh-TW" hasLocaleCookie>
        {page}
      </LocaleProvider>,
    );

    expect(html).toContain("員工登入");
    expect(html).toContain("使用 Google 登入");
    expect(html).toContain("使用 LINE 登入");
    expect(html).not.toContain("還沒有商家帳號");
  });
});

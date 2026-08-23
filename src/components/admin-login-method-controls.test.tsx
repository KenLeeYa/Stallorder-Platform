import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/components/locale-provider";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { AdminLoginMethodControls } from "@/components/admin-login-method-controls";

describe("platform login method controls", () => {
  it("shows effective login availability and disables unconfigured providers", () => {
    const html = renderToStaticMarkup(
      <LocaleProvider initialLocale="zh-TW" hasLocaleCookie>
        <AdminLoginMethodControls
          initialPasswordEnabled
          initialFoundationEnabled
          initialProviders={{ GOOGLE: true, LINE: false, APPLE: true, MICROSOFT: false }}
          configuredProviders={{ GOOGLE: true, LINE: false, APPLE: false, MICROSOFT: false }}
          readyForOAuthOnly={false}
        />
      </LocaleProvider>,
    );

    expect(html).toContain("登入方式控制");
    expect(html).toContain("電子郵件與密碼");
    expect(html).toContain("Google 登入");
    expect(html).toContain("Microsoft 登入");
    expect(html).toContain("Provider 憑證尚未設定");
    expect(html.match(/aria-checked="true"/g)).toHaveLength(2);
    expect(html.match(/disabled=""/g)).toHaveLength(3);
  });
});

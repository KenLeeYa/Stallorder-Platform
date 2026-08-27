import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "@/components/locale-provider";
import { LoginApplicationPrompt } from "@/components/login-application-prompt";
import { getLoginResponseMessageKey, LoginForm } from "@/components/login-form";

describe("localized login form", () => {
  it("renders all login controls from the shared English dictionary", () => {
    const html = renderToStaticMarkup(
      <LocaleProvider initialLocale="en" hasLocaleCookie>
        <LoginForm
          legacyGoogleEnabled={false}
          oauthOnly={false}
          oauthProviders={[{ provider: "GOOGLE", label: "Google" }]}
          oauthError="callback-failed"
        />
      </LocaleProvider>,
    );

    expect(html).toContain("Merchant sign-in");
    expect(html).toContain("Customer QR ordering does not require sign-in");
    expect(html).toContain("Continue with Google");
    expect(html).toContain("Other sign-in methods");
    expect(html).toContain("Sign in with email and password");
    expect(html).toContain("Third-party sign-in verification failed");
    expect(html).toContain("Email");
    expect(html).toContain("Password");
    expect(html).not.toContain("登入");
  });

  it("renders a distinct staff and kitchen sign-in entry", () => {
    const html = renderToStaticMarkup(
      <LocaleProvider initialLocale="zh-TW" hasLocaleCookie>
        <LoginForm
          audience="STAFF"
          legacyGoogleEnabled={false}
          oauthOnly={false}
          oauthProviders={[{ provider: "LINE", label: "LINE" }]}
        />
      </LocaleProvider>,
    );

    expect(html).toContain("員工登入");
    expect(html).toContain("供受邀的店員與廚房人員使用");
    expect(html).toContain("使用 LINE 登入");
    expect(html).not.toContain("商家登入");
  });

  it("renders the server-selected application link through the same provider", () => {
    const html = renderToStaticMarkup(
      <LocaleProvider initialLocale="vi" hasLocaleCookie>
        <LoginApplicationPrompt applicationUrl="/onboarding" />
      </LocaleProvider>,
    );

    expect(html).toContain("Bạn chưa có tài khoản chủ quán?");
    expect(html).toContain("Đăng ký bằng tài khoản đã xác minh");
    expect(html).toContain("href=\"/onboarding\"");
  });

  it("maps server response statuses to locale-safe client messages", () => {
    expect(getLoginResponseMessageKey(400)).toBe("login.error.invalidFormat");
    expect(getLoginResponseMessageKey(401)).toBe("login.error.invalidCredentials");
    expect(getLoginResponseMessageKey(403)).toBe("login.error.authUnavailable");
    expect(getLoginResponseMessageKey(429)).toBe("login.error.rateLimited");
    expect(getLoginResponseMessageKey(500)).toBe("login.error.generic");
  });

  it("renders four explicit local QA role buttons only when supplied by the server", () => {
    const accounts = [
      ["商家", "owner@stallorder.test"],
      ["店員", "staff@stallorder.test"],
      ["廚房", "kitchen@stallorder.test"],
      ["平台管理者", "platform.admin@stallorder.test"],
    ].map(([label, email]) => ({ label, email, password: "local-only" }));
    const withQuickLogin = renderToStaticMarkup(
      <LocaleProvider initialLocale="zh-TW" hasLocaleCookie>
        <LoginForm
          legacyGoogleEnabled={false}
          oauthOnly={false}
          oauthProviders={[]}
          localQaAccounts={accounts}
        />
      </LocaleProvider>,
    );
    const withoutQuickLogin = renderToStaticMarkup(
      <LocaleProvider initialLocale="zh-TW" hasLocaleCookie>
        <LoginForm legacyGoogleEnabled={false} oauthOnly={false} oauthProviders={[]} />
      </LocaleProvider>,
    );

    expect(withQuickLogin).toContain('data-testid="local-qa-login-grid"');
    accounts.forEach((account) => expect(withQuickLogin).toContain(account.label));
    expect(withoutQuickLogin).not.toContain('data-testid="local-qa-login-grid"');
  });
});

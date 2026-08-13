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

    expect(html).toContain("Sign in to StallOrder");
    expect(html).toContain("Continue with Google");
    expect(html).toContain("Other sign-in methods");
    expect(html).toContain("Sign in with email and password");
    expect(html).toContain("Third-party sign-in verification failed");
    expect(html).toContain("Email");
    expect(html).toContain("Password");
    expect(html).not.toContain("登入");
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
});

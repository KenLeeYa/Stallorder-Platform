import { describe, expect, it } from "vitest";
import { resolveOAuthLinkProfile } from "./oauth-linking";

describe("OAuth 帳號連結", () => {
  it("拒絕以電子郵件自動連結未綁定的密碼帳號", () => {
    const passwordProfile = { id: "profile-1", authUserId: null, passwordHash: "hash" };
    expect(() => resolveOAuthLinkProfile("google-1", null, passwordProfile)).toThrow("OAUTH_ACCOUNT_CONFLICT");
  });

  it("允許已由相同 OAuth 身分綁定的帳號", () => {
    const linkedProfile = { id: "profile-1", authUserId: "google-1", passwordHash: "hash" };
    expect(resolveOAuthLinkProfile("google-1", linkedProfile, linkedProfile)).toBe(linkedProfile);
  });

  it("允許沒有密碼的受邀帳號完成首次綁定", () => {
    const invitedProfile = { id: "profile-1", authUserId: null, passwordHash: null };
    expect(resolveOAuthLinkProfile("google-1", null, invitedProfile)).toBe(invitedProfile);
  });
});

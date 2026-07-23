import { describe, expect, it } from "vitest";
import { resolveOAuthLinkProfile } from "./oauth-linking";

describe("OAuth account linking", () => {
  it("rejects automatic linking to an existing password profile", () => {
    const passwordProfile = { id: "profile-1", authUserId: null, passwordHash: "hash" };
    expect(() => resolveOAuthLinkProfile("google-1", null, passwordProfile)).toThrow("OAUTH_ACCOUNT_CONFLICT");
  });

  it("allows an existing OAuth link to sign in", () => {
    const linkedProfile = { id: "profile-1", authUserId: "google-1", passwordHash: "hash" };
    expect(resolveOAuthLinkProfile("google-1", linkedProfile, linkedProfile)).toBe(linkedProfile);
  });

  it("allows an invited profile without a password to link", () => {
    const invitedProfile = { id: "profile-1", authUserId: null, passwordHash: null };
    expect(resolveOAuthLinkProfile("google-1", null, invitedProfile)).toBe(invitedProfile);
  });

  it("allows a password profile only through an explicit trusted bootstrap", () => {
    const passwordProfile = { id: "profile-1", authUserId: null, passwordHash: "hash" };
    expect(resolveOAuthLinkProfile("google-1", null, passwordProfile, {
      allowPasswordProfileLink: true,
    })).toBe(passwordProfile);
  });

  it("does not override a conflicting OAuth identity during bootstrap", () => {
    const conflictingProfile = { id: "profile-1", authUserId: "google-2", passwordHash: "hash" };
    expect(() => resolveOAuthLinkProfile("google-1", null, conflictingProfile, {
      allowPasswordProfileLink: true,
    })).toThrow("OAUTH_ACCOUNT_CONFLICT");
  });
});

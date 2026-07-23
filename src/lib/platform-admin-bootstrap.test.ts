import { describe, expect, it, vi } from "vitest";
import { isStagingPlatformAdminBootstrapEmail } from "./platform-admin-bootstrap";

vi.mock("server-only", () => ({}));

const staging = {
  configuredEmails: "owner@example.com, Admin@Example.com ",
  gitBranch: "staging",
  vercelEnvironment: "preview",
};

describe("staging platform admin bootstrap", () => {
  it("matches an exact normalized email on the staging preview branch", () => {
    expect(isStagingPlatformAdminBootstrapEmail(" admin@example.com ", staging)).toBe(true);
  });

  it("does not use substring or domain matches", () => {
    expect(isStagingPlatformAdminBootstrapEmail("notadmin@example.com", staging)).toBe(false);
    expect(isStagingPlatformAdminBootstrapEmail("admin@example.com.evil.test", staging)).toBe(false);
  });

  it("is disabled outside the staging preview branch", () => {
    expect(isStagingPlatformAdminBootstrapEmail("admin@example.com", {
      ...staging,
      vercelEnvironment: "production",
    })).toBe(false);
    expect(isStagingPlatformAdminBootstrapEmail("admin@example.com", {
      ...staging,
      gitBranch: "main",
    })).toBe(false);
  });
});

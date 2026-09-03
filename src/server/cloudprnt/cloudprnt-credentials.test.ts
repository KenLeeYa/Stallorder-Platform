import { describe, expect, it } from "vitest";
import {
  cloudPrntServerUrl,
  cloudPrntTokenHash,
  createCloudPrntCredential,
  rotateCloudPrntCredential,
  verifyCloudPrntRequest,
} from "./cloudprnt-credentials";

describe("CloudPRNT device credentials", () => {
  it("generates independent credentials while retaining only a fixed hash", () => {
    const first = createCloudPrntCredential();
    const second = createCloudPrntCredential();

    expect(first.deviceId).toMatch(/^PRN_[A-Za-z0-9_-]{16}$/u);
    expect(first.deviceToken).toMatch(/^cpt_v1_[A-Za-z0-9_-]{43}$/u);
    expect(first.deviceTokenHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.deviceTokenHash).toBe(cloudPrntTokenHash(first.deviceToken));
    expect(first.deviceId).not.toBe(second.deviceId);
    expect(first.deviceToken).not.toBe(second.deviceToken);
    expect(JSON.stringify({ deviceId: first.deviceId, tokenHash: first.deviceTokenHash }))
      .not.toContain(first.deviceToken);
  });

  it("accepts Star-compatible Basic authentication and rejects another device token", () => {
    const credential = createCloudPrntCredential();
    const url = `https://app.qidaigo.com/api/cloudprnt/v1/${credential.deviceId}`;
    const basic = new Request(url, {
      headers: {
        authorization: `Basic ${Buffer.from(`${credential.deviceId}:${credential.deviceToken}`).toString("base64")}`,
      },
    });
    const wrong = new Request(url, {
      headers: {
        authorization: `Basic ${Buffer.from(`${credential.deviceId}:cpt_v1_${"A".repeat(43)}`).toString("base64")}`,
      },
    });

    expect(verifyCloudPrntRequest(basic, credential.deviceId, credential.deviceTokenHash)).toBe(true);
    expect(verifyCloudPrntRequest(wrong, credential.deviceId, credential.deviceTokenHash)).toBe(false);
  });

  it("rotates only the secret so the configured Server URL remains stable", () => {
    const first = createCloudPrntCredential();
    const rotated = rotateCloudPrntCredential(first.deviceId);

    expect(rotated.deviceId).toBe(first.deviceId);
    expect(rotated.deviceToken).not.toBe(first.deviceToken);
    expect(rotated.deviceTokenHash).not.toBe(first.deviceTokenHash);
  });

  it("builds the deployed URL and refuses non-local cleartext origins", () => {
    expect(cloudPrntServerUrl("PRN_abcdefghijklmnop", {
      NODE_ENV: "production",
      APP_BASE_URL: "https://app.qidaigo.com/path",
    } as NodeJS.ProcessEnv)).toBe("https://app.qidaigo.com/api/cloudprnt/v1/PRN_abcdefghijklmnop");
    expect(() => cloudPrntServerUrl("PRN_abcdefghijklmnop", {
      NODE_ENV: "production",
      APP_BASE_URL: "http://app.qidaigo.com",
    } as NodeJS.ProcessEnv)).toThrow("CLOUDPRNT_APP_URL_HTTPS_REQUIRED");
  });
});

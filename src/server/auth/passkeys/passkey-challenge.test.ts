import { describe, expect, it, vi } from "vitest";
import {
  consumePasskeyChallenge,
  issuePasskeyChallenge,
} from "./passkey-challenge";

const profileId = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-08-23T08:00:00.000Z");

function database() {
  const record = {
    id: "22222222-2222-4222-8222-222222222222",
    profileId,
    purpose: "REGISTER",
    rpId: "preview.example.test",
    origin: "https://preview.example.test",
    expiresAt: new Date(now.getTime() + 300_000),
    consumedAt: null as Date | null,
  };
  return {
    record,
    database: {
      passkeyChallenge: {
        create: vi.fn().mockResolvedValue({ id: record.id, expiresAt: record.expiresAt }),
        findUnique: vi.fn().mockResolvedValue(record),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    },
  };
}

describe("Passkey challenge", () => {
  it("issues a short-lived challenge bound to the exact RP ID and origin", async () => {
    const fixture = database();
    const result = await issuePasskeyChallenge(profileId, "REGISTER", {
      database: fixture.database,
      environment: {
        NODE_ENV: "test",
        APP_BASE_URL: "https://preview.example.test",
        PASSKEY_PROVIDER_MODE: "mock",
      } as NodeJS.ProcessEnv,
      now: () => now,
      random: () => Buffer.alloc(32, 7),
    });

    expect(result).toMatchObject({
      rpId: "preview.example.test",
      origin: "https://preview.example.test",
      purpose: "REGISTER",
    });
    expect(fixture.database.passkeyChallenge.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ expiresAt: new Date(now.getTime() + 300_000) }),
    }));
  });

  it("consumes exactly once and rejects origin mismatch, expiry and replay", async () => {
    const fixture = database();
    const input = {
      profileId,
      challenge: "a".repeat(43),
      purpose: "REGISTER",
      rpId: fixture.record.rpId,
      origin: fixture.record.origin,
    } as const;
    await expect(consumePasskeyChallenge(input, {
      database: fixture.database,
      now: () => now,
    })).resolves.toMatchObject({ id: fixture.record.id });

    fixture.record.origin = "https://attacker.example";
    await expect(consumePasskeyChallenge(input, {
      database: fixture.database,
      now: () => now,
    })).rejects.toThrow("PASSKEY_CHALLENGE_CONTEXT_MISMATCH");

    fixture.record.origin = input.origin;
    fixture.record.expiresAt = now;
    await expect(consumePasskeyChallenge(input, {
      database: fixture.database,
      now: () => now,
    })).rejects.toThrow("PASSKEY_CHALLENGE_EXPIRED");

    fixture.record.expiresAt = new Date(now.getTime() + 1_000);
    fixture.record.consumedAt = now;
    await expect(consumePasskeyChallenge(input, {
      database: fixture.database,
      now: () => now,
    })).rejects.toThrow("PASSKEY_CHALLENGE_REPLAYED");
  });
});

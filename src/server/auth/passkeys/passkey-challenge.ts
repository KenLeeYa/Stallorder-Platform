import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getPasskeyRuntimeConfig } from "./passkey-config";

export const passkeyChallengePurposes = ["REGISTER", "AUTHENTICATE", "REAUTHENTICATE"] as const;
export type PasskeyChallengePurpose = (typeof passkeyChallengePurposes)[number];

const consumeSchema = z.object({
  profileId: z.string().uuid(),
  challenge: z.string().min(32).max(256).regex(/^[A-Za-z0-9_-]+$/),
  purpose: z.enum(passkeyChallengePurposes),
  rpId: z.string().min(1).max(253),
  origin: z.string().url().max(2048),
}).strict();

type ChallengeRecord = {
  id: string;
  profileId: string;
  purpose: string;
  rpId: string;
  origin: string;
  expiresAt: Date;
  consumedAt: Date | null;
};

type PasskeyChallengeDatabase = {
  passkeyChallenge: {
    create(input: {
      data: {
        profileId: string;
        challengeHash: string;
        purpose: PasskeyChallengePurpose;
        rpId: string;
        origin: string;
        expiresAt: Date;
      };
      select: { id: true; expiresAt: true };
    }): Promise<{ id: string; expiresAt: Date }>;
    findUnique(input: {
      where: { challengeHash: string };
      select: {
        id: true;
        profileId: true;
        purpose: true;
        rpId: true;
        origin: true;
        expiresAt: true;
        consumedAt: true;
      };
    }): Promise<ChallengeRecord | null>;
    updateMany(input: {
      where: { id: string; consumedAt: null; expiresAt: { gt: Date } };
      data: { consumedAt: Date };
    }): Promise<{ count: number }>;
  };
};

function hashChallenge(challenge: string) {
  return createHash("sha256").update(challenge, "utf8").digest("hex");
}

export function validatePasskeyChallengeRecord(
  record: ChallengeRecord | null,
  input: z.infer<typeof consumeSchema>,
  now: Date,
) {
  if (!record) throw new Error("PASSKEY_CHALLENGE_INVALID");
  if (record.consumedAt) throw new Error("PASSKEY_CHALLENGE_REPLAYED");
  if (record.expiresAt <= now) throw new Error("PASSKEY_CHALLENGE_EXPIRED");
  if (
    record.profileId !== input.profileId
    || record.purpose !== input.purpose
    || record.rpId !== input.rpId
    || record.origin !== input.origin
  ) {
    throw new Error("PASSKEY_CHALLENGE_CONTEXT_MISMATCH");
  }
}

export async function issuePasskeyChallenge(
  profileId: string,
  purpose: PasskeyChallengePurpose,
  dependencies: {
    database?: PasskeyChallengeDatabase;
    environment?: NodeJS.ProcessEnv;
    now?: () => Date;
    random?: () => Buffer;
  } = {},
) {
  const database = dependencies.database ?? prisma;
  const config = getPasskeyRuntimeConfig(dependencies.environment);
  const now = dependencies.now?.() ?? new Date();
  const challenge = (dependencies.random?.() ?? randomBytes(32)).toString("base64url");
  const expiresAt = new Date(now.getTime() + 5 * 60_000);
  const stored = await database.passkeyChallenge.create({
    data: {
      profileId,
      challengeHash: hashChallenge(challenge),
      purpose,
      rpId: config.rpId,
      origin: config.origin,
      expiresAt,
    },
    select: { id: true, expiresAt: true },
  });
  return {
    id: stored.id,
    challenge,
    purpose,
    rpId: config.rpId,
    origin: config.origin,
    expiresAt: stored.expiresAt.toISOString(),
  };
}

export async function consumePasskeyChallenge(
  rawInput: unknown,
  dependencies: {
    database?: PasskeyChallengeDatabase;
    now?: () => Date;
  } = {},
) {
  const input = consumeSchema.parse(rawInput);
  const database = dependencies.database ?? prisma;
  const now = dependencies.now?.() ?? new Date();
  const record = await database.passkeyChallenge.findUnique({
    where: { challengeHash: hashChallenge(input.challenge) },
    select: {
      id: true,
      profileId: true,
      purpose: true,
      rpId: true,
      origin: true,
      expiresAt: true,
      consumedAt: true,
    },
  });
  validatePasskeyChallengeRecord(record, input, now);
  const consumed = await database.passkeyChallenge.updateMany({
    where: { id: record!.id, consumedAt: null, expiresAt: { gt: now } },
    data: { consumedAt: now },
  });
  if (consumed.count !== 1) throw new Error("PASSKEY_CHALLENGE_REPLAYED");
  return { id: record!.id, consumedAt: now.toISOString() };
}

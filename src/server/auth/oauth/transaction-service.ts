import "server-only";

import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { sanitizeRedirectPath } from "@/lib/security";
import {
  createOAuthRandomValue,
  createPkceChallenge,
  createPkceVerifier,
  decryptOAuthValue,
  encryptOAuthValue,
  hashOAuthEvidence,
  requireOAuthStateSecret,
} from "./crypto";
import type { OAuthProvider } from "./types";

const sealedTransactionSchema = z.object({
  nonce: z.string().min(32).max(256),
  codeVerifier: z.string().min(43).max(256),
}).strict();

const OAUTH_TRANSACTION_TTL_MS = 10 * 60_000;

export async function createOAuthTransaction(input: {
  provider: OAuthProvider;
  redirectUri: string;
  returnTo?: string | null;
  currentProfileId?: string;
  invitationId?: string;
}) {
  const state = createOAuthRandomValue();
  const nonce = createOAuthRandomValue();
  const codeVerifier = createPkceVerifier();
  const secret = requireOAuthStateSecret();
  const expiresAt = new Date(Date.now() + OAUTH_TRANSACTION_TTL_MS);
  const transaction = await prisma.oAuthTransaction.create({
    data: {
      provider: input.provider,
      stateHash: hashOAuthEvidence(state),
      nonceHash: hashOAuthEvidence(nonce),
      codeVerifierCiphertext: encryptOAuthValue(
        JSON.stringify({ nonce, codeVerifier }),
        secret,
      ),
      redirectUri: input.redirectUri,
      returnTo: sanitizeRedirectPath(input.returnTo, "/"),
      linkMode: Boolean(input.currentProfileId || input.invitationId),
      currentProfileId: input.currentProfileId,
      invitationId: input.invitationId,
      expiresAt,
    },
    select: { id: true },
  });
  return {
    transactionId: transaction.id,
    state,
    nonce,
    codeChallenge: createPkceChallenge(codeVerifier),
    expiresAt,
  };
}

export type ClaimedOAuthTransaction =
  | {
      status: "CLAIMED";
      id: string;
      provider: OAuthProvider;
      redirectUri: string;
      returnTo: string;
      linkMode: boolean;
      currentProfileId: string | null;
      invitationId: string | null;
      nonce: string;
      codeVerifier: string;
    }
  | {
      status: "COMPLETED";
      id: string;
      returnTo: string;
      resultSessionId: string | null;
    };

export async function claimOAuthTransaction(input: {
  provider: OAuthProvider;
  state: string;
  authorizationCode: string;
  circuitSource?: "A" | "B";
}): Promise<ClaimedOAuthTransaction> {
  if (
    input.state.length < 32
    || input.state.length > 256
    || input.authorizationCode.length < 1
    || input.authorizationCode.length > 16_384
  ) {
    throw new Error("OAUTH_CALLBACK_INPUT_INVALID");
  }
  const stateHash = hashOAuthEvidence(input.state);
  const authorizationCodeHash = hashOAuthEvidence(input.authorizationCode);
  const existing = await prisma.oAuthTransaction.findUnique({
    where: { stateHash },
  });
  if (!existing || existing.provider !== input.provider) {
    throw new Error("OAUTH_TRANSACTION_NOT_FOUND");
  }
  if (existing.status === "CONSUMED") {
    return {
      status: "COMPLETED",
      id: existing.id,
      returnTo: existing.returnTo,
      resultSessionId: existing.resultSessionId,
    };
  }
  if (existing.expiresAt <= new Date()) {
    await prisma.oAuthTransaction.updateMany({
      where: { id: existing.id, status: "PENDING" },
      data: { status: "EXPIRED" },
    });
    throw new Error("OAUTH_TRANSACTION_EXPIRED");
  }
  if (existing.status !== "PENDING") throw new Error("OAUTH_CALLBACK_REPLAYED");

  try {
    const claimed = await prisma.oAuthTransaction.updateMany({
      where: {
        id: existing.id,
        status: "PENDING",
        authorizationCodeHash: null,
      },
      data: {
        status: "PROCESSING",
        authorizationCodeHash,
        circuitSource: input.circuitSource ?? "B",
      },
    });
    if (claimed.count !== 1) throw new Error("OAUTH_CALLBACK_REPLAYED");
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError
      && error.code === "P2002"
    ) {
      throw new Error("OAUTH_AUTHORIZATION_CODE_REPLAYED");
    }
    throw error;
  }

  let sealed: z.infer<typeof sealedTransactionSchema>;
  try {
    sealed = sealedTransactionSchema.parse(JSON.parse(
      decryptOAuthValue(existing.codeVerifierCiphertext, requireOAuthStateSecret()),
    ));
  } catch {
    await markOAuthTransactionFailed(existing.id);
    throw new Error("OAUTH_TRANSACTION_SECRET_INVALID");
  }
  if (hashOAuthEvidence(sealed.nonce) !== existing.nonceHash) {
    await markOAuthTransactionFailed(existing.id);
    throw new Error("OAUTH_TRANSACTION_NONCE_INVALID");
  }
  return {
    status: "CLAIMED",
    id: existing.id,
    provider: input.provider,
    redirectUri: existing.redirectUri,
    returnTo: existing.returnTo,
    linkMode: existing.linkMode,
    currentProfileId: existing.currentProfileId,
    invitationId: existing.invitationId,
    nonce: sealed.nonce,
    codeVerifier: sealed.codeVerifier,
  };
}

export async function markOAuthTransactionFailed(transactionId: string) {
  await prisma.oAuthTransaction.updateMany({
    where: { id: transactionId, status: "PROCESSING" },
    data: { status: "FAILED", consumedAt: new Date() },
  });
}

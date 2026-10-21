"use client";
import { createOptionalSupabaseBrowserClient } from "@/lib/supabase-browser";
import { csrfHeaders } from "@/lib/csrf-client";
import { commandBinding } from "@/server/compliance/governance-contracts";

export async function getComplianceStepUp(action: string, organizationId: string, command: unknown, code: string) {
  if (!/^\d{6}$/.test(code)) throw new Error("MFA_CODE_REQUIRED");
  const auth = createOptionalSupabaseBrowserClient();
  if (!auth) throw new Error("MFA_CONFIGURATION_REQUIRED");
  const factors = await auth.auth.mfa.listFactors();
  const factor = factors.data?.totp.find((entry) => entry.status === "verified");
  if (factors.error || !factor) throw new Error("MFA_ENROLLMENT_REQUIRED");
  const result = await auth.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (result.error || !result.data.access_token) throw new Error("MFA_PROOF_INVALID");
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(commandBinding(organizationId, command)));
  const contentDigest = Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
  const response = await fetch("/api/auth/step-up", { method: "POST", cache: "no-store", headers: csrfHeaders(),
    body: JSON.stringify({ token: result.data.access_token, action, contentDigest }) });
  if (!response.ok) throw new Error("STEP_UP_REQUIRED");
  return (await response.json()).grant as string;
}

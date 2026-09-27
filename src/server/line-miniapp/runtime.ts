import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { validateMiniAppBinding, type MiniAppBinding } from "./configuration";

export function readMiniAppBinding(environment: NodeJS.ProcessEnv = process.env): MiniAppBinding {
  if (environment.LINE_MINIAPP_ENABLED !== "true") throw new Error("LINE_MINIAPP_DISABLED");
  let value: unknown;
  try { value = JSON.parse(environment.LINE_MINIAPP_BINDING_JSON ?? ""); }
  catch { throw new Error("LINE_MINIAPP_CONFIGURATION_INVALID"); }
  const binding = validateMiniAppBinding(value);
  const deployment = environment.VERCEL_ENV === "production" ? "production"
    : environment.VERCEL_ENV === "preview" ? "preview"
      : environment.NODE_ENV === "development" || environment.NODE_ENV === "test" ? "local" : null;
  if (!deployment || binding.deployment !== deployment || new URL(binding.endpointUrl).pathname !== "/mini") {
    throw new Error("LINE_MINIAPP_ENVIRONMENT_MISMATCH");
  }
  return binding;
}

export function miniAppBindingFingerprint(binding: MiniAppBinding) {
  return createHash("sha256").update(JSON.stringify([
    binding.organizationId, binding.stallId, binding.providerId, binding.channelId,
    binding.liffId, binding.internalChannel, binding.endpointUrl, binding.deployment,
  ])).digest("hex");
}

export async function getMiniAppStall(binding: MiniAppBinding) {
  const stall = await prisma.stall.findFirst({
    where: { id: binding.stallId, organizationId: binding.organizationId, isActive: true },
    select: { id: true, name: true, slug: true },
  });
  if (!stall) throw new Error("LINE_MINIAPP_STALL_UNAVAILABLE");
  return stall;
}

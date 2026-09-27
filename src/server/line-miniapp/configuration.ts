import "server-only";
import { z } from "zod";

const bindingSchema = z.object({
  organizationId: z.string().uuid(),
  stallId: z.string().uuid(),
  providerId: z.string().regex(/^\d{1,30}$/),
  channelId: z.string().regex(/^\d{1,30}$/),
  liffId: z.string().regex(/^\d+-[A-Za-z0-9]+$/),
  internalChannel: z.enum(["developing", "review", "published"]),
  endpointUrl: z.string().url().max(500),
  deployment: z.enum(["local", "preview", "production"]),
}).strict();

export type MiniAppBinding = z.infer<typeof bindingSchema>;

/** Trusted server configuration, never a binding accepted from the exchange request. */
export function validateMiniAppBinding(value: unknown): MiniAppBinding {
  const binding = bindingSchema.parse(value);
  const endpoint = new URL(binding.endpointUrl);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error("LINE_MINIAPP_ENDPOINT_INVALID");
  }
  if ((binding.deployment === "production") !== (binding.internalChannel === "published")) {
    throw new Error("LINE_MINIAPP_ENVIRONMENT_MISMATCH");
  }
  return binding;
}

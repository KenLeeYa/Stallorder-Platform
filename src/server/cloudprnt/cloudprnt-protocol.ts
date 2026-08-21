import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const cloudPrntPollSchema = z.object({
  status: z.string().nullable().optional(),
  printerMAC: z.string().nullable().optional(),
  uniqueID: z.string().nullable().optional(),
  statusCode: z.string().min(1),
  jobToken: z.string().nullable().optional(),
  printingInProgress: z.boolean().nullable().optional(),
}).passthrough();

export type CloudPrntPoll = z.infer<typeof cloudPrntPollSchema>;

export function cloudPrntAuthState(request: Request, printerId: string) {
  const enabled = process.env.CLOUDPRNT_POC_ENABLED?.trim() === "true";
  const configuredPrinterId = process.env.CLOUDPRNT_POC_PRINTER_ID?.trim();
  const username = process.env.CLOUDPRNT_POC_BASIC_USERNAME?.trim();
  const password = process.env.CLOUDPRNT_POC_BASIC_PASSWORD?.trim();
  if (
    !enabled
    || !configuredPrinterId
    || !z.string().uuid().safeParse(configuredPrinterId).success
    || !username
    || !password
    || password.length < 16
  ) return "NOT_CONFIGURED" as const;
  if (!safeEqual(printerId.toLowerCase(), configuredPrinterId.toLowerCase())) {
    return "UNAUTHORIZED" as const;
  }

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Basic ")) return "UNAUTHORIZED" as const;
  let decoded = "";
  try {
    decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
  } catch {
    return "UNAUTHORIZED" as const;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return "UNAUTHORIZED" as const;
  const suppliedUsername = decoded.slice(0, separator);
  const suppliedPassword = decoded.slice(separator + 1);
  return safeEqual(suppliedUsername, username) && safeEqual(suppliedPassword, password)
    ? "AUTHORIZED" as const
    : "UNAUTHORIZED" as const;
}

export function decodeCloudPrntStatus(value: string) {
  try {
    return decodeURIComponent(value).replace(/\s+/g, " ").trim().slice(0, 200);
  } catch {
    return value.replace(/\s+/g, " ").trim().slice(0, 200);
  }
}

export function cloudPrntStatusSucceeded(value: string) {
  const status = decodeCloudPrntStatus(value);
  return status === "OK" || /^2\d{2}(?:\s|$)/.test(status);
}

export function cloudPrntJobToken(request: Request, bodyToken?: string | null) {
  const url = new URL(request.url);
  return bodyToken
    ?? url.searchParams.get("token")
    ?? request.headers.get("x-star-token");
}

export function cloudPrntPollResponse(jobId: string | null) {
  return jobId
    ? {
      jobReady: true,
      mediaTypes: ["text/plain"],
      jobToken: jobId,
      deleteMethod: "DELETE" as const,
    }
    : { jobReady: false };
}

export function cloudPrntRequestedMediaType(request: Request) {
  const requested = new URL(request.url).searchParams.get("type");
  if (!requested) return "text/plain";
  return requested.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function safeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

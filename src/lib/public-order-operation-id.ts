import { createWebUuid } from "@/lib/web-uuid";

export const PUBLIC_ORDER_OPERATION_ID_HEADER = "x-stallorder-operation-id";

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizePublicOrderOperationId(value: string | null | undefined) {
  const candidate = value?.trim();
  return candidate && UUID_V4_PATTERN.test(candidate) ? candidate.toLowerCase() : null;
}

export function createPublicOrderOperationId() {
  return createWebUuid();
}

export function getPublicOrderOperationId(request: Request) {
  return normalizePublicOrderOperationId(
    request.headers.get(PUBLIC_ORDER_OPERATION_ID_HEADER),
  ) ?? createPublicOrderOperationId();
}

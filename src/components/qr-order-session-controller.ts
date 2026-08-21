import {
  createPublicOrderOperationId,
  parseEdgeResponse,
  requestPublicOrder,
} from "@/lib/public-order-client";
import {
  shouldIncludeFullSessionMenu,
  shouldReloadResolvedSessionMenu,
  shouldRotateSessionRequestId,
} from "@/lib/public-order-session-retry";
import type { QrCartOrderingMode } from "@/lib/qr-cart";
import type { PublicMenu } from "@/lib/public-menu-types";
import { createWebUuid } from "@/lib/web-uuid";
import {
  ensureQrSessionIdentity,
  normalizeQrOrderSession,
  qrEntryAllowsOrderingMode,
  resolveQrCheckoutIdentity,
  restoreQrOrderSessionCart,
  usableQrInitialMenu,
  type QrCheckoutIdentity,
  type QrOrderEntryChannel,
  type QrOrderSession,
} from "./qr-order-flow-orchestration";

export type QrSessionTransportInput = {
  qrToken: string;
  deviceId: string;
  sessionRequestId: string;
  orderingMode: QrCartOrderingMode;
  includeMenu: boolean;
};

export type QrSessionTransport = (
  input: QrSessionTransportInput,
  operationId: string,
) => Promise<{
  ok: boolean;
  status: number;
  payload: Record<string, unknown>;
}>;

type QrOrderSessionControllerDependencies = {
  requestSession?: QrSessionTransport;
  createUuid?: () => string;
  createOperationId?: () => string;
};

export type QrOrderSessionStartInput = {
  qrToken: string;
  deviceId: string;
  activeOrderingMode: QrCartOrderingMode;
  entryChannel: QrOrderEntryChannel;
  initialMenu: PublicMenu | null;
  currentScheduledPickupAt: string;
  loadCartDraft?: (orderingMode: QrCartOrderingMode) => string | null;
  now?: number;
};

type QrOrderSessionResult =
  | {
      kind: "SESSION";
      attempt: number;
      session: QrOrderSession;
      cartRecovery: ReturnType<typeof restoreQrOrderSessionCart>;
    }
  | { kind: "RESUME"; attempt: number; trackingToken: string }
  | {
      kind: "FAILURE";
      attempt: number;
      reason: "EDGE" | "INVALID_RESUME" | "ENTRY_MODE" | "NETWORK";
      code: string;
      status: number | null;
    }
  | { kind: "STALE"; attempt: number };

export type QrOrderSessionController = {
  start(input: QrOrderSessionStartInput): Promise<QrOrderSessionResult>;
  isCurrentAttempt(attempt: number): boolean;
  sessionRequestId(): string | null;
  rotateSessionIdentity(): void;
  checkoutIdentity(fingerprint: string): QrCheckoutIdentity;
  clearCheckoutIdentity(): void;
};

const defaultRequestSession: QrSessionTransport = async (input, operationId) => {
  const response = await requestPublicOrder(
    "create-order-session",
    input,
    { operationId },
  );
  return {
    ok: response.ok,
    status: response.status,
    payload: await parseEdgeResponse(response),
  };
};

export function createQrOrderSessionController(
  dependencies: QrOrderSessionControllerDependencies = {},
): QrOrderSessionController {
  const requestSession = dependencies.requestSession ?? defaultRequestSession;
  const createUuid = dependencies.createUuid ?? createWebUuid;
  const createOperationId = dependencies.createOperationId ?? createPublicOrderOperationId;
  let sessionRequestId: string | null = null;
  let sessionOperationId: string | null = null;
  let attemptGeneration = 0;
  let currentCheckoutIdentity: QrCheckoutIdentity | null = null;

  const resetSessionIdentity = () => {
    sessionRequestId = null;
    sessionOperationId = null;
  };

  return {
    async start(input) {
      const attempt = ++attemptGeneration;
      try {
        const usableInitialMenu = usableQrInitialMenu(input.entryChannel, input.initialMenu);
        const identity = ensureQrSessionIdentity(
          sessionRequestId,
          sessionOperationId,
          createUuid,
          createOperationId,
        );
        sessionRequestId = identity.sessionRequestId;
        sessionOperationId = identity.operationId;
        const send = (includeMenu: boolean) => requestSession({
          qrToken: input.qrToken,
          deviceId: input.deviceId,
          sessionRequestId: identity.sessionRequestId,
          orderingMode: input.activeOrderingMode,
          includeMenu,
        }, identity.operationId);

        let response = await send(shouldIncludeFullSessionMenu(
          Boolean(usableInitialMenu),
          input.activeOrderingMode,
        ));
        if (attempt !== attemptGeneration) return { kind: "STALE", attempt };
        if (
          response.ok
          && usableInitialMenu
          && !(response.payload.resumeOrder && typeof response.payload.resumeOrder === "object")
          && shouldReloadResolvedSessionMenu(
            usableInitialMenu.orderingMode,
            response.payload.orderingMode,
          )
        ) {
          response = await send(true);
          if (attempt !== attemptGeneration) return { kind: "STALE", attempt };
        }

        if (!response.ok) {
          const code = String(response.payload.code ?? "");
          if (shouldRotateSessionRequestId(response.status, code)) resetSessionIdentity();
          return { kind: "FAILURE", attempt, reason: "EDGE", code, status: response.status };
        }
        if (response.payload.resumeOrder && typeof response.payload.resumeOrder === "object") {
          const trackingToken = String(
            (response.payload.resumeOrder as Record<string, unknown>).trackingToken ?? "",
          );
          return trackingToken
            ? { kind: "RESUME", attempt, trackingToken }
            : {
                kind: "FAILURE",
                attempt,
                reason: "INVALID_RESUME",
                code: "INVALID_RESUME_ORDER",
                status: null,
              };
        }

        const rawOrderSession = usableInitialMenu
          ? { ...usableInitialMenu, ...response.payload } as QrOrderSession
          : response.payload as unknown as QrOrderSession;
        const session = normalizeQrOrderSession(
          rawOrderSession,
          usableInitialMenu?.orderingMode ?? input.activeOrderingMode,
        );
        if (!qrEntryAllowsOrderingMode(input.entryChannel, session.orderingMode)) {
          return {
            kind: "FAILURE",
            attempt,
            reason: "ENTRY_MODE",
            code: "QR_NOT_ACTIVE",
            status: null,
          };
        }

        let rawCartDraft: string | null = null;
        try {
          rawCartDraft = input.loadCartDraft?.(session.orderingMode) ?? null;
        } catch {
          // Restricted browser storage must not block ordering.
        }
        return {
          kind: "SESSION",
          attempt,
          session,
          cartRecovery: restoreQrOrderSessionCart({
            raw: rawCartDraft,
            session,
            currentScheduledPickupAt: input.currentScheduledPickupAt,
            now: input.now,
          }),
        };
      } catch {
        return attempt === attemptGeneration
          ? { kind: "FAILURE", attempt, reason: "NETWORK", code: "", status: null }
          : { kind: "STALE", attempt };
      }
    },
    isCurrentAttempt(attempt) {
      return attempt === attemptGeneration;
    },
    sessionRequestId() {
      return sessionRequestId;
    },
    rotateSessionIdentity() {
      sessionRequestId = createUuid();
      sessionOperationId = createOperationId();
    },
    checkoutIdentity(fingerprint) {
      currentCheckoutIdentity = resolveQrCheckoutIdentity(
        currentCheckoutIdentity,
        fingerprint,
        createUuid,
        createOperationId,
      );
      return currentCheckoutIdentity;
    },
    clearCheckoutIdentity() {
      currentCheckoutIdentity = null;
    },
  };
}

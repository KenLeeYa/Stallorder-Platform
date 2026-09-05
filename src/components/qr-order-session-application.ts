import type { QrOrderSessionController } from "@/components/qr-order-session-controller";
import { localizedDeliveryOrderError } from "@/lib/delivery-order-i18n";
import type { PublicAvailabilityStatus } from "@/lib/public-order-client";
import {
  localizedPublicOrderError,
  preserveSupportedQrLocale,
  qrOrderMessages,
  type QrLocale,
} from "@/lib/qr-order-i18n";
import { sessionCountdownPhase } from "@/lib/session-countdown";

type QrOrderSessionResult = Awaited<ReturnType<QrOrderSessionController["start"]>>;
type AvailabilityStatus = PublicAvailabilityStatus | "CHECKING";

export type QrOrderSessionTransition =
  | { kind: "STALE" }
  | { kind: "RESUME"; trackingToken: string }
  | {
      kind: "FAILURE";
      availability: PublicAvailabilityStatus | null;
      message: string;
    }
  | {
      kind: "SESSION";
      session: Extract<QrOrderSessionResult, { kind: "SESSION" }>["session"];
      cartRecovery: Extract<QrOrderSessionResult, { kind: "SESSION" }>["cartRecovery"];
      locale: QrLocale;
      sessionTimePhase: ReturnType<typeof sessionCountdownPhase>;
      availability: "AVAILABLE" | null;
      resetPreorderLottery: boolean;
    };

export function resolveQrOrderSessionTransition({
  result,
  browserLocale,
  currentLocale,
  hasUsableInitialMenu,
  currentAvailability,
  now,
}: {
  result: QrOrderSessionResult;
  browserLocale: QrLocale;
  currentLocale: QrLocale;
  hasUsableInitialMenu: boolean;
  currentAvailability: AvailabilityStatus;
  now?: number;
}): QrOrderSessionTransition {
  if (result.kind === "STALE") return { kind: "STALE" };
  if (result.kind === "RESUME") {
    return { kind: "RESUME", trackingToken: result.trackingToken };
  }
  if (result.kind === "FAILURE") {
    return {
      kind: "FAILURE",
      availability: failureAvailability(
        result.code,
        hasUsableInitialMenu,
        currentAvailability,
      ),
      message: result.reason === "NETWORK"
        ? qrOrderMessages[browserLocale].networkError
        : result.reason === "INVALID_RESUME"
          ? qrOrderMessages[browserLocale].sessionStartError
          : localizedDeliveryOrderError(browserLocale, result.code)
            ?? localizedPublicOrderError(browserLocale, result.code),
    };
  }

  return {
    kind: "SESSION",
    session: result.session,
    cartRecovery: result.cartRecovery,
    locale: preserveSupportedQrLocale(currentLocale, result.session.supportedLocales),
    sessionTimePhase: sessionCountdownPhase(result.session.expiresAt, now),
    // A successfully issued order session is the freshest authoritative proof that
    // public ordering is reachable. It must win over an earlier failed availability
    // probe, otherwise a slow first load can leave a valid session falsely disabled.
    availability: "AVAILABLE",
    resetPreorderLottery: result.session.orderingMode === "PREORDER",
  };
}

function failureAvailability(
  code: string,
  hasUsableInitialMenu: boolean,
  currentAvailability: AvailabilityStatus,
): PublicAvailabilityStatus | null {
  if (code === "QR_ORDERING_DEGRADED") return "DEGRADED";
  if (code === "QR_ORDERING_UNAVAILABLE") return "UNAVAILABLE";
  if (
    hasUsableInitialMenu
    && (
      currentAvailability === "CHECKING"
      || currentAvailability === "AVAILABLE"
      || currentAvailability === "UNKNOWN"
    )
  ) {
    return "UNAVAILABLE";
  }
  return null;
}

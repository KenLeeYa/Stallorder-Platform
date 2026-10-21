const STAR_WEBPRNT_ENDPOINT = "http://localhost:8001/StarWebPRNT/SendMessage";
const MAX_STAR_PRNT_BYTES = 64 * 1024;
export const STAR_WEBPRNT_SDK_LOAD_TIMEOUT_MS = 8_000;

export type StarWebPrntEnvironment = "STAR_WEBPRNT" | "IOS_SAFARI" | "OTHER";
export type StarWebPrntErrorCode =
  | "NOT_STAR_BROWSER"
  | "SDK_NOT_READY"
  | "INVALID_PAYLOAD"
  | "PRINT_REJECTED"
  | "PRINTER_BUSY"
  | "BRIDGE_UNRESPONSIVE"
  | "PAPER_END"
  | "COVER_OPEN"
  | "OFFLINE"
  | "CUTTER_ERROR"
  | "ROLL_POSITION_ERROR"
  | "HIGH_TEMPERATURE"
  | "NON_RECOVERABLE"
  | "TIMEOUT"
  | "CONNECTION_ERROR"
  | "INVALID_RESPONSE";

type StarWebPrntResponse = {
  traderSuccess: string | boolean;
  traderCode?: string;
  traderStatus?: string;
  status?: number;
};

type StarWebPrntStatus = {
  paperEnd?: boolean;
  coverOpen?: boolean;
  offline?: boolean;
  cutterError?: boolean;
  rollPositionError?: boolean;
  highTemperature?: boolean;
  nonRecoverable?: boolean;
};

type StarWebPrintTrader = {
  onReceive: ((response: StarWebPrntResponse) => void) | null;
  onError: ((response: { status?: number }) => void) | null;
  onTimeout: (() => void) | null;
  sendMessage(input: { request: string; timeout: number }): void;
  isPaperEnd(response: StarWebPrntResponse): boolean;
  isCoverOpen(response: StarWebPrntResponse): boolean;
  isOffLine(response: StarWebPrntResponse): boolean;
  isAutoCutterError(response: StarWebPrntResponse): boolean;
  isRollPositionError(response: StarWebPrntResponse): boolean;
  isHighTemperatureStop(response: StarWebPrntResponse): boolean;
  isNonRecoverableError(response: StarWebPrntResponse): boolean;
};

type StarWebPrintTraderConstructor = new (options: {
  url: string;
  timeout: number;
}) => StarWebPrintTrader;

declare global {
  interface Window {
    StarWebPrintTrader?: StarWebPrintTraderConstructor;
  }
}

export class StarWebPrntError extends Error {
  readonly diagnostics: { traderCode?: string; traderStatus?: string; httpStatus?: number };

  constructor(public readonly code: StarWebPrntErrorCode, response?: Partial<StarWebPrntResponse>) {
    super(code);
    this.name = "StarWebPrntError";
    // Only protocol codes: never retain response text, receipt data or device credentials.
    this.diagnostics = {
      ...(typeof response?.traderCode === "string" && /^\d{1,8}$/.test(response.traderCode)
        ? { traderCode: response.traderCode } : {}),
      ...(typeof response?.traderStatus === "string" && /^[\da-f]{16}$/i.test(response.traderStatus)
        ? { traderStatus: response.traderStatus } : {}),
      ...(typeof response?.status === "number" && Number.isInteger(response.status) && response.status >= 0 && response.status <= 599
        ? { httpStatus: response.status } : {}),
    };
  }
}

export function withStarWebPrntDiagnostics(message: string, error: unknown) {
  if (!(error instanceof StarWebPrntError)) return message;
  const details = Object.entries(error.diagnostics).map(([key, value]) => `${key}=${value}`);
  return `${message} [${[error.code, ...details].join("; ")}]`;
}

export function detectStarWebPrntEnvironment(userAgent: string): StarWebPrntEnvironment {
  if (/StarWebPRNTBrowser\/\d|webPRNTSupportMessageHandler/i.test(userAgent)) return "STAR_WEBPRNT";
  if (/\b(iPad|iPhone|iPod)\b/i.test(userAgent)
      || (/\bMacintosh\b/i.test(userAgent) && /\bMobile\//i.test(userAgent))) {
    return "IOS_SAFARI";
  }
  return "OTHER";
}

export function isStarWebPrntSdkReady(
  scope: { StarWebPrintTrader?: unknown } | undefined = typeof window === "undefined" ? undefined : window,
) {
  return typeof scope?.StarWebPrintTrader === "function";
}

export function buildStarWebPrntRequest(dataBase64: string) {
  const validBase64 = dataBase64.length > 0
    && dataBase64.length % 4 === 0
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(dataBase64);
  const padding = dataBase64.endsWith("==") ? 2 : dataBase64.endsWith("=") ? 1 : 0;
  const decodedBytes = validBase64 ? (dataBase64.length / 4) * 3 - padding : 0;
  if (!validBase64 || decodedBytes > MAX_STAR_PRNT_BYTES) {
    throw new StarWebPrntError("INVALID_PAYLOAD");
  }
  return `<rawdata>${dataBase64}</rawdata>`;
}

export function classifyStarWebPrntResponse(
  response: Pick<StarWebPrntResponse, "traderSuccess" | "traderCode">,
  status: StarWebPrntStatus,
): StarWebPrntErrorCode | null {
  if (status.paperEnd) return "PAPER_END";
  if (status.coverOpen) return "COVER_OPEN";
  if (status.cutterError) return "CUTTER_ERROR";
  if (status.rollPositionError) return "ROLL_POSITION_ERROR";
  if (status.highTemperature) return "HIGH_TEMPERATURE";
  if (status.nonRecoverable) return "NON_RECOVERABLE";
  if (status.offline || response.traderCode === "1100") return "OFFLINE";
  if (response.traderCode === "2001") return "PRINTER_BUSY";
  if (String(response.traderSuccess).toLowerCase() !== "true") return "PRINT_REJECTED";
  return null;
}

export function starWebPrntLaunchUrl(target: string) {
  const url = new URL(target);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new StarWebPrntError("NOT_STAR_BROWSER");
  }
  url.username = "";
  url.password = "";
  return `webprnt://starmicronics.com/open?url=${encodeURIComponent(url.toString())}`;
}

export async function printWithStarWebPrnt(dataBase64: string, timeout = 30_000) {
  return sendStarWebPrntRequest(buildStarWebPrntRequest(dataBase64), timeout);
}

export async function probeStarWebPrnt(timeout = 5_000) {
  return sendStarWebPrntRequest('<text encoding="utf-8"></text>', timeout);
}

export async function openStarCashDrawer(timeout = 10_000) {
  return sendStarWebPrntRequest('<peripheral channel="1" on="200" off="200"></peripheral>', timeout);
}

// Star's iOS bridge has one callback slot per URL and no native timeout.
// Serialize callers, and never reuse that slot after an ambiguous timeout until
// the actual callback arrives (or the page is reloaded). No ticket is replayed.
const bridgeStates = new WeakMap<Window, { active: Promise<StarWebPrntResponse> | null; quarantined: boolean }>();

async function sendStarWebPrntRequest(request: string, timeout: number) {
  if (typeof window === "undefined"
    || detectStarWebPrntEnvironment(window.navigator.userAgent) !== "STAR_WEBPRNT") {
    throw new StarWebPrntError("NOT_STAR_BROWSER");
  }
  const Trader = window.StarWebPrintTrader;
  if (!Trader) throw new StarWebPrntError("SDK_NOT_READY");
  if (!request) throw new StarWebPrntError("INVALID_PAYLOAD");
  let bridge = bridgeStates.get(window);
  if (!bridge) {
    bridge = { active: null, quarantined: false };
    bridgeStates.set(window, bridge);
  }
  while (bridge.active) await bridge.active.catch(() => undefined);
  if (bridge.quarantined) throw new StarWebPrntError("BRIDGE_UNRESPONSIVE");
  const state = bridge;

  const pending = new Promise<StarWebPrntResponse>((resolve, reject) => {
    let settled = false;
    let sendStarted = false;
    const timer = setTimeout(() => {
      state.quarantined = true;
      finish(() => reject(new StarWebPrntError("TIMEOUT")));
    }, timeout);
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      operation();
    };

    try {
      const trader = new Trader({ url: STAR_WEBPRNT_ENDPOINT, timeout });
      trader.onReceive = (response) => {
        state.quarantined = false;
        try {
          const errorCode = classifyStarWebPrntResponse(response, {
            paperEnd: trader.isPaperEnd(response),
            coverOpen: trader.isCoverOpen(response),
            offline: trader.isOffLine(response),
            cutterError: trader.isAutoCutterError(response),
            rollPositionError: trader.isRollPositionError(response),
            highTemperature: trader.isHighTemperatureStop(response),
            nonRecoverable: trader.isNonRecoverableError(response),
          });
          finish(() => errorCode
            ? reject(new StarWebPrntError(errorCode, response))
            : resolve(response));
        } catch {
          finish(() => reject(new StarWebPrntError("INVALID_RESPONSE", response)));
        }
      };
      trader.onError = (response) => {
        state.quarantined = false;
        finish(() => reject(new StarWebPrntError("CONNECTION_ERROR", response)));
      };
      trader.onTimeout = () => {
        state.quarantined = true;
        finish(() => reject(new StarWebPrntError("TIMEOUT")));
      };
      sendStarted = true;
      trader.sendMessage({ request, timeout });
    } catch (error) {
      if (sendStarted) state.quarantined = true;
      finish(() => reject(error instanceof StarWebPrntError
        ? error
        : new StarWebPrntError("CONNECTION_ERROR")));
    }
  });
  state.active = pending;
  try {
    return await pending;
  } finally {
    if (state.active === pending) state.active = null;
  }
}

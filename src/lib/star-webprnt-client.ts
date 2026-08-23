const STAR_WEBPRNT_ENDPOINT = "http://localhost:8001/StarWebPRNT/SendMessage";
const MAX_STAR_PRNT_BYTES = 64 * 1024;

export type StarWebPrntEnvironment = "STAR_WEBPRNT" | "IOS_SAFARI" | "OTHER";
export type StarWebPrntErrorCode =
  | "NOT_STAR_BROWSER"
  | "SDK_NOT_READY"
  | "INVALID_PAYLOAD"
  | "PRINT_REJECTED"
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
  traderSuccess: string;
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
  constructor(public readonly code: StarWebPrntErrorCode) {
    super(code);
    this.name = "StarWebPrntError";
  }
}

export function detectStarWebPrntEnvironment(userAgent: string): StarWebPrntEnvironment {
  if (/StarWebPRNTBrowser\/\d|webPRNTSupportMessageHandler/i.test(userAgent)) return "STAR_WEBPRNT";
  if (/\b(iPad|iPhone|iPod)\b/i.test(userAgent)
      || (/\bMacintosh\b/i.test(userAgent) && /\bMobile\//i.test(userAgent))) {
    return "IOS_SAFARI";
  }
  return "OTHER";
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
  response: Pick<StarWebPrntResponse, "traderSuccess">,
  status: StarWebPrntStatus,
): StarWebPrntErrorCode | null {
  if (response.traderSuccess.toLowerCase() !== "true") return "PRINT_REJECTED";
  if (status.paperEnd) return "PAPER_END";
  if (status.coverOpen) return "COVER_OPEN";
  if (status.offline) return "OFFLINE";
  if (status.cutterError) return "CUTTER_ERROR";
  if (status.rollPositionError) return "ROLL_POSITION_ERROR";
  if (status.highTemperature) return "HIGH_TEMPERATURE";
  if (status.nonRecoverable) return "NON_RECOVERABLE";
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

async function sendStarWebPrntRequest(request: string, timeout: number) {
  if (typeof window === "undefined"
    || detectStarWebPrntEnvironment(window.navigator.userAgent) !== "STAR_WEBPRNT") {
    throw new StarWebPrntError("NOT_STAR_BROWSER");
  }
  const Trader = window.StarWebPrintTrader;
  if (!Trader) throw new StarWebPrntError("SDK_NOT_READY");
  if (!request) throw new StarWebPrntError("INVALID_PAYLOAD");

  return new Promise<StarWebPrntResponse>((resolve, reject) => {
    let settled = false;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      operation();
    };

    try {
      const trader = new Trader({ url: STAR_WEBPRNT_ENDPOINT, timeout });
      trader.onReceive = (response) => {
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
            ? reject(new StarWebPrntError(errorCode))
            : resolve(response));
        } catch {
          finish(() => reject(new StarWebPrntError("INVALID_RESPONSE")));
        }
      };
      trader.onError = () => finish(() => reject(new StarWebPrntError("CONNECTION_ERROR")));
      trader.onTimeout = () => finish(() => reject(new StarWebPrntError("TIMEOUT")));
      trader.sendMessage({ request, timeout });
    } catch (error) {
      finish(() => reject(error instanceof StarWebPrntError
        ? error
        : new StarWebPrntError("CONNECTION_ERROR")));
    }
  });
}

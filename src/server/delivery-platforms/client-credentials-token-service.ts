import { z } from "zod";
import { BoundedTextReadError, readBoundedText } from "./bounded-text-reader";
import { DeliveryPlatformError } from "./delivery-platform-errors";

const tokenResponseSchema = z.object({
  access_token: z.string().min(1).max(16_384),
  expires_in: z.number().int().min(60).max(366 * 24 * 60 * 60),
  token_type: z.string().max(40).optional(),
}).passthrough();

type Fetch = typeof fetch;

type TokenServiceOptions = {
  clientId: string;
  resolveClientSecret: () => string;
  tokenUrl: URL;
  scope?: string;
  refreshSkewSeconds: number;
  timeoutMs?: number;
  fetchImpl?: Fetch;
  now?: () => number;
};

type CachedToken = {
  value: string;
  expiresAtMs: number;
};

export class ClientCredentialsTokenService {
  private readonly fetchImpl: Fetch;
  private readonly now: () => number;
  private cached: CachedToken | null = null;
  private inFlight: Promise<CachedToken> | null = null;

  constructor(private readonly options: TokenServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async getAccessToken(forceRefresh = false) {
    if (!forceRefresh && this.hasUsableToken(this.cached)) return this.cached.value;
    if (this.inFlight) return (await this.inFlight).value;
    this.inFlight = this.requestToken();
    try {
      const token = await this.inFlight;
      this.cached = token;
      return token.value;
    } finally {
      this.inFlight = null;
    }
  }

  invalidate(accessToken?: string) {
    if (!accessToken || this.cached?.value === accessToken) this.cached = null;
  }

  private hasUsableToken(token: CachedToken | null): token is CachedToken {
    return Boolean(
      token
      && token.expiresAtMs - this.options.refreshSkewSeconds * 1000 > this.now(),
    );
  }

  private async requestToken(): Promise<CachedToken> {
    const body = new URLSearchParams({
      client_id: this.options.clientId,
      client_secret: this.options.resolveClientSecret(),
      grant_type: "client_credentials",
      ...(this.options.scope ? { scope: this.options.scope } : {}),
    });
    let response: Response;
    try {
      response = await this.fetchImpl(this.options.tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 8_000),
      });
    } catch {
      throw new DeliveryPlatformError("PROVIDER_TIMEOUT", { retryable: true });
    }
    if (!response.ok) throw tokenHttpError(response.status);
    let text: string;
    try {
      text = await readBoundedText(response, 32_768);
    } catch (error) {
      if (error instanceof BoundedTextReadError && error.reason === "READ_FAILED") {
        throw new DeliveryPlatformError("RETRYABLE_PROVIDER_ERROR", { retryable: true });
      }
      throw new DeliveryPlatformError("PROVIDER_CONTRACT_ERROR", { retryable: false });
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(text);
    } catch {
      throw new DeliveryPlatformError("PROVIDER_CONTRACT_ERROR", { retryable: false });
    }
    const parsed = tokenResponseSchema.safeParse(decoded);
    if (!parsed.success || parsed.data.token_type?.toLowerCase() === "basic") {
      throw new DeliveryPlatformError("PROVIDER_CONTRACT_ERROR", { retryable: false });
    }
    return {
      value: parsed.data.access_token,
      expiresAtMs: this.now() + parsed.data.expires_in * 1000,
    };
  }
}

function tokenHttpError(status: number) {
  if (status === 400 || status === 401 || status === 403) {
    return new DeliveryPlatformError("INVALID_CREDENTIALS", { retryable: false });
  }
  if (status === 429 || status >= 500) {
    return new DeliveryPlatformError("RETRYABLE_PROVIDER_ERROR", { retryable: true });
  }
  return new DeliveryPlatformError("PROVIDER_CONTRACT_ERROR", { retryable: false });
}

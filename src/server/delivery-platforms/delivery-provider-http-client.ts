import { BoundedTextReadError, readBoundedText } from "./bounded-text-reader";
import { DeliveryPlatformError } from "./delivery-platform-errors";

type Fetch = typeof fetch;

export type DeliveryAccessTokenProvider = {
  getAccessToken(forceRefresh?: boolean): Promise<string>;
  invalidate(accessToken?: string): void;
};

type RequestInput = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  expectedStatuses?: readonly number[];
};

export class DeliveryProviderHttpClient {
  private readonly fetchImpl: Fetch;

  constructor(private readonly options: {
    baseUrl: URL;
    tokenProvider: DeliveryAccessTokenProvider;
    timeoutMs?: number;
    maxResponseBytes?: number;
    fetchImpl?: Fetch;
  }) {
    if (options.baseUrl.pathname !== "/" || options.baseUrl.search || options.baseUrl.hash) {
      throw new DeliveryPlatformError("INVALID_CREDENTIALS", { retryable: false });
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async requestJson(input: RequestInput): Promise<unknown> {
    const url = this.resolvePath(input.path);
    let token = await this.options.tokenProvider.getAccessToken();
    let response = await this.send(url, input, token);
    if (response.status === 401) {
      this.options.tokenProvider.invalidate(token);
      token = await this.options.tokenProvider.getAccessToken(true);
      response = await this.send(url, input, token);
    }
    const expectedStatuses = input.expectedStatuses ?? [200];
    if (!expectedStatuses.includes(response.status)) throw providerHttpError(response.status);
    if (response.status === 204) return null;
    let text: string;
    try {
      text = await readBoundedText(
        response,
        this.options.maxResponseBytes ?? 2_000_000,
      );
    } catch (error) {
      if (error instanceof BoundedTextReadError && error.reason === "READ_FAILED") {
        throw new DeliveryPlatformError("RETRYABLE_PROVIDER_ERROR", { retryable: true });
      }
      throw new DeliveryPlatformError("PROVIDER_CONTRACT_ERROR", { retryable: false });
    }
    if (text.length === 0) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new DeliveryPlatformError("PROVIDER_CONTRACT_ERROR", { retryable: false });
    }
  }

  private resolvePath(path: string) {
    if (!path.startsWith("/") || path.startsWith("//")) {
      throw new DeliveryPlatformError("PROVIDER_CONTRACT_ERROR", { retryable: false });
    }
    const url = new URL(path, this.options.baseUrl);
    if (url.origin !== this.options.baseUrl.origin) {
      throw new DeliveryPlatformError("PROVIDER_CONTRACT_ERROR", { retryable: false });
    }
    return url;
  }

  private async send(url: URL, input: RequestInput, accessToken: string) {
    try {
      return await this.fetchImpl(url, {
        method: input.method,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${accessToken}`,
          ...(input.body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
      });
    } catch {
      throw new DeliveryPlatformError("PROVIDER_TIMEOUT", { retryable: true });
    }
  }
}

function providerHttpError(status: number) {
  if (status === 401) {
    return new DeliveryPlatformError("INVALID_CREDENTIALS", { retryable: false });
  }
  if (status === 403) {
    return new DeliveryPlatformError("PERMISSION_DENIED", { retryable: false });
  }
  if (status === 404) {
    return new DeliveryPlatformError("PROVIDER_RESOURCE_NOT_FOUND", { retryable: false });
  }
  if (status === 409) {
    return new DeliveryPlatformError("CONNECTION_STATE_CONFLICT", { retryable: false });
  }
  if (status === 429 || status >= 500) {
    return new DeliveryPlatformError("RETRYABLE_PROVIDER_ERROR", { retryable: true });
  }
  if (status >= 400) {
    return new DeliveryPlatformError("UNSUPPORTED_MAPPING", { retryable: false });
  }
  return new DeliveryPlatformError("PROVIDER_CONTRACT_ERROR", { retryable: false });
}

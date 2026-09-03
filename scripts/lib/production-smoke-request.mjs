const defaultSleep = (milliseconds) => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

export async function fetchWithTransientRetry({
  label,
  url,
  options = {},
  fetchImpl = fetch,
  maxAttempts = 2,
  timeoutMs = 15_000,
  retryDelayMs = 1_000,
  sleep = defaultSleep,
  log = console.warn,
}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetchImpl(url, {
        ...options,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const errorName = error instanceof Error ? error.name : "UnknownError";
      const retryable = isTransientFetchError(error) && attempt < maxAttempts;
      if (!retryable) {
        throw new Error(
          `Smoke request "${label}" failed after ${attempt} attempt${attempt === 1 ? "" : "s"} (${errorName}).`,
          { cause: error },
        );
      }
      log(`RETRY: ${label} - transient ${errorName} (attempt ${attempt}/${maxAttempts})`);
      await sleep(retryDelayMs);
    }
  }

  throw new Error(`Smoke request "${label}" exhausted its retry budget.`);
}

function isTransientFetchError(error) {
  return error instanceof TypeError
    || (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name));
}

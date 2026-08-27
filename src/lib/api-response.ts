export async function readApiJson<T>(response: Response, fallbackMessage: string): Promise<T> {
  const body = await response.text();
  if (body.trim()) {
    try {
      return JSON.parse(body) as T;
    } catch {
      // Fall through to the stable user-facing API error below.
    }
  }

  const requestId = response.headers.get("x-request-id")?.trim();
  const details = requestId
    ? `HTTP ${response.status}，追蹤編號 ${requestId}`
    : `HTTP ${response.status}`;
  throw new Error(`${fallbackMessage}（${details}）`);
}

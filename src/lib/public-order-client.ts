const DEVICE_COOKIE = "stallorder_device";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getOrCreateDeviceId() {
  const existing = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${DEVICE_COOKIE}=`))
    ?.slice(DEVICE_COOKIE.length + 1);

  if (existing) {
    const decoded = decodeURIComponent(existing);
    if (UUID_PATTERN.test(decoded)) return decoded;
  }

  const deviceId = crypto.randomUUID();
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${DEVICE_COOKIE}=${encodeURIComponent(deviceId)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  return deviceId;
}

export function publicEdgeUrl(functionName: string) {
  const functionsUrl = process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL?.trim().replace(/\/$/, "");
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (functionsUrl && publishableKey) return `${functionsUrl}/${functionName}`;
  return `/api/public-order/${functionName}`;
}

export function publicEdgeHeaders(): Record<string, string> {
  const functionsUrl = process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!functionsUrl || !publishableKey) return {};
  return {
    apikey: publishableKey,
    authorization: `Bearer ${publishableKey}`,
  };
}

export async function parseEdgeResponse(response: Response) {
  const payload = await response.json().catch(() => ({ error: "伺服器回應格式不正確。" }));
  return payload as Record<string, unknown>;
}

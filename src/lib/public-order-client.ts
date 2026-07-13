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
  const configured = process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL
    || "http://127.0.0.1:54321/functions/v1";
  return `${configured.replace(/\/$/, "")}/${functionName}`;
}

export async function parseEdgeResponse(response: Response) {
  const payload = await response.json().catch(() => ({ error: "伺服器回應格式不正確。" }));
  return payload as Record<string, unknown>;
}

const MAX_DEVICE_LABEL_LENGTH = 120;

export function getRequestDeviceLabel(request: Request) {
  return describeUserAgent(request.headers.get("user-agent"));
}

export function describeUserAgent(userAgent: string | null | undefined) {
  const value = userAgent?.trim();
  if (!value) return "Unknown browser";

  const device = detectDevice(value);
  const browser = detectBrowser(value);
  return `${device} · ${browser}`.slice(0, MAX_DEVICE_LABEL_LENGTH);
}

function detectDevice(userAgent: string) {
  if (/iPad/i.test(userAgent) || (/Macintosh/i.test(userAgent) && /Mobile\//i.test(userAgent))) {
    return "iPad";
  }
  if (/iPhone/i.test(userAgent)) return "iPhone";
  if (/Android/i.test(userAgent)) return /Mobile/i.test(userAgent) ? "Android phone" : "Android tablet";
  if (/CrOS/i.test(userAgent)) return "Chromebook";
  if (/Windows/i.test(userAgent)) return "Windows";
  if (/Macintosh|Mac OS X/i.test(userAgent)) return "Mac";
  if (/Linux/i.test(userAgent)) return "Linux";
  return "Device";
}

function detectBrowser(userAgent: string) {
  if (/EdgiOS|EdgA|Edg\//i.test(userAgent)) return "Edge";
  if (/OPiOS|OPR\//i.test(userAgent)) return "Opera";
  if (/CriOS|Chrome\//i.test(userAgent)) return "Chrome";
  if (/FxiOS|Firefox\//i.test(userAgent)) return "Firefox";
  if (/Version\/[\d.]+.*Safari\//i.test(userAgent) || /AppleWebKit/i.test(userAgent) && /Mobile\//i.test(userAgent)) {
    return "Safari";
  }
  return "Browser";
}

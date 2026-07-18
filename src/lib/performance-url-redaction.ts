const sensitivePathPatterns = [
  { pattern: /^\/q\/[^/]+/, replacement: "/q/:qrToken" },
  { pattern: /^\/order\/[^/]+/, replacement: "/order/:trackingToken" },
  { pattern: /^\/invite\/[^/]+/, replacement: "/invite/:invitationToken" },
];

export function redactPerformanceUrl(value: string) {
  try {
    const url = new URL(value);
    for (const { pattern, replacement } of sensitivePathPatterns) {
      if (pattern.test(url.pathname)) {
        url.pathname = url.pathname.replace(pattern, replacement);
        break;
      }
    }
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

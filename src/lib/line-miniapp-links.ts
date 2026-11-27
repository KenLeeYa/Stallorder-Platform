const publicQueryValues: Record<string, readonly string[]> = {
  view: ["menu", "pickup", "delivery"],
  locale: ["zh-TW", "en", "ja", "ko", "vi", "th"],
};

function assertPublicStorePath(path: string, query: URLSearchParams) {
  if (!/^\/store\/[A-Za-z0-9_-]+$/.test(path)) throw new Error("LINE_MINIAPP_PUBLIC_PATH_INVALID");
  for (const [key, value] of query) {
    if (!publicQueryValues[key]?.includes(value) || query.getAll(key).length !== 1) {
      throw new Error("LINE_MINIAPP_PRIVATE_LINK_REJECTED");
    }
  }
}

/** Only public storefront links may be shared; order credentials are never copied. */
export function buildMiniAppPublicLink(input: { liffId: string; endpointUrl: string; pageUrl: string }) {
  if (!/^\d+-[A-Za-z0-9]+$/.test(input.liffId)) throw new Error("LINE_MINIAPP_LIFF_ID_INVALID");
  if (/[\\%]/.test(input.pageUrl)) throw new Error("LINE_MINIAPP_PUBLIC_PATH_INVALID");
  const endpoint = new URL(input.endpointUrl);
  const page = new URL(input.pageUrl);
  const basePath = endpoint.pathname.replace(/\/$/, "");
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || page.origin !== endpoint.origin || page.username || page.password || page.hash
    || !page.pathname.startsWith(`${basePath}/`)) throw new Error("LINE_MINIAPP_ENDPOINT_MISMATCH");
  const relativePath = page.pathname.slice(basePath.length);
  assertPublicStorePath(relativePath, page.searchParams);
  return `https://miniapp.line.me/${input.liffId}${relativePath}${page.search}`;
}

export function safeMiniAppReturnPath(value: string) {
  if (!value.startsWith("/mini/") || /[\\%#\s]/.test(value) || value.includes("..")) return "/mini";
  try {
    const url = new URL(value, "https://return.invalid");
    if (!url.search && (/^\/mini\/(orders|member|help)$/.test(url.pathname)
      || /^\/mini\/orders\/[0-9a-f-]{36}$/i.test(url.pathname))) return url.pathname;
    assertPublicStorePath(url.pathname.slice("/mini".length), url.searchParams);
    return url.pathname + url.search;
  } catch {
    return "/mini";
  }
}

/** Private deep links carry only an identifier; the destination always requires ownership. */
export function buildMiniAppOrderLink(liffId: string, orderId: string) {
  if (!/^\d+-[A-Za-z0-9]+$/.test(liffId) || !/^[0-9a-f-]{36}$/i.test(orderId)) throw new Error("LINE_MINIAPP_LINK_INVALID");
  return `https://miniapp.line.me/${liffId}/orders/${orderId}`;
}

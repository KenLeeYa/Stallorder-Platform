export function isExpectedPublicSiteResponse({ status, contentType, body }) {
  return status === 200
    && contentType?.toLowerCase().includes("text/html")
    && /StallOrder|攤點通/u.test(body);
}

export function isExpectedCanonicalRedirect({
  status,
  location,
  sourceUrl,
  canonicalUrl,
}) {
  if (![301, 308].includes(status) || !location) return false;

  try {
    const source = new URL(sourceUrl);
    const canonical = new URL(canonicalUrl);
    const target = new URL(location, sourceUrl);
    return source.protocol === "https:"
      && canonical.protocol === "https:"
      && target.protocol === "https:"
      && target.href === canonical.href;
  } catch {
    return false;
  }
}

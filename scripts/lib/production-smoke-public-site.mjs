export function isExpectedPublicSiteResponse({ status, contentType, body }) {
  return status === 200
    && contentType?.toLowerCase().includes("text/html")
    && /StallOrder|攤點通/u.test(body);
}

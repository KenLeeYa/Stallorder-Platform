export function resolveProductionTestQrUrl({
  baseUrl,
  configuredUrl,
  required = false,
}) {
  const value = configuredUrl?.trim();
  if (!value) {
    if (required) {
      throw new Error("PRODUCTION_TEST_QR_URL is required for Production Apply.");
    }
    return null;
  }

  const resolvedBaseUrl = new URL(baseUrl);
  const resolvedQrUrl = new URL(value, resolvedBaseUrl);
  if (resolvedQrUrl.origin !== resolvedBaseUrl.origin) {
    throw new Error("PRODUCTION_TEST_QR_URL must use the Production application origin.");
  }
  if (!/^\/q\/[A-Za-z0-9_-]{24,200}\/?$/u.test(resolvedQrUrl.pathname)) {
    throw new Error("PRODUCTION_TEST_QR_URL must use the /q/<token> route.");
  }

  return resolvedQrUrl;
}

export function productionTestQrToken(resolvedQrUrl) {
  const match = resolvedQrUrl.pathname.match(/^\/q\/([A-Za-z0-9_-]{24,200})\/?$/u);
  if (!match) {
    throw new Error("PRODUCTION_TEST_QR_URL must use the /q/<token> route.");
  }
  return match[1];
}

export function isInvoiceDevMode(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.VERCEL_ENV?.trim().toLowerCase() === "production") return false;
  const appEnvironment = environment.APP_ENV?.trim().toLowerCase();
  if (appEnvironment === "production") return false;
  const explicitlyEnabled = environment.EINVOICE_DEV_MODE?.trim().toLowerCase() === "true";
  if (environment.NODE_ENV === "production" && !["development", "local", "test"].includes(appEnvironment ?? "")) {
    return false;
  }
  return explicitlyEnabled || environment.EINVOICE_DEV_MODE?.trim().toLowerCase() !== "false";
}

export function assertInvoiceMockEnvironment(environment: NodeJS.ProcessEnv = process.env) {
  if (!isInvoiceDevMode(environment)) throw new Error("EINVOICE_MOCK_FORBIDDEN");
}

export function assertInvoiceProductionIssueDisabled(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.EINVOICE_PRODUCTION_ISSUE_ENABLED?.trim().toLowerCase() === "true") {
    throw new Error("EINVOICE_PRODUCTION_REQUIRES_VERIFIED_RELEASE_GATE");
  }
}

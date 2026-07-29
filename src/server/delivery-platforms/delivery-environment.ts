export function isProductionDeliveryRuntime(
  environment: NodeJS.ProcessEnv = process.env,
) {
  if (environment.VERCEL_ENV === "preview" || environment.VERCEL_ENV === "development") {
    return false;
  }
  return environment.VERCEL_ENV === "production"
    || environment.NODE_ENV === "production";
}

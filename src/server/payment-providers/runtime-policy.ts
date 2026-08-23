export function assertPaymentMockEnvironment(environment: NodeJS.ProcessEnv = process.env) {
  const vercelEnvironment = environment.VERCEL_ENV?.trim().toLowerCase();
  if (
    vercelEnvironment === "production"
    || (environment.NODE_ENV === "production" && vercelEnvironment !== "preview")
  ) {
    throw new Error("PAYMENT_MOCK_FORBIDDEN");
  }
}

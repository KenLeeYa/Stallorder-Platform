import "server-only";

type BootstrapEnvironment = {
  configuredEmails?: string;
  gitBranch?: string;
  vercelEnvironment?: string;
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function isStagingPlatformAdminBootstrapEmail(
  email: string,
  environment: BootstrapEnvironment = {
    configuredEmails: process.env.STAGING_PLATFORM_ADMIN_BOOTSTRAP_EMAILS,
    gitBranch: process.env.VERCEL_GIT_COMMIT_REF,
    vercelEnvironment: process.env.VERCEL_ENV,
  },
) {
  if (
    environment.vercelEnvironment !== "preview"
    || environment.gitBranch !== "staging"
  ) {
    return false;
  }

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return false;

  return (environment.configuredEmails ?? "")
    .split(",")
    .map(normalizeEmail)
    .filter(Boolean)
    .includes(normalizedEmail);
}

"use client";

import { useAppLocale } from "@/components/locale-provider";

export function LoginApplicationPrompt({ applicationUrl }: { applicationUrl: string | null }) {
  const { t } = useAppLocale();

  return (
    <div className="mt-4 max-w-md text-center text-xs leading-5 text-stone-600">
      <p>
        {t("login.application.prompt")}{" "}
        {applicationUrl ? (
          <a href={applicationUrl} className="inline-flex min-h-11 items-center rounded-sm font-semibold text-teal-800 underline decoration-teal-300 underline-offset-4 hover:decoration-teal-700">
            {t("login.application.apply")}
          </a>
        ) : (
          <span className="font-semibold text-stone-500">{t("login.application.unavailable")}</span>
        )}
      </p>
      <p className="mt-1 text-xs leading-4 text-stone-600">
        {t("login.application.description")}
      </p>
    </div>
  );
}

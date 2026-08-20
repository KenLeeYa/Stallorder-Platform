"use client";

import { useAppLocale } from "@/components/locale-provider";

export function LoginApplicationPrompt({ applicationUrl }: { applicationUrl: string | null }) {
  const { t } = useAppLocale();

  return (
    <div className="mt-5 max-w-md text-center text-sm text-stone-600">
      <p>
        {t("login.application.prompt")}{" "}
        {applicationUrl ? (
          <a href={applicationUrl} className="font-semibold text-teal-800">
            {t("login.application.apply")}
          </a>
        ) : (
          <span className="font-semibold text-stone-500">{t("login.application.unavailable")}</span>
        )}
      </p>
      <p className="mt-2 text-xs text-stone-500">
        {t("login.application.description")}
      </p>
    </div>
  );
}

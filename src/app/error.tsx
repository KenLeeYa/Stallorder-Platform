"use client";

import { useEffect } from "react";
import { useAppLocale } from "@/components/locale-provider";
import { reportClientException } from "@/lib/client-exception-reporting";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useAppLocale();
  useEffect(() => {
    reportClientException({ type: "REACT_BOUNDARY", error, digest: error.digest });
  }, [error]);

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-stone-950/65 p-4">
      <main role="alertdialog" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl">
        <h1 className="text-2xl font-bold text-stone-950">{t("error.title")}</h1>
        <p className="mt-3 text-sm leading-6 text-stone-600">{t("error.description")}</p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-md bg-teal-700 px-5 font-semibold text-white hover:bg-teal-800"
        >
          {t("error.retry")}
        </button>
      </main>
    </div>
  );
}

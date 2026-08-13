"use client";

import { useAppLocale } from "@/components/locale-provider";

export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useAppLocale();

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-xl flex-col items-center justify-center px-4 py-12 text-center">
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
  );
}

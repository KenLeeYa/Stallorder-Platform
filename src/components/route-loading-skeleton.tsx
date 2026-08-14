"use client";

import { useAppLocale } from "@/components/locale-provider";

type Props = { variant: "menu" | "orders" | "dashboard" | "reports" };

export function RouteLoadingSkeleton({ variant }: Props) {
  const { t } = useAppLocale();
  const columns = variant === "orders"
    ? "md:grid-cols-3"
    : variant === "dashboard"
      ? "md:grid-cols-4"
      : "md:grid-cols-2";
  const itemCount = variant === "dashboard" ? 8 : 6;

  return (
    <main aria-busy="true" className="mx-auto min-h-screen w-full max-w-6xl px-4 py-6 md:px-8">
      <span className="sr-only">{t("route.loading")}</span>
      <div className="h-4 w-28 animate-pulse rounded bg-stone-200" />
      <div className="mt-3 h-9 w-full max-w-sm animate-pulse rounded bg-stone-200" />
      <div className="mt-3 h-4 w-full max-w-xl animate-pulse rounded bg-stone-100" />
      <div className={`mt-7 grid gap-4 ${columns}`}>
        {Array.from({ length: itemCount }, (_, index) => (
          <div key={index} className="min-h-32 animate-pulse border-y border-stone-200 py-4">
            <div className="h-4 w-2/3 rounded bg-stone-200" />
            <div className="mt-4 h-3 w-full rounded bg-stone-100" />
            <div className="mt-2 h-3 w-4/5 rounded bg-stone-100" />
            <div className="mt-5 h-8 w-24 rounded bg-stone-200" />
          </div>
        ))}
      </div>
    </main>
  );
}

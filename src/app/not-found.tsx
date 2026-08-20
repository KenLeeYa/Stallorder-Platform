import Link from "next/link";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { getAppMessage } from "@/lib/app-messages";

export default async function NotFound() {
  const { locale } = await getRequestAppLocale();

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-xl flex-col items-center justify-center px-4 py-12 text-center">
      <h1 className="text-2xl font-bold text-stone-950">
        {getAppMessage(locale, "notFound.title")}
      </h1>
      <p className="mt-3 text-sm leading-6 text-stone-600">
        {getAppMessage(locale, "notFound.description")}
      </p>
      <Link
        href="/launch"
        className="mt-6 inline-flex min-h-11 items-center justify-center rounded-md bg-teal-700 px-5 font-semibold text-white hover:bg-teal-800"
      >
        {getAppMessage(locale, "notFound.home")}
      </Link>
    </main>
  );
}

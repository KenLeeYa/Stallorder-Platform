import { notFound, redirect } from "next/navigation";
import { getPagePrincipal } from "@/lib/auth";
import { localLinePreviewAllowed } from "@/lib/local-line-preview";
import { LocalLinePreview } from "@/components/local-line-preview";
import "@/app/mini/mini.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "攤點通 LINE 本機模擬", robots: { index: false, follow: false } };
export default async function LocalLinePage() {
  if (!localLinePreviewAllowed({ APP_ENV: process.env.APP_ENV, VERCEL_ENV: process.env.VERCEL_ENV, VERCEL: process.env.VERCEL, DATABASE_URL: process.env.DATABASE_URL, RESPONSIVE_QA_RUN: process.env.RESPONSIVE_QA_RUN, APP_BASE_URL: process.env.APP_BASE_URL })) notFound();
  if (!await getPagePrincipal()) redirect("/login?next=%2Flocal-qa%2Fline");
  return <LocalLinePreview />;
}

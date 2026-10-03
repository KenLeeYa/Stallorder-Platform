"use client";

import { useRef, useState } from "react";
import { ExperienceDialog } from "@/components/experience-dialog";
import { managementExperienceMessage as experience } from "@/lib/messages/management-experience";
import { workspaceNavigationMessage } from "@/lib/messages/workspace-navigation";
import { Download } from "lucide-react";
import { useAppLocale } from "@/components/locale-provider";
import { csrfHeaders } from "@/lib/csrf-client";
import { createReportTranslator } from "@/lib/messages/reports";

export function ReportExportButton({
  organizationId,
  stallIds,
  dateFrom,
  dateTo,
}: {
  organizationId: string;
  stallIds: string[];
  dateFrom: string;
  dateTo: string;
}) {
  const { locale } = useAppLocale();
  const t = createReportTranslator(locale);
  const [confirming, setConfirming] = useState(false);
  const inFlight = useRef(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  async function exportReport() {
    if (inFlight.current) return;
    inFlight.current = true;
    setConfirming(false);
    setExporting(true);
    setError("");
    try {
      const response = await fetch("/api/merchant/reports/export", {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify({ organizationId, stallIds, dateFrom, dateTo }),
      });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error ?? t("reports.export.error"));
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? "stallorder-report.csv";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : t("reports.export.error"));
    } finally {
      inFlight.current = false;
      setExporting(false);
    }
  }

  return (
    <div className="shrink-0">
      <button
        type="button"
        title={t("reports.export.action")}
        aria-label={t("reports.export.action")}
        disabled={exporting}
        onClick={() => setConfirming(true)}
        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-2 text-sm font-semibold disabled:opacity-50 sm:px-4"
      >
        <Download className="h-4 w-4" />
        <span className="sr-only sm:not-sr-only">{exporting ? t("reports.export.progress") : t("reports.export.action")}</span>
      </button>
      <ExperienceDialog open={confirming} onClose={() => setConfirming(false)} title={t("reports.export.action")} closeLabel={workspaceNavigationMessage(locale, "close")}>
        <p className="text-sm text-stone-600">{experience(locale, "export")}</p>
        <p className="my-4 font-semibold tabular-nums">{dateFrom} – {dateTo}</p>
        <button type="button" onClick={() => void exportReport()} className="min-h-11 w-full rounded-lg bg-teal-800 px-4 font-semibold text-white">{t("reports.export.action")}</button>
      </ExperienceDialog>
      {error ? <p role="alert" className="mt-2 text-xs text-red-700">{error}</p> : null}
    </div>
  );
}

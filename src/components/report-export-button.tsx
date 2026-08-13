"use client";

import { useState } from "react";
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
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  async function exportReport() {
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
      setExporting(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        disabled={exporting}
        onClick={() => void exportReport()}
        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-4 text-sm font-semibold disabled:opacity-50"
      >
        <Download className="h-4 w-4" />
        {exporting ? t("reports.export.progress") : t("reports.export.action")}
      </button>
      {error ? <p role="alert" className="mt-2 text-xs text-red-700">{error}</p> : null}
    </div>
  );
}

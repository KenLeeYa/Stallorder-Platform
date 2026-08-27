"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { ReportScheduleManager } from "@/components/report-schedule-manager";

const ReportScheduleManagerChunk = dynamic(
  () => import("@/components/report-schedule-manager").then((module) => module.ReportScheduleManager),
  { loading: () => <div className="min-h-[40vh] animate-pulse bg-stone-100" aria-busy="true" /> },
);

export function LazyReportScheduleManager(props: ComponentProps<typeof ReportScheduleManager>) {
  return <ReportScheduleManagerChunk {...props} />;
}

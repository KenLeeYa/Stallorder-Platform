"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { redactPerformanceUrl } from "@/lib/performance-url-redaction";

export function VercelPerformanceMonitoring() {
  return (
    <>
      <Analytics beforeSend={(event: BeforeSendEvent) => ({
        ...event,
        url: redactPerformanceUrl(event.url),
      })} />
      <SpeedInsights beforeSend={(event) => ({
        ...event,
        url: redactPerformanceUrl(event.url),
      })} />
    </>
  );
}

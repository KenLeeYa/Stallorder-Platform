"use client";

import { useEffect } from "react";
import { reportClientException } from "@/lib/client-exception-reporting";

export function ClientExceptionReporter() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      reportClientException({ type: "WINDOW_ERROR", error: event.error });
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      reportClientException({ type: "UNHANDLED_REJECTION", error: event.reason });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);
  return null;
}

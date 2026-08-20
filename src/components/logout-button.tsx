"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { useAppLocale } from "@/components/locale-provider";
import { SessionKeepAlive } from "@/components/session-keep-alive";
import { csrfHeaders } from "@/lib/csrf-client";

export function LogoutButton({ offlineStallId }: { offlineStallId?: string } = {}) {
  const router = useRouter();
  const { t } = useAppLocale();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function logout() {
    if (offlineStallId) {
      const { getOfflineQueueSummary } = await import("@/offline/offline-operations");
      const summary = await getOfflineQueueSummary(offlineStallId).catch(() => null);
      if ((summary?.pendingCount ?? 0) > 0) {
        window.alert(t("logout.offlinePending", { count: summary?.pendingCount ?? 0 }));
        return;
      }
    }
    setIsSubmitting(true);
    const response = await fetch("/api/auth/logout", { method: "POST", headers: csrfHeaders() });
    if (response.ok) {
      router.push("/login");
      router.refresh();
      return;
    }
    setIsSubmitting(false);
  }

  const label = isSubmitting ? t("logout.progress") : t("logout.action");

  return (<>
    <SessionKeepAlive />
    <button
      type="button"
      onClick={logout}
      disabled={isSubmitting}
      title={label}
      aria-label={label}
      className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-stone-300 bg-white disabled:opacity-50"
    >
      <LogOut aria-hidden="true" className="h-4 w-4" />
      <span className="sr-only">{label}</span>
    </button>
  </>);
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";

export function LogoutButton({ offlineStallId }: { offlineStallId?: string } = {}) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function logout() {
    if (offlineStallId) {
      const { getOfflineQueueSummary } = await import("@/offline/offline-operations");
      const summary = await getOfflineQueueSummary(offlineStallId).catch(() => null);
      if ((summary?.pendingCount ?? 0) > 0) {
        window.alert(`尚有 ${summary?.pendingCount} 筆離線資料未同步，為避免資料遺失，目前不可登出。`);
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

  return (
    <button
      type="button"
      onClick={logout}
      disabled={isSubmitting}
      title="登出"
      className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-stone-300 bg-white disabled:opacity-50"
    >
      <LogOut className="h-4 w-4" />
      <span className="sr-only">登出</span>
    </button>
  );
}

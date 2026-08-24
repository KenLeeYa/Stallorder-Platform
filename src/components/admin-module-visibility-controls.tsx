"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Truck, WalletCards } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { getAdminApiError } from "@/lib/messages/admin";
import { useAdminLocale } from "@/lib/messages/admin-client";

const modules = [
  { key: "payments", code: "PAYMENTS_ADMIN_UI_ENABLED", label: "Payment and payment-flow screens", icon: WalletCards },
  { key: "delivery", code: "DELIVERY_PLATFORM_UI_ENABLED", label: "Delivery integration screens", icon: Truck },
] as const;

export function AdminModuleVisibilityControls({ initialVisibility }: {
  initialVisibility: { payments: boolean; delivery: boolean };
}) {
  const { locale, m } = useAdminLocale();
  const router = useRouter();
  const [visibility, setVisibility] = useState(initialVisibility);
  const [updating, setUpdating] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  async function toggle(module: (typeof modules)[number]) {
    const enabled = !visibility[module.key];
    if (!window.confirm(m("This change affects navigation and direct page access immediately. Continue?"))) return;
    setUpdating(module.key);
    setNotice("");
    try {
      const response = await fetch(`/api/admin/resilience/feature-flags/${module.code}`, {
        method: "PUT",
        headers: csrfHeaders(),
        body: JSON.stringify({
          scopeType: "GLOBAL",
          organizationId: null,
          stallId: null,
          deviceId: null,
          enabled,
          rolloutPercentage: null,
          expiresAt: null,
          reason: "平台管理員調整未完成模組的介面曝光狀態",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(getAdminApiError(locale, payload));
      setVisibility((current) => ({ ...current, [module.key]: enabled }));
      setNotice(m("Module visibility updated."));
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : m("Operation failed. Try again later."));
    } finally {
      setUpdating(null);
    }
  }

  return (
    <section className="border-t border-stone-200 py-6" aria-label={m("Module visibility")}>
      <h2 className="text-xl font-semibold">{m("Module visibility")}</h2>
      <p className="mt-1 text-sm leading-6 text-stone-600">{m("Keep unfinished modules hidden until their provider, security, and acceptance gates are complete. Visibility does not enable transaction execution.")}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {modules.map((module) => {
          const Icon = module.icon;
          const enabled = visibility[module.key];
          return (
            <article key={module.key} className="rounded-md border border-stone-200 bg-white p-4">
              <div className="flex items-center justify-between gap-4">
                <h3 className="flex items-center gap-2 font-semibold"><Icon aria-hidden="true" className="h-4 w-4 text-teal-700" />{m(module.label)}</h3>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  aria-label={m(module.label)}
                  disabled={updating !== null}
                  onClick={() => void toggle(module)}
                  className={`relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50 ${enabled ? "bg-teal-700" : "bg-stone-300"}`}
                >
                  <span className={`absolute left-1 top-1 h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${enabled ? "translate-x-6" : "translate-x-0"}`} />
                </button>
              </div>
              <p className={`mt-3 text-sm font-semibold ${enabled ? "text-teal-800" : "text-stone-500"}`}>{updating === module.key ? "…" : enabled ? m("Visible") : m("Hidden")}</p>
            </article>
          );
        })}
      </div>
      {notice ? <p role="status" className="mt-4 text-sm font-medium text-stone-700">{notice}</p> : null}
    </section>
  );
}

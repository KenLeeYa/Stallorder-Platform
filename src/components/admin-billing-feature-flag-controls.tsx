"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { csrfHeaders } from "@/lib/csrf-client";
import { getAdminApiError } from "@/lib/messages/admin";
import { useAdminLocale } from "@/lib/messages/admin-client";

type ManagedFlagCode =
  | "OPEN_BETA_FREE_ACCESS_ENABLED"
  | "MERCHANT_BILLING_VISIBLE";

type Flag = {
  code: string;
  isEnabled: boolean;
};

const controls: Array<{
  code: ManagedFlagCode;
  label: "Open beta free access" | "Show subscriptions and payments to merchants";
  description:
    | "When enabled, merchants can use the system without subscription expiry or feature restrictions. Usage remains recorded, but no bill can be closed automatically."
    | "When disabled, merchant navigation, subscription pages, payment pages, and their direct URLs are hidden. Platform administrators can still prepare billing settings.";
}> = [
  {
    code: "OPEN_BETA_FREE_ACCESS_ENABLED",
    label: "Open beta free access",
    description: "When enabled, merchants can use the system without subscription expiry or feature restrictions. Usage remains recorded, but no bill can be closed automatically.",
  },
  {
    code: "MERCHANT_BILLING_VISIBLE",
    label: "Show subscriptions and payments to merchants",
    description: "When disabled, merchant navigation, subscription pages, payment pages, and their direct URLs are hidden. Platform administrators can still prepare billing settings.",
  },
];

export function AdminBillingFeatureFlagControls({ flags }: { flags: Flag[] }) {
  const { locale, m } = useAdminLocale();
  const router = useRouter();
  const [values, setValues] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(flags.map((flag) => [flag.code, flag.isEnabled])),
  );
  const [updating, setUpdating] = useState<ManagedFlagCode | null>(null);
  const [notice, setNotice] = useState("");

  async function toggle(code: ManagedFlagCode) {
    const nextValue = !values[code];
    if (!window.confirm(m("This change takes effect immediately and will be written to the audit log. Continue?"))) return;

    setUpdating(code);
    setNotice("");
    try {
      const response = await fetch(`/api/admin/billing/feature-flags/${code}`, {
        method: "PUT",
        headers: csrfHeaders(),
        body: JSON.stringify({
          isEnabled: nextValue,
          reason: "平台管理員由帳務發布控制介面切換",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(getAdminApiError(locale, payload));
      setValues((current) => ({ ...current, [code]: nextValue }));
      setNotice(m("Billing release control updated."));
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : m("Operation failed. Try again later."));
    } finally {
      setUpdating(null);
    }
  }

  return (
    <section className="mt-6 rounded-md border border-teal-200 bg-teal-50/50 p-4 sm:p-5">
      <h2 className="text-xl font-semibold">{m("Merchant billing release controls")}</h2>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {controls.map((control) => {
          const enabled = values[control.code] ?? false;
          const busy = updating === control.code;
          return (
            <article key={control.code} className="rounded-md border border-stone-200 bg-white p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-semibold">{m(control.label)}</h3>
                  <p className="mt-2 text-sm leading-6 text-stone-600">{m(control.description)}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  aria-label={m(control.label)}
                  disabled={Boolean(updating)}
                  onClick={() => void toggle(control.code)}
                  className={`relative mt-0.5 h-8 w-14 shrink-0 rounded-full transition-colors disabled:cursor-wait disabled:opacity-60 ${enabled ? "bg-teal-700" : "bg-stone-300"}`}
                >
                  <span className={`absolute left-1 top-1 h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${enabled ? "translate-x-6" : "translate-x-0"}`} />
                </button>
              </div>
              <p className={`mt-3 text-sm font-semibold ${enabled ? "text-teal-800" : "text-stone-500"}`}>
                {busy ? m("Updating...") : m(enabled ? "Enabled" : "Disabled")}
              </p>
            </article>
          );
        })}
      </div>
      {notice ? <p role="status" className="mt-4 border-t border-teal-200 pt-3 text-sm font-medium">{notice}</p> : null}
    </section>
  );
}

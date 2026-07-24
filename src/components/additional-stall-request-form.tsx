"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";

export function AdditionalStallRequestForm({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(formData: FormData) {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/merchant/organizations/${organizationId}/billing/additional-stall-requests`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify({ quantity: Number(formData.get("quantity")), reason: formData.get("reason") }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "目前無法送出額外攤位申請。");
      setMessage("額外攤位申請已送出，需由平台管理員核准並計入帳單。");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法送出額外攤位申請。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="border-t border-stone-200 pt-6">
      <h2 className="text-xl font-semibold">申請額外攤位</h2>
      <form action={submit} className="mt-4 grid gap-3 sm:grid-cols-[120px_minmax(220px,1fr)_auto] sm:items-end">
        <label className="text-sm font-medium">數量<input name="quantity" type="number" min="1" max="100" defaultValue="1" required className="mt-1 h-11 w-full rounded-md border border-stone-300 px-3" /></label>
        <label className="text-sm font-medium">原因<input type="text" name="reason" minLength={2} maxLength={500} defaultValue="營運擴充申請" required className="mt-1 h-11 w-full rounded-md border border-stone-300 px-3" /></label>
        <button type="submit" disabled={saving} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50"><Plus className="h-4 w-4" />{saving ? "送出中..." : "送出申請"}</button>
      </form>
      {message ? <p role="status" className="mt-4 text-sm font-medium">{message}</p> : null}
    </section>
  );
}

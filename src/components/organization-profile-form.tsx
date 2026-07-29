"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { useUnsavedSettings } from "@/lib/unsaved-settings";

type OrganizationProfile = {
  businessName: string;
  email: string;
  phone: string;
};

export function OrganizationProfileForm({
  organizationId,
  initial,
}: {
  organizationId: string;
  initial: OrganizationProfile;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  useUnsavedSettings("organization-profile", dirty);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/merchant/organizations/${organizationId}/profile`,
        {
          method: "PATCH",
          headers: csrfHeaders(),
          body: JSON.stringify(draft),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "目前無法更新商家資料。");
      setDraft(payload.organization);
      setSaved(payload.organization);
      setMessage("商家資料已更新。");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法更新商家資料。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="border-y border-stone-200 py-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium sm:col-span-2">
          商家名稱
          <input
            type="text"
            required
            minLength={2}
            maxLength={80}
            value={draft.businessName}
            onChange={(event) => setDraft((current) => ({ ...current, businessName: event.target.value }))}
            autoComplete="organization"
            className="mt-1.5 w-full rounded-md border border-stone-300 px-3 py-2.5"
          />
        </label>
        <label className="text-sm font-medium">
          聯絡電子郵件
          <input
            type="email"
            required
            maxLength={254}
            value={draft.email}
            onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))}
            autoComplete="email"
            className="mt-1.5 w-full rounded-md border border-stone-300 px-3 py-2.5"
          />
        </label>
        <label className="text-sm font-medium">
          聯絡電話
          <input
            type="tel"
            required
            minLength={6}
            maxLength={30}
            pattern="\+?[0-9][0-9 ().-]{5,29}"
            value={draft.phone}
            onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))}
            autoComplete="tel"
            inputMode="tel"
            className="mt-1.5 w-full rounded-md border border-stone-300 px-3 py-2.5"
          />
        </label>
      </div>
      {message ? (
        <p
          role="status"
          className={message === "商家資料已更新。"
            ? "mt-4 text-sm text-emerald-700"
            : "mt-4 text-sm text-red-700"}
        >
          {message}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy || !dirty}
        className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-md bg-stone-900 px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
      >
        <Save className="h-4 w-4" />
        {busy ? "儲存中..." : "儲存商家資料"}
      </button>
    </form>
  );
}

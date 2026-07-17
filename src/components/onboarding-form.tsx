"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Store } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";

export function OnboardingForm({ authenticatedProfile }: { authenticatedProfile: { displayName: string; email: string } }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(formData: FormData) {
    setError("");
    setIsSubmitting(true);

    const payload = Object.fromEntries(formData.entries());
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? "目前無法建立商戶，請稍後再試。");
        return;
      }
      router.push(result.next ?? `/merchant/${result.stallSlug}`);
      router.refresh();
    } catch {
      setError("目前無法連線，請確認網路後重試。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form action={submit} className="mx-auto max-w-2xl rounded-lg border border-stone-200 bg-white p-5">
      <div className="mb-6 flex items-center gap-3">
        <Store className="h-6 w-6 text-teal-700" />
        <div>
          <h1 className="text-2xl font-semibold">商戶申請與開店設定</h1>
          <p className="text-sm text-stone-600">建立組織與第一個攤位工作區。</p>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <input name="merchantName" maxLength={80} className="rounded-md border border-stone-300 px-3 py-2" placeholder="商戶名稱" required />
        <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm"><div className="font-medium">{authenticatedProfile.displayName}</div><div className="text-stone-500">{authenticatedProfile.email}</div></div>
        <input name="phone" maxLength={30} autoComplete="tel" className="rounded-md border border-stone-300 px-3 py-2" placeholder="聯絡電話" required />
        <input name="stallName" maxLength={80} className="rounded-md border border-stone-300 px-3 py-2" placeholder="攤位名稱" required />
        <input name="location" maxLength={120} className="rounded-md border border-stone-300 px-3 py-2" placeholder="營業地點" required />
        <input
          name="slug"
          className="rounded-md border border-stone-300 px-3 py-2 md:col-span-2"
          placeholder="攤位網址代稱，例如 aming-chicken"
          pattern="[a-z0-9-]+"
          required
        />
      </div>
      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
      <button
        type="submit"
        disabled={isSubmitting}
        className="mt-6 rounded-md bg-teal-700 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
      >
        {isSubmitting ? "建立中..." : "建立攤位"}
      </button>
    </form>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck } from "lucide-react";
import { useAppLocale } from "@/components/locale-provider";
import { csrfHeaders } from "@/lib/csrf-client";
import { publicMessages } from "@/lib/messages/public";

export function AcceptInvitation({ token }: { token: string }) {
  const { locale } = useAppLocale();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function accept() {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/invitations/${encodeURIComponent(token)}/accept`, {
        method: "POST",
        headers: csrfHeaders(),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(publicMessages.get(locale, "inviteAcceptError"));
      router.replace(payload.next);
      router.refresh();
    } catch (caughtError) {
      setMessage(caughtError instanceof Error ? caughtError.message : publicMessages.get(locale, "inviteAcceptError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        disabled={saving}
        onClick={() => void accept()}
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-stone-900 px-5 text-sm font-semibold text-white disabled:opacity-50"
      >
        <CircleCheck className="h-4 w-4" />
        {saving ? publicMessages.get(locale, "inviteAccepting") : publicMessages.get(locale, "inviteAccept")}
      </button>
      {message ? <p role="alert" className="mt-3 text-sm text-red-700">{message}</p> : null}
    </div>
  );
}

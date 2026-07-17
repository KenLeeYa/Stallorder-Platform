"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";

export function AcceptInvitation({ token }: { token: string }) {
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
      if (!response.ok) throw new Error(payload.error ?? "目前無法接受邀請。");
      router.replace(payload.next);
      router.refresh();
    } catch (caughtError) {
      setMessage(caughtError instanceof Error ? caughtError.message : "目前無法接受邀請。");
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
        {saving ? "正在接受邀請..." : "接受邀請"}
      </button>
      {message ? <p role="alert" className="mt-3 text-sm text-red-700">{message}</p> : null}
    </div>
  );
}

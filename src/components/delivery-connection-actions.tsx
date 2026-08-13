"use client";

import { useState } from "react";
import { CirclePause, Unplug } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { useMerchantMessages } from "@/lib/messages/merchant-client";

export function DeliveryConnectionActions({
  connectionId,
  stallId,
  canPause,
  canDisconnect,
}: {
  connectionId: string;
  stallId: string;
  canPause: boolean;
  canDisconnect: boolean;
}) {
  const { m, label } = useMerchantMessages();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function run(action: "PAUSE" | "DISCONNECT") {
    if (action === "DISCONNECT" && !window.confirm(m("確定要解除此外送平台連線？解除後需重新審核才能啟用。"))) return;
    setPending(true);
    setMessage("");
    const response = await fetch(
      `/api/merchant/integrations/delivery/${connectionId}?stallId=${encodeURIComponent(stallId)}`,
      {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify({ action }),
      },
    );
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setMessage(typeof result.error === "string" ? label(result.error) : m("操作失敗。"));
      return;
    }
    window.location.reload();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canPause ? <button type="button" disabled={pending} onClick={() => run("PAUSE")} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><CirclePause className="h-4 w-4" />{m("暫停連線")}</button> : null}
      {canDisconnect ? <button type="button" disabled={pending} onClick={() => run("DISCONNECT")} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-red-300 px-3 text-sm font-semibold text-red-800"><Unplug className="h-4 w-4" />{m("解除連線")}</button> : null}
      <span role="status" className="text-sm text-red-700">{message}</span>
    </div>
  );
}

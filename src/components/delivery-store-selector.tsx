"use client";

import { useState } from "react";
import { RefreshCw, Store } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { useMerchantMessages } from "@/lib/messages/merchant-client";
import { createWebUuid } from "@/lib/web-uuid";

type ExternalStore = { id: string; chainId: string | null; name: string };

export function DeliveryStoreSelector({
  connectionId,
  stallId,
}: {
  connectionId: string;
  stallId: string;
}) {
  const { m, label } = useMerchantMessages();
  const [stores, setStores] = useState<ExternalStore[]>([]);
  const [selected, setSelected] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const endpoint = `/api/merchant/integrations/delivery/${connectionId}/stores?stallId=${encodeURIComponent(stallId)}`;

  async function load() {
    setPending(true);
    setMessage("");
    const response = await fetch(endpoint, { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setMessage(typeof result.error === "string" ? label(result.error) : m("讀取門市失敗。"));
      return;
    }
    const nextStores = Array.isArray(result.stores) ? result.stores : [];
    setStores(nextStores);
    setSelected(nextStores[0]?.id ?? "");
    setMessage(nextStores.length ? m("已取得可用門市。") : m("目前沒有可選門市。"));
  }

  async function save() {
    if (!selected) return;
    setPending(true);
    setMessage("");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: csrfHeaders(),
      body: JSON.stringify({
        externalStoreId: selected,
        idempotencyKey: createWebUuid(),
      }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setMessage(typeof result.error === "string" ? label(result.error) : m("儲存門市失敗。"));
      return;
    }
    setMessage(m("門市已選取，需由平台管理員完成驗證後才能啟用。"));
    window.setTimeout(() => window.location.reload(), 600);
  }

  return (
    <div className="space-y-4">
      <button type="button" disabled={pending} onClick={load} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-stone-300 px-4 font-semibold"><RefreshCw className="h-4 w-4" />{m("讀取外送門市")}</button>
      {stores.length ? <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex-1 text-sm font-medium">{m("外送門市")}
          <select value={selected} onChange={(event) => setSelected(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3">
            {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
          </select>
        </label>
        <button type="button" disabled={pending || !selected} onClick={save} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-teal-700 px-4 font-semibold text-white"><Store className="h-4 w-4" />{m("選取門市")}</button>
      </div> : null}
      <p role="status" className="text-sm text-stone-700">{message}</p>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { Link2 } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";

type MappingEntity = {
  id: string;
  type: "CATEGORY" | "PRODUCT" | "MODIFIER_GROUP" | "MODIFIER_ITEM";
  label: string;
};

export function DeliveryMenuMappingForm({
  connectionId,
  stallId,
  entities,
}: {
  connectionId: string;
  stallId: string;
  entities: MappingEntity[];
}) {
  const [type, setType] = useState<MappingEntity["type"]>("PRODUCT");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const visible = useMemo(() => entities.filter((entity) => entity.type === type), [entities, type]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const response = await fetch(
      `/api/merchant/integrations/delivery/${connectionId}/menu-mapping?stallId=${encodeURIComponent(stallId)}`,
      {
        method: "PUT",
        headers: csrfHeaders(),
        body: JSON.stringify({
          internalEntityType: type,
          internalEntityId: form.get("internalEntityId"),
          externalEntityId: form.get("externalEntityId"),
          externalParentId: nullable(form.get("externalParentId")),
        }),
      },
    );
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setMessage(typeof result.error === "string" ? result.error : "儲存對應失敗。");
      return;
    }
    setMessage("對應已儲存。");
    window.setTimeout(() => window.location.reload(), 500);
  }

  return (
    <form onSubmit={submit} className="grid gap-4 border-t border-stone-200 pt-5 md:grid-cols-2">
      <label className="text-sm font-medium">資料類型
        <select value={type} onChange={(event) => setType(event.target.value as MappingEntity["type"])} className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3">
          <option value="CATEGORY">商品分類</option>
          <option value="PRODUCT">商品</option>
          <option value="MODIFIER_GROUP">註記群組</option>
          <option value="MODIFIER_ITEM">註記項目</option>
        </select>
      </label>
      <label className="text-sm font-medium">攤點通項目
        <select name="internalEntityId" required className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3">
          <option value="">請選擇</option>
          {visible.map((entity) => <option key={entity.id} value={entity.id}>{entity.label}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium">外送平台項目 ID
        <input name="externalEntityId" type="text" required minLength={1} maxLength={200} autoComplete="off" className="mt-1 h-11 w-full rounded-md border border-stone-300 px-3" />
      </label>
      <label className="text-sm font-medium">外送平台上層 ID（選填）
        <input name="externalParentId" type="text" maxLength={200} autoComplete="off" className="mt-1 h-11 w-full rounded-md border border-stone-300 px-3" />
      </label>
      <div className="flex flex-wrap items-center gap-3 md:col-span-2">
        <button type="submit" disabled={pending || visible.length === 0} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-teal-700 px-4 font-semibold text-white disabled:opacity-50"><Link2 className="h-4 w-4" />儲存對應</button>
        <p role="status" className="text-sm text-stone-700">{message}</p>
      </div>
    </form>
  );
}

function nullable(value: FormDataEntryValue | null) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

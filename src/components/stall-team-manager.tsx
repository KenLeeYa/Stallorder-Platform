"use client";

import { useState } from "react";
import { UserPlus, Users } from "lucide-react";
import { CollapsibleSectionSummary } from "@/components/collapsible-section-summary";
import { csrfHeaders } from "@/lib/csrf-client";

type StallRole = "STALL_MANAGER" | "STAFF" | "KITCHEN";
type Membership = {
  id: string;
  role: StallRole;
  isActive: boolean;
  profile: { id: string; displayName: string; email: string };
};

export function StallTeamManager({ stallId, initialMemberships }: { stallId: string; initialMemberships: Membership[] }) {
  const [memberships, setMemberships] = useState(initialMemberships);
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function addMember(formData: FormData) {
    setMessage("");
    setIsSaving(true);
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/memberships`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify({ email: formData.get("email"), role: formData.get("role") }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "目前無法指派成員。");
      setMemberships((current) => {
        const remaining = current.filter((membership) => membership.id !== payload.membership.id);
        return [...remaining, payload.membership].sort((left, right) => left.profile.displayName.localeCompare(right.profile.displayName, "zh-TW"));
      });
      setMessage("成員已指派至此攤位。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法指派成員。");
    } finally {
      setIsSaving(false);
    }
  }

  async function updateMembership(membership: Membership, role: StallRole, isActive: boolean) {
    setMessage("");
    setIsSaving(true);
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/memberships/${membership.id}`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify({ role, isActive }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "目前無法更新成員。");
      setMemberships((current) => current.map((item) => item.id === membership.id ? payload.membership : item));
      setMessage(isActive ? "成員權限已更新。" : "成員權限已停用。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法更新成員。");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section id="stall-team" className="mt-8 scroll-mt-24">
      <details open data-settings-section data-settings-scope="stall-team" data-settings-search="攤位成員 員工 廚房 主管 權限" className="border-y border-stone-200 [&[open]>summary_.section-chevron]:rotate-180">
        <CollapsibleSectionSummary icon={Users} title="攤位成員" />
        <div className="pb-7">
      <form action={addMember} className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_auto]">
        <label className="text-sm font-medium">帳號 Email<input name="email" type="email" required maxLength={120} className="mt-1.5 h-11 w-full rounded-md border border-stone-300 px-3" /></label>
        <label className="text-sm font-medium">角色<select name="role" defaultValue="STAFF" className="mt-1.5 h-11 w-full rounded-md border border-stone-300 bg-white px-3"><option value="STALL_MANAGER">攤位經理</option><option value="STAFF">店員</option><option value="KITCHEN">廚房</option></select></label>
        <button type="submit" disabled={isSaving} className="mt-auto inline-flex h-11 items-center justify-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50"><UserPlus className="h-4 w-4" />指派</button>
      </form>

      <div className="mt-5 divide-y divide-stone-200 border-y border-stone-200">
        {memberships.map((membership) => (
          <div key={membership.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div><div className="font-medium">{membership.profile.displayName}</div><div className="mt-1 text-sm text-stone-500">{membership.profile.email}</div></div>
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label={`變更 ${membership.profile.displayName} 的角色`} value={membership.role} disabled={isSaving || !membership.isActive} onChange={(event) => void updateMembership(membership, event.target.value as StallRole, true)} className="h-10 rounded-md border border-stone-300 bg-white px-2 text-sm"><option value="STALL_MANAGER">攤位經理</option><option value="STAFF">店員</option><option value="KITCHEN">廚房</option></select>
              <button type="button" disabled={isSaving} onClick={() => void updateMembership(membership, membership.role, !membership.isActive)} className={`h-10 rounded-md border px-3 text-sm font-semibold ${membership.isActive ? "border-red-300 text-red-800" : "border-stone-300 text-stone-700"}`}>{membership.isActive ? "停用" : "重新啟用"}</button>
            </div>
          </div>
        ))}
      </div>
      {memberships.length === 0 ? <p className="mt-5 text-sm text-stone-600">尚未指派攤位成員。</p> : null}
      {message ? <p role="status" className={message.includes("已") ? "mt-4 text-sm text-emerald-700" : "mt-4 text-sm text-red-700"}>{message}</p> : null}
        </div>
      </details>
    </section>
  );
}

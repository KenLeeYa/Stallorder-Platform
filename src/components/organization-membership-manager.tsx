"use client";

import { useState } from "react";
import { csrfHeaders } from "@/lib/csrf-client";
import { useMerchantMessages } from "@/lib/messages/merchant-client";

type OrganizationRole = "ORGANIZATION_OWNER" | "ORGANIZATION_ADMIN" | "FINANCE_VIEWER";
type Membership = {
  id: string;
  role: OrganizationRole;
  isActive: boolean;
  allStalls: boolean;
  isPrimaryOwner: boolean;
  profile: { id: string; displayName: string; email: string | null };
};

export function OrganizationMembershipManager({
  organizationId,
  initialMemberships,
  canGrantOwner,
}: {
  organizationId: string;
  initialMemberships: Membership[];
  canGrantOwner: boolean;
}) {
  const { m, label } = useMerchantMessages();
  const [memberships, setMemberships] = useState(initialMemberships);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function updateMembership(
    membership: Membership,
    next: Pick<Membership, "role" | "isActive" | "allStalls">,
  ) {
    if (
      !next.isActive
      && !window.confirm(m("確定停用 {name} 的組織權限？", { name: membership.profile.displayName }))
    ) return;
    setSavingId(membership.id);
    setMessage("");
    try {
      const response = await fetch(
        `/api/merchant/organizations/${organizationId}/memberships/${membership.id}`,
        { method: "PATCH", headers: csrfHeaders(), body: JSON.stringify(next) },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload.error === "string" ? label(payload.error) : m("目前無法更新組織成員。"));
      setMemberships((current) => current.map((item) => (
        item.id === membership.id ? payload.membership : item
      )));
      setMessage(next.isActive ? m("組織成員權限已更新。") : m("組織成員權限已停用。"));
    } catch (caughtError) {
      setMessage(caughtError instanceof Error ? label(caughtError.message) : m("目前無法更新組織成員。"));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="border-t border-stone-200 py-7">
      <h2 className="text-lg font-semibold">{m("組織成員")}</h2>
      <div className="mt-4 divide-y divide-stone-200 border-y border-stone-200">
        {memberships.map((membership) => {
          const ownerLocked = membership.isPrimaryOwner
            || (membership.role === "ORGANIZATION_OWNER" && !canGrantOwner);
          return (
            <div key={membership.id} className="flex flex-col gap-3 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 font-medium">
                  <span>{membership.profile.displayName}</span>
                  {membership.isPrimaryOwner ? <span className="rounded bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-800">{m("最高擁有者")}</span> : null}
                </div>
                <div className="mt-1 break-all text-sm text-stone-500">{membership.profile.email ?? m("未提供電子郵件")}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label={m("變更 {name} 的組織角色", { name: membership.profile.displayName })}
                  value={membership.role}
                  disabled={savingId !== null || !membership.isActive || ownerLocked}
                  onChange={(event) => {
                    const role = event.target.value as OrganizationRole;
                    void updateMembership(membership, {
                      role,
                      isActive: true,
                      allStalls: role === "ORGANIZATION_ADMIN" ? membership.allStalls : true,
                    });
                  }}
                  className="h-10 rounded-md border border-stone-300 bg-white px-2 text-sm"
                >
                  {canGrantOwner ? <option value="ORGANIZATION_OWNER">{m("組織擁有者")}</option> : null}
                  <option value="ORGANIZATION_ADMIN">{m("組織管理員")}</option>
                  <option value="FINANCE_VIEWER">{m("財務檢視者")}</option>
                </select>
                {membership.role === "ORGANIZATION_ADMIN" ? (
                  <label className="flex h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm">
                    <input
                      type="checkbox"
                      checked={membership.allStalls}
                      disabled={savingId !== null || !membership.isActive || ownerLocked}
                      onChange={(event) => void updateMembership(membership, {
                        role: membership.role,
                        isActive: true,
                        allStalls: event.target.checked,
                      })}
                    />
                    {m("全部攤位")}
                  </label>
                ) : (
                  <span className="rounded-md bg-stone-100 px-2 py-1 text-xs font-semibold">{m("全部攤位")}</span>
                )}
                <button
                  type="button"
                  disabled={savingId !== null || ownerLocked}
                  onClick={() => void updateMembership(membership, {
                    role: membership.role,
                    isActive: !membership.isActive,
                    allStalls: membership.allStalls,
                  })}
                  className={`h-10 rounded-md border px-3 text-sm font-semibold ${membership.isActive ? "border-red-300 text-red-800" : "border-stone-300 text-stone-700"}`}
                >
                  {membership.isActive ? m("停用") : m("重新啟用")}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {memberships.length === 0 ? <p className="mt-4 text-sm text-stone-600">{m("尚無組織成員。")}</p> : null}
      {message ? <p role="status" className="mt-4 text-sm text-stone-700">{message}</p> : null}
    </section>
  );
}

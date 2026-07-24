"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Send, Trash2 } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";

type InvitationRole =
  | "ORGANIZATION_OWNER"
  | "ORGANIZATION_ADMIN"
  | "FINANCE_VIEWER"
  | "STALL_MANAGER"
  | "STAFF"
  | "KITCHEN";

type Invitation = {
  id: string;
  email: string;
  role: InvitationRole;
  stallId: string | null;
  status: string;
  expiresAt: string;
  createdAt: string;
};

type StallOption = { id: string; name: string };

const roleLabels: Record<InvitationRole, string> = {
  ORGANIZATION_OWNER: "組織擁有者",
  ORGANIZATION_ADMIN: "組織管理員",
  FINANCE_VIEWER: "財務檢視者",
  STALL_MANAGER: "攤位經理",
  STAFF: "店員",
  KITCHEN: "廚房",
};

const statusLabels: Record<string, string> = {
  PENDING: "等待接受",
  ACCEPTED: "已接受",
  EXPIRED: "已過期",
  REVOKED: "已撤銷",
};

export function OrganizationInvitationManager({
  organizationId,
  stalls,
  initialInvitations,
  canManageOrganizationTeam,
  canGrantOwner,
}: {
  organizationId: string;
  stalls: StallOption[];
  initialInvitations: Invitation[];
  canManageOrganizationTeam: boolean;
  canGrantOwner: boolean;
}) {
  const defaultRole: InvitationRole = canManageOrganizationTeam ? "ORGANIZATION_ADMIN" : "STAFF";
  const [role, setRole] = useState<InvitationRole>(defaultRole);
  const [stallId, setStallId] = useState(stalls[0]?.id ?? "");
  const [invitations, setInvitations] = useState(initialInvitations);
  const [acceptanceUrl, setAcceptanceUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const organizationRole = useMemo(
    () => role === "ORGANIZATION_OWNER" || role === "ORGANIZATION_ADMIN" || role === "FINANCE_VIEWER",
    [role],
  );
  const stallNames = useMemo(() => new Map(stalls.map((stall) => [stall.id, stall.name])), [stalls]);

  async function createInvitation(formData: FormData) {
    setSaving(true);
    setMessage("");
    setAcceptanceUrl("");
    setCopied(false);
    try {
      const response = await fetch(`/api/merchant/organizations/${organizationId}/invitations`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify({
          email: formData.get("email"),
          role,
          stallId: organizationRole ? null : stallId,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "目前無法建立邀請。");
      setInvitations((current) => [
        { ...payload.invitation, createdAt: new Date().toISOString() },
        ...current,
      ]);
      setAcceptanceUrl(payload.acceptanceUrl);
      setMessage("邀請已建立。基於安全考量，接受連結只會顯示這一次。");
    } catch (caughtError) {
      setMessage(caughtError instanceof Error ? caughtError.message : "目前無法建立邀請。");
    } finally {
      setSaving(false);
    }
  }

  async function copyAcceptanceUrl() {
    if (!acceptanceUrl) return;
    await navigator.clipboard.writeText(acceptanceUrl);
    setCopied(true);
  }

  async function revokeInvitation(invitation: Invitation) {
    if (!window.confirm(`確定撤銷寄給 ${invitation.email} 的邀請？撤銷後原連結將立即失效。`)) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/merchant/organizations/${organizationId}/invitations/${invitation.id}`,
        { method: "DELETE", headers: csrfHeaders() },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "目前無法撤銷邀請。");
      setInvitations((current) => current.map((item) => (
        item.id === invitation.id ? { ...item, status: "REVOKED" } : item
      )));
      setMessage("邀請已撤銷。");
    } catch (caughtError) {
      setMessage(caughtError instanceof Error ? caughtError.message : "目前無法撤銷邀請。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="py-7">
      <h2 className="text-lg font-semibold">邀請新成員</h2>
      <form action={createInvitation} className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px_auto]">
        <label className="text-sm font-medium">
          Google 帳號 Email
          <input
            name="email"
            type="email"
            required
            maxLength={120}
            autoComplete="email"
            className="mt-1.5 h-11 w-full rounded-md border border-stone-300 px-3"
          />
        </label>
        <label className="text-sm font-medium">
          角色
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as InvitationRole)}
            className="mt-1.5 h-11 w-full rounded-md border border-stone-300 bg-white px-3"
          >
            {canGrantOwner ? <option value="ORGANIZATION_OWNER">組織擁有者</option> : null}
            {canManageOrganizationTeam ? <option value="ORGANIZATION_ADMIN">組織管理員</option> : null}
            {canManageOrganizationTeam ? <option value="FINANCE_VIEWER">財務檢視者</option> : null}
            {canManageOrganizationTeam ? <option value="STALL_MANAGER">攤位經理</option> : null}
            <option value="STAFF">店員</option>
            <option value="KITCHEN">廚房</option>
          </select>
        </label>
        <label className="text-sm font-medium">
          攤位範圍
          <select
            value={organizationRole ? "" : stallId}
            disabled={organizationRole}
            required={!organizationRole}
            onChange={(event) => setStallId(event.target.value)}
            className="mt-1.5 h-11 w-full rounded-md border border-stone-300 bg-white px-3 disabled:bg-stone-100"
          >
            {organizationRole ? <option value="">全部攤位</option> : null}
            {stalls.map((stall) => <option key={stall.id} value={stall.id}>{stall.name}</option>)}
          </select>
        </label>
        <button
          type="submit"
          disabled={saving || (!organizationRole && !stallId)}
          className="mt-auto inline-flex h-11 items-center justify-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
          建立邀請
        </button>
      </form>

      {acceptanceUrl ? (
        <div className="mt-5 border-y border-emerald-200 bg-emerald-50 py-4">
          <p className="text-sm font-semibold text-emerald-900">一次性邀請連結</p>
          <div className="mt-2 flex gap-2">
            <input type="text"
              aria-label="一次性邀請連結"
              readOnly
              value={acceptanceUrl}
              className="h-10 min-w-0 flex-1 rounded-md border border-emerald-300 bg-white px-3 text-sm"
            />
            <button
              type="button"
              title="複製邀請連結"
              onClick={() => void copyAcceptanceUrl()}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-emerald-300 bg-white"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              <span className="sr-only">複製邀請連結</span>
            </button>
          </div>
        </div>
      ) : null}

      {message ? <p role="status" className="mt-4 text-sm text-stone-700">{message}</p> : null}

      <h3 className="mt-7 text-base font-semibold">邀請紀錄</h3>
      <div className="mt-3 divide-y divide-stone-200 border-y border-stone-200">
        {invitations.map((invitation) => (
          <div key={invitation.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="break-all font-medium">{invitation.email}</div>
              <div className="mt-1 text-sm text-stone-500">
                {roleLabels[invitation.role]}
                {invitation.stallId ? ` · ${stallNames.get(invitation.stallId) ?? "已移除攤位"}` : " · 全部攤位"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-stone-100 px-2 py-1 text-xs font-semibold">
                {statusLabels[invitation.status] ?? invitation.status}
              </span>
              {invitation.status === "PENDING" ? (
                <button
                  type="button"
                  title="撤銷邀請"
                  disabled={saving}
                  onClick={() => void revokeInvitation(invitation)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-red-300 text-red-800 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="sr-only">撤銷邀請</span>
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {invitations.length === 0 ? <p className="mt-4 text-sm text-stone-600">尚無邀請紀錄。</p> : null}
    </section>
  );
}

"use client";

import { useRef, useState } from "react";
import { UserPlus, Users } from "lucide-react";
import { CollapsibleSectionSummary } from "@/components/collapsible-section-summary";
import { csrfHeaders } from "@/lib/csrf-client";

type StallRole = "STALL_MANAGER" | "STAFF" | "KITCHEN";
type Membership = {
  id: string;
  role: StallRole;
  isActive: boolean;
  profile: { id: string; displayName: string; email: string | null };
};

export function StallTeamManager({ stallId, initialMemberships }: { stallId: string; initialMemberships: Membership[] }) {
  const [memberships, setMemberships] = useState(initialMemberships);
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [membershipFieldErrors, setMembershipFieldErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const addMemberFormRef = useRef<HTMLFormElement>(null);
  const sectionRef = useRef<HTMLElement>(null);

  async function addMember(formData: FormData) {
    setMessage("");
    setHasError(false);
    setFieldErrors({});
    setIsSaving(true);
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/memberships`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify({ email: formData.get("email"), role: formData.get("role") }),
      });
      const payload = await response.json();
      if (!response.ok) {
        const nextFieldErrors = parseFieldErrors(payload.fieldErrors);
        setFieldErrors(nextFieldErrors);
        setMessage(payload.error ?? "目前無法指派成員。");
        setHasError(true);
        focusFirstInvalidField(addMemberFormRef.current, nextFieldErrors);
        return;
      }
      setMemberships((current) => {
        const remaining = current.filter((membership) => membership.id !== payload.membership.id);
        return [...remaining, payload.membership].sort((left, right) => left.profile.displayName.localeCompare(right.profile.displayName, "zh-TW"));
      });
      setMessage("成員已指派至此攤位。");
      addMemberFormRef.current?.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法指派成員。");
      setHasError(true);
    } finally {
      setIsSaving(false);
    }
  }

  async function updateMembership(membership: Membership, role: StallRole, isActive: boolean) {
    const scope = `membership-${membership.id}`;
    setMessage("");
    setHasError(false);
    setMembershipFieldErrors((current) => omitScopeErrors(current, scope));
    setIsSaving(true);
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/memberships/${membership.id}`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify({ role, isActive }),
      });
      const payload = await response.json();
      if (!response.ok) {
        const nextFieldErrors = parseFieldErrors(payload.fieldErrors);
        setMembershipFieldErrors((current) => ({
          ...omitScopeErrors(current, scope),
          ...Object.fromEntries(Object.entries(nextFieldErrors).map(([field, error]) => [scopedFieldKey(scope, field), error])),
        }));
        setMessage(payload.error ?? "目前無法更新成員。");
        setHasError(true);
        focusFirstInvalidScopedField(sectionRef.current, scope, nextFieldErrors);
        return;
      }
      setMemberships((current) => current.map((item) => item.id === membership.id ? payload.membership : item));
      setMessage(isActive ? "成員權限已更新。" : "成員權限已停用。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法更新成員。");
      setHasError(true);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section ref={sectionRef} id="stall-team" className="mt-8 scroll-mt-24">
      <details open data-settings-section data-settings-scope="stall-team" data-settings-search="攤位成員 員工 廚房 主管 權限" className="border-y border-stone-200 [&[open]>summary_.section-chevron]:rotate-180">
        <CollapsibleSectionSummary icon={Users} title="攤位成員" />
        <div className="pb-7">
      <form ref={addMemberFormRef} noValidate action={addMember} className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_auto]">
        <label className="text-sm font-medium">帳號 Email<input {...fieldValidationProps("email", fieldErrors.email)} type="email" required maxLength={120} className={inputClass(fieldErrors.email)} />{fieldErrors.email ? <span id={fieldErrorId("email")} role="alert" className="mt-1 block text-xs font-medium text-red-700">{fieldErrors.email}</span> : null}</label>
        <label className="text-sm font-medium">角色<select {...fieldValidationProps("role", fieldErrors.role)} defaultValue="STAFF" className={`${inputClass(fieldErrors.role)} bg-white`}><option value="STALL_MANAGER">攤位經理</option><option value="STAFF">店員</option><option value="KITCHEN">廚房</option></select>{fieldErrors.role ? <span id={fieldErrorId("role")} role="alert" className="mt-1 block text-xs font-medium text-red-700">{fieldErrors.role}</span> : null}</label>
        <button type="submit" disabled={isSaving} className="mt-auto inline-flex h-11 items-center justify-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50"><UserPlus className="h-4 w-4" />指派</button>
      </form>

      <div className="mt-5 divide-y divide-stone-200 border-y border-stone-200">
        {memberships.map((membership) => {
          const scope = `membership-${membership.id}`;
          const roleFieldKey = scopedFieldKey(scope, "role");
          const roleError = membershipFieldErrors[roleFieldKey];
          return <div key={membership.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div><div className="font-medium">{membership.profile.displayName}</div><div className="mt-1 text-sm text-stone-500">{membership.profile.email ?? "未提供電子郵件"}</div></div>
            <div className="flex flex-wrap items-center gap-2">
              <div><select {...scopedFieldValidationProps(roleFieldKey, roleError)} aria-label={`變更 ${membership.profile.displayName} 的角色`} value={membership.role} disabled={isSaving || !membership.isActive} onChange={(event) => void updateMembership(membership, event.target.value as StallRole, true)} className={`h-10 rounded-md border bg-white px-2 text-sm ${roleError ? "border-red-500" : "border-stone-300"}`}><option value="STALL_MANAGER">攤位經理</option><option value="STAFF">店員</option><option value="KITCHEN">廚房</option></select>{roleError ? <span id={fieldErrorId(roleFieldKey)} role="alert" className="mt-1 block max-w-52 text-xs font-medium text-red-700">{roleError}</span> : null}</div>
              <button type="button" disabled={isSaving} onClick={() => void updateMembership(membership, membership.role, !membership.isActive)} className={`h-10 rounded-md border px-3 text-sm font-semibold ${membership.isActive ? "border-red-300 text-red-800" : "border-stone-300 text-stone-700"}`}>{membership.isActive ? "停用" : "重新啟用"}</button>
            </div>
          </div>;
        })}
      </div>
      {memberships.length === 0 ? <p className="mt-5 text-sm text-stone-600">尚未指派攤位成員。</p> : null}
      {message ? <p role={hasError ? "alert" : "status"} className={hasError ? "mt-4 text-sm text-red-700" : "mt-4 text-sm text-emerald-700"}>{message}</p> : null}
        </div>
      </details>
    </section>
  );
}

function fieldErrorId(field: string) {
  return `stall-member-${field}-error`;
}

function fieldValidationProps(field: string, error?: string) {
  return {
    name: field,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? fieldErrorId(field) : undefined,
  };
}

function inputClass(error?: string) {
  return `mt-1.5 h-11 w-full rounded-md border px-3 ${error ? "border-red-500 bg-red-50" : "border-stone-300"}`;
}

function parseFieldErrors(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => (
    typeof entry[1] === "string" && Boolean(entry[1].trim())
  )));
}

function focusFirstInvalidField(form: HTMLFormElement | null, fieldErrors: Record<string, string>) {
  const field = Object.keys(fieldErrors)[0];
  if (!field) return;
  requestAnimationFrame(() => {
    const control = form?.elements.namedItem(field);
    if (control instanceof HTMLElement) control.focus();
  });
}

function scopedFieldKey(scope: string, field: string) {
  return `${scope}:${field}`;
}

function scopedFieldValidationProps(field: string, error?: string) {
  return {
    "data-field-key": field,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? fieldErrorId(field) : undefined,
  };
}

function omitScopeErrors(current: Record<string, string>, scope: string) {
  return Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${scope}:`)));
}

function focusFirstInvalidScopedField(container: HTMLElement | null, scope: string, fieldErrors: Record<string, string>) {
  const field = Object.keys(fieldErrors)[0];
  if (!field) return;
  requestAnimationFrame(() => {
    container?.querySelector<HTMLElement>(`[data-field-key="${CSS.escape(scopedFieldKey(scope, field))}"]`)?.focus();
  });
}

"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import {
  focusFirstInvalidField,
  parseFieldErrors,
  withoutFieldError,
  type FieldErrors,
} from "@/lib/form-field-errors";
import { PHONE_INPUT_PATTERN } from "@/lib/phone-input-pattern";
import { useUnsavedSettings } from "@/lib/unsaved-settings";

type OrganizationProfile = {
  businessName: string;
  email: string;
  phone: string;
};

export function OrganizationProfileForm({
  organizationId,
  initial,
}: {
  organizationId: string;
  initial: OrganizationProfile;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  useUnsavedSettings("organization-profile", dirty);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setHasError(false);
    setFieldErrors({});
    try {
      const response = await fetch(
        `/api/merchant/organizations/${organizationId}/profile`,
        {
          method: "PATCH",
          headers: csrfHeaders(),
          body: JSON.stringify(draft),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const nextFieldErrors = parseFieldErrors(payload.fieldErrors);
        setFieldErrors(nextFieldErrors);
        focusFirstInvalidField(formRef.current, nextFieldErrors);
        setHasError(true);
        setMessage(typeof payload.error === "string" ? payload.error : "目前無法更新商家資料。");
        return;
      }
      setDraft(payload.organization);
      setSaved(payload.organization);
      setMessage("商家資料已更新。");
      router.refresh();
    } catch (error) {
      setHasError(true);
      setMessage(error instanceof Error ? error.message : "目前無法更新商家資料。");
    } finally {
      setBusy(false);
    }
  }

  function updateField(field: keyof OrganizationProfile, value: string) {
    setFieldErrors((current) => withoutFieldError(current, field));
    setDraft((current) => ({ ...current, [field]: value }));
  }

  return (
    <form ref={formRef} noValidate onSubmit={submit} className="border-y border-stone-200 py-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium sm:col-span-2">
          商家名稱
          <input
            type="text"
            required
            minLength={2}
            maxLength={80}
            value={draft.businessName}
            data-field-key="businessName"
            aria-invalid={Boolean(fieldErrors.businessName)}
            aria-describedby={fieldErrors.businessName ? "organization-business-name-error" : undefined}
            onChange={(event) => updateField("businessName", event.target.value)}
            autoComplete="organization"
            className="mt-1.5 w-full rounded-md border border-stone-300 px-3 py-2.5"
          />
          {fieldErrors.businessName ? <span id="organization-business-name-error" role="alert" className="mt-1 block text-xs text-red-700">{fieldErrors.businessName}</span> : null}
        </label>
        <label className="text-sm font-medium">
          聯絡電子郵件
          <input
            type="email"
            required
            maxLength={254}
            value={draft.email}
            data-field-key="email"
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? "organization-email-error" : undefined}
            onChange={(event) => updateField("email", event.target.value)}
            autoComplete="email"
            className="mt-1.5 w-full rounded-md border border-stone-300 px-3 py-2.5"
          />
          {fieldErrors.email ? <span id="organization-email-error" role="alert" className="mt-1 block text-xs text-red-700">{fieldErrors.email}</span> : null}
        </label>
        <label className="text-sm font-medium">
          聯絡電話
          <input
            type="tel"
            required
            minLength={6}
            maxLength={30}
            pattern={PHONE_INPUT_PATTERN}
            value={draft.phone}
            data-field-key="phone"
            aria-invalid={Boolean(fieldErrors.phone)}
            aria-describedby={fieldErrors.phone ? "organization-phone-error" : undefined}
            onChange={(event) => updateField("phone", event.target.value)}
            autoComplete="tel"
            inputMode="tel"
            className="mt-1.5 w-full rounded-md border border-stone-300 px-3 py-2.5"
          />
          {fieldErrors.phone ? <span id="organization-phone-error" role="alert" className="mt-1 block text-xs text-red-700">{fieldErrors.phone}</span> : null}
        </label>
      </div>
      {message ? (
        <p
          role={hasError ? "alert" : "status"}
          className={message === "商家資料已更新。"
            ? "mt-4 text-sm text-emerald-700"
            : "mt-4 text-sm text-red-700"}
        >
          {message}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy || !dirty}
        className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-md bg-stone-900 px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
      >
        <Save className="h-4 w-4" />
        {busy ? "儲存中..." : "儲存商家資料"}
      </button>
    </form>
  );
}

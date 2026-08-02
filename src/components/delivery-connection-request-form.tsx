"use client";

import { useRef, useState } from "react";
import { Send } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import {
  focusFirstInvalidField,
  parseFieldErrors,
  withoutFieldError,
  type FieldErrors,
} from "@/lib/form-field-errors";

const capabilityOptions = [
  ["ORDER_WEBHOOK", "接收外送訂單"],
  ["ORDER_ACCEPT", "接受訂單"],
  ["ORDER_REJECT", "拒絕訂單"],
  ["ORDER_PREPARING", "同步製作中狀態"],
  ["ORDER_READY", "同步可取餐狀態"],
  ["MENU_PUSH", "同步菜單"],
  ["AVAILABILITY_PUSH", "同步商品供應"],
] as const;

export function DeliveryConnectionRequestForm({ stallId }: { stallId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  function clearFieldError(field: string) {
    setFieldErrors((current) => withoutFieldError(current, field));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setPending(true);
    setMessage("");
    setHasError(false);
    setFieldErrors({});
    const form = new FormData(formElement);
    const requestedCapabilities = capabilityOptions
      .map(([code]) => code)
      .filter((code) => form.getAll("capabilities").includes(code));
    try {
      const response = await fetch("/api/merchant/integrations/delivery", {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify({
          stallId,
          provider: form.get("provider"),
          merchantContactName: form.get("merchantContactName"),
          merchantContactEmail: form.get("merchantContactEmail"),
          merchantContactPhone: nullable(form.get("merchantContactPhone")),
          externalVendorCode: nullable(form.get("externalVendorCode")),
          externalChainCode: nullable(form.get("externalChainCode")),
          currentProvider: nullable(form.get("currentProvider")),
          requestedCapabilities,
          merchantNote: nullable(form.get("merchantNote")),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const nextFieldErrors = parseFieldErrors(result.fieldErrors);
        setFieldErrors(nextFieldErrors);
        focusFirstInvalidField(formRef.current, nextFieldErrors);
        setHasError(true);
        setMessage(typeof result.error === "string" ? result.error : "送出申請失敗。");
        return;
      }
      setMessage("申請已送出，平台管理員將依合作資格進行審核。");
      formElement.reset();
      window.setTimeout(() => window.location.reload(), 600);
    } catch {
      setHasError(true);
      setMessage("送出申請失敗。");
    } finally {
      setPending(false);
    }
  }

  return (
    <form ref={formRef} noValidate onSubmit={submit} className="grid gap-4 border-t border-stone-200 pt-5 md:grid-cols-2">
      <label className="text-sm font-medium">外送平台
        <select name="provider" required {...validationProps("provider", fieldErrors.provider)} onChange={() => clearFieldError("provider")} className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3">
          <option value="UBER_EATS">Uber Eats</option>
          <option value="FOODPANDA">foodpanda</option>
        </select>
        <FieldError field="provider" error={fieldErrors.provider} />
      </label>
      <label className="text-sm font-medium">聯絡人姓名
        <input name="merchantContactName" type="text" required minLength={2} maxLength={120} {...validationProps("merchantContactName", fieldErrors.merchantContactName)} onChange={() => clearFieldError("merchantContactName")} className="mt-1 h-11 w-full rounded-md border border-stone-300 px-3" />
        <FieldError field="merchantContactName" error={fieldErrors.merchantContactName} />
      </label>
      <label className="text-sm font-medium">聯絡電子郵件
        <input name="merchantContactEmail" type="email" required maxLength={320} {...validationProps("merchantContactEmail", fieldErrors.merchantContactEmail)} onChange={() => clearFieldError("merchantContactEmail")} className="mt-1 h-11 w-full rounded-md border border-stone-300 px-3" />
        <FieldError field="merchantContactEmail" error={fieldErrors.merchantContactEmail} />
      </label>
      <label className="text-sm font-medium">聯絡電話
        <input name="merchantContactPhone" type="tel" inputMode="tel" minLength={6} maxLength={30} {...validationProps("merchantContactPhone", fieldErrors.merchantContactPhone)} onChange={() => clearFieldError("merchantContactPhone")} className="mt-1 h-11 w-full rounded-md border border-stone-300 px-3" />
        <FieldError field="merchantContactPhone" error={fieldErrors.merchantContactPhone} />
      </label>
      <label className="text-sm font-medium">既有 Vendor Code（選填）
        <input name="externalVendorCode" type="text" maxLength={120} {...validationProps("externalVendorCode", fieldErrors.externalVendorCode)} onChange={() => clearFieldError("externalVendorCode")} className="mt-1 h-11 w-full rounded-md border border-stone-300 px-3" />
        <FieldError field="externalVendorCode" error={fieldErrors.externalVendorCode} />
      </label>
      <label className="text-sm font-medium">既有 Chain Code（選填）
        <input name="externalChainCode" type="text" maxLength={120} {...validationProps("externalChainCode", fieldErrors.externalChainCode)} onChange={() => clearFieldError("externalChainCode")} className="mt-1 h-11 w-full rounded-md border border-stone-300 px-3" />
        <FieldError field="externalChainCode" error={fieldErrors.externalChainCode} />
      </label>
      <label className="text-sm font-medium md:col-span-2">目前使用的點餐系統（選填）
        <input name="currentProvider" type="text" maxLength={120} {...validationProps("currentProvider", fieldErrors.currentProvider)} onChange={() => clearFieldError("currentProvider")} className="mt-1 h-11 w-full rounded-md border border-stone-300 px-3" />
        <FieldError field="currentProvider" error={fieldErrors.currentProvider} />
      </label>
      <fieldset className="md:col-span-2" aria-invalid={Boolean(fieldErrors.requestedCapabilities)} aria-describedby={fieldErrors.requestedCapabilities ? fieldErrorId("requestedCapabilities") : undefined}>
        <legend className="text-sm font-semibold">預計使用功能</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {capabilityOptions.map(([code, label], index) => (
            <label key={code} className="flex min-h-11 items-center gap-3 border border-stone-200 px-3 py-2 text-sm">
              <input
                type="checkbox"
                name="capabilities"
                value={code}
                defaultChecked={index < 5}
                data-field-key="requestedCapabilities"
                aria-invalid={Boolean(fieldErrors.requestedCapabilities)}
                aria-describedby={fieldErrors.requestedCapabilities ? fieldErrorId("requestedCapabilities") : undefined}
                onChange={() => clearFieldError("requestedCapabilities")}
                className="h-5 w-5"
              />
              {label}
            </label>
          ))}
        </div>
        <FieldError field="requestedCapabilities" error={fieldErrors.requestedCapabilities} />
      </fieldset>
      <label className="text-sm font-medium md:col-span-2">補充說明（選填）
        <textarea name="merchantNote" maxLength={2000} rows={3} {...validationProps("merchantNote", fieldErrors.merchantNote)} onChange={() => clearFieldError("merchantNote")} className="mt-1 w-full rounded-md border border-stone-300 p-3" />
        <FieldError field="merchantNote" error={fieldErrors.merchantNote} />
      </label>
      <div className="flex flex-wrap items-center gap-3 md:col-span-2">
        <button type="submit" disabled={pending} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-teal-700 px-4 font-semibold text-white disabled:opacity-50">
          <Send className="h-4 w-4" />{pending ? "送出中" : "送出連線申請"}
        </button>
        <p role={hasError ? "alert" : "status"} className="text-sm text-stone-700">{message}</p>
      </div>
    </form>
  );
}

function validationProps(field: string, error?: string) {
  return {
    "data-field-key": field,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? fieldErrorId(field) : undefined,
  };
}

function FieldError({ field, error }: { field: string; error?: string }) {
  return error ? <span id={fieldErrorId(field)} role="alert" className="mt-1 block text-xs text-red-700">{error}</span> : null;
}

function fieldErrorId(field: string) {
  return `delivery-connection-${field}-error`;
}

function nullable(value: FormDataEntryValue | null) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

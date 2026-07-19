"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, ChevronLeft, ChevronRight, ClipboardCheck, MapPin, Save, UserRound } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { merchantBusinessTypeLabels, merchantBusinessTypes } from "@/lib/merchant-application-contract";

type InitialValues = {
  phone?: string | null;
  lineId?: string | null;
  preferredContactMethod?: "PHONE" | "LINE" | "EMAIL" | null;
  merchantName?: string | null;
  businessType?: (typeof merchantBusinessTypes)[number] | null;
  businessRegistrationNumber?: string | null;
  contactName?: string | null;
  businessPhone?: string | null;
  businessAddress?: string | null;
  city?: string | null;
  merchantDescription?: string | null;
  stallName?: string | null;
  stallLocation?: string | null;
  requestedSlug?: string | null;
  estimatedDailyOrders?: number | null;
  expectedStartDate?: string | null;
  needsMultipleStaff?: boolean;
  needsKitchenView?: boolean;
  requestedPlanCode?: string | null;
  currentStep?: number;
};

type Trial = {
  displayName: string;
  trialDays: number | null;
  maxStalls: number | null;
  maxStaff: number | null;
  maxProducts: number | null;
  maxQrCodes: number | null;
  includedOrders: number | null;
  overagePolicy: string;
};

type FormState = {
  phone: string;
  lineId: string;
  preferredContactMethod: "PHONE" | "LINE" | "EMAIL";
  merchantName: string;
  businessType: (typeof merchantBusinessTypes)[number];
  businessRegistrationNumber: string;
  contactName: string;
  businessPhone: string;
  businessAddress: string;
  city: string;
  merchantDescription: string;
  stallName: string;
  stallLocation: string;
  requestedSlug: string;
  estimatedDailyOrders: string;
  expectedStartDate: string;
  needsMultipleStaff: boolean;
  needsKitchenView: boolean;
  requestedPlanCode: string;
  termsAccepted: boolean;
  privacyAccepted: boolean;
  dataProcessingAccepted: boolean;
  informationConfirmed: boolean;
};

const steps = [
  { label: "申請人", icon: UserRound },
  { label: "商家資料", icon: Building2 },
  { label: "第一個攤位", icon: MapPin },
  { label: "試用與同意", icon: ClipboardCheck },
];

export function OnboardingForm({
  authenticatedProfile,
  initialValues,
  trial,
  needsInfoNote,
}: {
  authenticatedProfile: { displayName: string; email: string; avatarUrl: string | null };
  initialValues?: InitialValues | null;
  trial: Trial;
  needsInfoNote?: string | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState(Math.min(initialValues?.currentStep ?? 1, 4));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [slugState, setSlugState] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const [state, setState] = useState<FormState>({
    phone: initialValues?.phone ?? "",
    lineId: initialValues?.lineId ?? "",
    preferredContactMethod: initialValues?.preferredContactMethod ?? "PHONE",
    merchantName: initialValues?.merchantName ?? "",
    businessType: initialValues?.businessType ?? "NIGHT_MARKET_STALL",
    businessRegistrationNumber: initialValues?.businessRegistrationNumber ?? "",
    contactName: initialValues?.contactName ?? authenticatedProfile.displayName,
    businessPhone: initialValues?.businessPhone ?? "",
    businessAddress: initialValues?.businessAddress ?? "",
    city: initialValues?.city ?? "",
    merchantDescription: initialValues?.merchantDescription ?? "",
    stallName: initialValues?.stallName ?? "",
    stallLocation: initialValues?.stallLocation ?? "",
    requestedSlug: initialValues?.requestedSlug ?? "",
    estimatedDailyOrders: initialValues?.estimatedDailyOrders?.toString() ?? "",
    expectedStartDate: initialValues?.expectedStartDate ?? "",
    needsMultipleStaff: initialValues?.needsMultipleStaff ?? false,
    needsKitchenView: initialValues?.needsKitchenView ?? false,
    requestedPlanCode: initialValues?.requestedPlanCode ?? "TRIAL",
    termsAccepted: false,
    privacyAccepted: false,
    dataProcessingAccepted: false,
    informationConfirmed: false,
  });

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (step < 4) {
      const saved = await saveDraft(step);
      if (saved) setStep((current) => Math.min(4, current + 1));
      return;
    }
    if (slugState === "taken") {
      setError("此網址代稱已被使用，請更換後再送出。");
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify({ intent: "SUBMIT", currentStep: 4, data: completePayload(state) }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? "目前無法送出商家申請，請稍後再試。");
        if (result.next) router.push(result.next);
        return;
      }
      router.push(result.next ?? "/onboarding/status");
      router.refresh();
    } catch {
      setError("目前無法連線，請確認網路後重試。");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function saveDraft(currentStep: number) {
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify({
          intent: "SAVE_DRAFT",
          currentStep,
          data: draftPayload(state, currentStep),
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? "目前無法儲存草稿。");
        if (result.next) router.push(result.next);
        return false;
      }
      setNotice("草稿已儲存");
      return true;
    } catch {
      setError("目前無法連線，請確認網路後重試。");
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }

  async function checkSlug() {
    const slug = state.requestedSlug.trim().toLowerCase();
    update("requestedSlug", slug);
    if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug)) {
      setSlugState("taken");
      return;
    }
    setSlugState("checking");
    try {
      const response = await fetch(`/api/onboarding?slug=${encodeURIComponent(slug)}`, { cache: "no-store" });
      const result = await response.json();
      setSlugState(response.ok && result.available ? "available" : "taken");
    } catch {
      setSlugState("idle");
    }
  }

  const ActiveIcon = steps[step - 1].icon;
  return (
    <form onSubmit={submit} className="mx-auto max-w-3xl border-y border-stone-200 bg-white py-6 sm:border sm:p-6">
      <header className="border-b border-stone-200 pb-5">
        <div className="flex items-center gap-3">
          <ActiveIcon className="h-6 w-6 text-teal-700" />
          <div>
            <h1 className="text-2xl font-semibold">商家申請</h1>
            <p className="text-sm text-stone-600">送出後由平台人工審核，不會立即建立商家工作區。</p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-4 border border-stone-200" aria-label="申請進度">
          {steps.map((item, index) => {
            const Icon = item.icon;
            const active = index + 1 === step;
            const completed = index + 1 < step;
            return (
              <div key={item.label} className={`flex min-h-14 items-center justify-center gap-2 px-2 text-xs font-semibold sm:text-sm ${active ? "bg-teal-50 text-teal-900" : "text-stone-500"}`}>
                {completed ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                <span>{item.label}</span>
              </div>
            );
          })}
        </div>
      </header>

      {needsInfoNote ? <p className="mt-5 border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-950">平台補件說明：{needsInfoNote}</p> : null}

      <section className="min-h-[420px] py-6">
        {step === 1 ? <ApplicantStep profile={authenticatedProfile} state={state} update={update} /> : null}
        {step === 2 ? <MerchantStep state={state} update={update} /> : null}
        {step === 3 ? <StallStep state={state} update={update} slugState={slugState} checkSlug={checkSlug} /> : null}
        {step === 4 ? <ConsentStep state={state} update={update} trial={trial} /> : null}
      </section>

      {error ? <p role="alert" className="mb-4 text-sm font-medium text-red-700">{error}</p> : null}
      {notice ? <p role="status" className="mb-4 text-sm font-medium text-teal-800">{notice}</p> : null}
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-5">
        <button type="button" disabled={step === 1 || isSubmitting} onClick={() => setStep((current) => Math.max(1, current - 1))} className="inline-flex min-h-11 items-center gap-2 px-3 text-sm font-semibold text-stone-700 disabled:opacity-40">
          <ChevronLeft className="h-4 w-4" />上一步
        </button>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={isSubmitting} onClick={() => void saveDraft(step)} className="inline-flex min-h-11 items-center gap-2 border border-stone-300 px-4 text-sm font-semibold disabled:opacity-50">
            <Save className="h-4 w-4" />儲存草稿
          </button>
          <button type="submit" disabled={isSubmitting} className="inline-flex min-h-11 items-center gap-2 bg-teal-700 px-5 text-sm font-semibold text-white disabled:opacity-50">
            {step < 4 ? <>下一步<ChevronRight className="h-4 w-4" /></> : isSubmitting ? "送出中..." : "送出商家申請"}
          </button>
        </div>
      </footer>
    </form>
  );
}

function ApplicantStep({ profile, state, update }: StepProps & { profile: { displayName: string; email: string; avatarUrl: string | null } }) {
  return <div className="grid gap-5">
    <div className="flex items-center gap-4 border-b border-stone-200 pb-4">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-stone-100" aria-hidden="true"><UserRound className="h-7 w-7 text-stone-500" /></span>
      <div><strong>{profile.displayName}</strong><p className="text-sm text-stone-500">{profile.email}</p><p className="mt-1 text-xs text-teal-800">已驗證 Google 身分</p></div>
    </div>
    <Field label="聯絡電話"><input required value={state.phone} onChange={(event) => update("phone", event.target.value)} autoComplete="tel" maxLength={30} className={inputClass} /></Field>
    <Field label="LINE ID（選填）"><input value={state.lineId} onChange={(event) => update("lineId", event.target.value)} maxLength={80} className={inputClass} /></Field>
    <Field label="偏好聯絡方式"><select value={state.preferredContactMethod} onChange={(event) => update("preferredContactMethod", event.target.value as FormState["preferredContactMethod"])} className={inputClass}><option value="PHONE">電話</option><option value="LINE">LINE</option><option value="EMAIL">電子郵件</option></select></Field>
  </div>;
}

function MerchantStep({ state, update }: StepProps) {
  return <div className="grid gap-4 md:grid-cols-2">
    <Field label="商家或品牌名稱"><input required value={state.merchantName} onChange={(event) => update("merchantName", event.target.value)} maxLength={120} className={inputClass} /></Field>
    <Field label="營業類型"><select value={state.businessType} onChange={(event) => update("businessType", event.target.value as FormState["businessType"])} className={inputClass}>{merchantBusinessTypes.map((type) => <option key={type} value={type}>{merchantBusinessTypeLabels[type]}</option>)}</select></Field>
    <Field label="統一編號（選填）"><input value={state.businessRegistrationNumber} onChange={(event) => update("businessRegistrationNumber", event.target.value)} maxLength={30} className={inputClass} /></Field>
    <Field label="負責聯絡人"><input required value={state.contactName} onChange={(event) => update("contactName", event.target.value)} maxLength={80} className={inputClass} /></Field>
    <Field label="商家電話"><input required value={state.businessPhone} onChange={(event) => update("businessPhone", event.target.value)} autoComplete="tel" maxLength={30} className={inputClass} /></Field>
    <Field label="縣市"><input required value={state.city} onChange={(event) => update("city", event.target.value)} maxLength={40} className={inputClass} /></Field>
    <Field label="商家地址" full><input required value={state.businessAddress} onChange={(event) => update("businessAddress", event.target.value)} maxLength={200} className={inputClass} /></Field>
    <Field label="商家簡介（選填）" full><textarea value={state.merchantDescription} onChange={(event) => update("merchantDescription", event.target.value)} maxLength={1000} rows={4} className={inputClass} /></Field>
  </div>;
}

function StallStep({ state, update, slugState, checkSlug }: StepProps & { slugState: string; checkSlug(): Promise<void> }) {
  return <div className="grid gap-4 md:grid-cols-2">
    <Field label="第一個攤位名稱"><input required value={state.stallName} onChange={(event) => update("stallName", event.target.value)} maxLength={120} className={inputClass} /></Field>
    <Field label="主要營業地點"><input required value={state.stallLocation} onChange={(event) => update("stallLocation", event.target.value)} maxLength={200} className={inputClass} /></Field>
    <Field label="預計開始日期"><input type="date" value={state.expectedStartDate} onChange={(event) => update("expectedStartDate", event.target.value)} className={inputClass} /></Field>
    <Field label="預估每日訂單"><input type="number" min={0} max={100000} value={state.estimatedDailyOrders} onChange={(event) => update("estimatedDailyOrders", event.target.value)} className={inputClass} /></Field>
    <Field label="公開網址代稱" full><input required value={state.requestedSlug} onChange={(event) => update("requestedSlug", event.target.value.toLowerCase())} onBlur={() => void checkSlug()} pattern="[a-z0-9][a-z0-9-]{1,48}[a-z0-9]" minLength={3} maxLength={50} className={inputClass} aria-describedby="slug-state" /><p id="slug-state" className={`mt-1 text-xs ${slugState === "available" ? "text-teal-700" : slugState === "taken" ? "text-red-700" : "text-stone-500"}`}>{slugState === "checking" ? "檢查中..." : slugState === "available" ? "此網址可使用" : slugState === "taken" ? "格式不正確或已被使用" : "僅限小寫英文字母、數字與連字號"}</p></Field>
    <Toggle label="需要多位員工" checked={state.needsMultipleStaff} onChange={(checked) => update("needsMultipleStaff", checked)} />
    <Toggle label="需要廚房畫面" checked={state.needsKitchenView} onChange={(checked) => update("needsKitchenView", checked)} />
  </div>;
}

function ConsentStep({ state, update, trial }: StepProps & { trial: Trial }) {
  return <div className="space-y-6">
    <section className="border-y border-stone-200 bg-stone-50 py-4">
      <h2 className="font-semibold">{trial.displayName}</h2>
      <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 text-sm sm:grid-cols-3">
        <Metric label="試用天數" value={`${trial.trialDays ?? 14} 天`} />
        <Metric label="攤位" value={`${trial.maxStalls ?? 1} 個`} />
        <Metric label="員工" value={`${trial.maxStaff ?? 2} 人`} />
        <Metric label="商品" value={`${trial.maxProducts ?? 50} 項`} />
        <Metric label="QR Code" value={`${trial.maxQrCodes ?? 1} 個`} />
        <Metric label="完成訂單" value={`${trial.includedOrders ?? 100} 筆`} />
      </dl>
      <p className="mt-3 text-xs text-stone-500">試用期從平台核准日起算；核准後仍需完成設定與測試訂單才會開放接單。</p>
    </section>
    <div className="space-y-3">
      <Consent label="我同意服務條款" checked={state.termsAccepted} onChange={(checked) => update("termsAccepted", checked)} />
      <Consent label="我同意隱私權政策" checked={state.privacyAccepted} onChange={(checked) => update("privacyAccepted", checked)} />
      <Consent label="我同意資料處理告知事項" checked={state.dataProcessingAccepted} onChange={(checked) => update("dataProcessingAccepted", checked)} />
      <Consent label="我確認上述申請資料正確" checked={state.informationConfirmed} onChange={(checked) => update("informationConfirmed", checked)} />
    </div>
  </div>;
}

type StepProps = { state: FormState; update<K extends keyof FormState>(key: K, value: FormState[K]): void };
const inputClass = "min-h-11 w-full border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-100";

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return <label className={`block text-sm font-medium text-stone-800 ${full ? "md:col-span-2" : ""}`}><span className="mb-1.5 block">{label}</span>{children}</label>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange(value: boolean): void }) {
  return <label className="flex min-h-12 items-center gap-3 border border-stone-200 px-3 text-sm font-medium"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-5 w-5 accent-teal-700" />{label}</label>;
}

function Consent({ label, checked, onChange }: { label: string; checked: boolean; onChange(value: boolean): void }) {
  return <label className="flex items-start gap-3 text-sm"><input required type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-0.5 h-5 w-5 accent-teal-700" /><span>{label}</span></label>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-stone-500">{label}</dt><dd className="font-semibold text-stone-900">{value}</dd></div>;
}

function draftPayload(state: FormState, step: number) {
  if (step === 1) return { phone: optionalText(state.phone), lineId: nullable(state.lineId), preferredContactMethod: state.preferredContactMethod };
  if (step === 2) return {
    merchantName: optionalText(state.merchantName),
    businessType: state.businessType,
    businessRegistrationNumber: nullable(state.businessRegistrationNumber),
    contactName: optionalText(state.contactName),
    businessPhone: optionalText(state.businessPhone),
    businessAddress: optionalText(state.businessAddress),
    city: optionalText(state.city),
    merchantDescription: nullable(state.merchantDescription),
  };
  if (step === 3) return {
    stallName: optionalText(state.stallName),
    stallLocation: optionalText(state.stallLocation),
    requestedSlug: optionalText(state.requestedSlug),
    estimatedDailyOrders: numberOrNull(state.estimatedDailyOrders),
    expectedStartDate: nullable(state.expectedStartDate),
    needsMultipleStaff: state.needsMultipleStaff,
    needsKitchenView: state.needsKitchenView,
  };
  return {
    requestedPlanCode: state.requestedPlanCode,
    termsAccepted: state.termsAccepted,
    privacyAccepted: state.privacyAccepted,
    dataProcessingAccepted: state.dataProcessingAccepted,
    informationConfirmed: state.informationConfirmed,
  };
}

function completePayload(state: FormState) {
  return {
    ...state,
    lineId: nullable(state.lineId),
    businessRegistrationNumber: nullable(state.businessRegistrationNumber),
    merchantDescription: nullable(state.merchantDescription),
    estimatedDailyOrders: numberOrNull(state.estimatedDailyOrders),
    expectedStartDate: nullable(state.expectedStartDate),
  };
}

function nullable(value: string) {
  const trimmed = value.trim();
  return trimmed || null;
}

function optionalText(value: string) {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function numberOrNull(value: string) {
  return value.trim() ? Number(value) : null;
}

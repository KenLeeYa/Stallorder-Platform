"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, ChevronLeft, ChevronRight, ClipboardCheck, MapPin, RefreshCw, Save, UserRound } from "lucide-react";
import { useAppLocale } from "@/components/locale-provider";
import { PublicIdentifierInputHint } from "@/components/public-identifier-input-hint";
import { csrfHeaders } from "@/lib/csrf-client";
import type { AppLocale } from "@/lib/app-locale";
import type { MerchantBusinessTypeOptionDto } from "@/lib/merchant-business-type-options";
import {
  merchantApplicationFieldLabels,
  merchantBusinessTypeLabels,
  merchantBusinessTypes,
} from "@/lib/merchant-application-options";
import {
  isValidPublicIdentifier,
  PUBLIC_IDENTIFIER_MAX_LENGTH,
  PUBLIC_IDENTIFIER_MIN_LENGTH,
  PUBLIC_IDENTIFIER_PATTERN,
} from "@/lib/public-identifier";
import { onboardingMessages } from "@/lib/messages/onboarding";
import { PHONE_INPUT_PATTERN } from "@/lib/phone-input-pattern";
import { taiwanCityOptions } from "@/lib/taiwan-address";

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

type FieldErrors = Partial<Record<keyof FormState, string>>;

type OnboardingMessageKey = Parameters<typeof onboardingMessages.get>[1];

const steps: Array<{ labelKey: OnboardingMessageKey; icon: typeof UserRound }> = [
  { labelKey: "stepApplicant", icon: UserRound },
  { labelKey: "stepMerchant", icon: Building2 },
  { labelKey: "stepStall", icon: MapPin },
  { labelKey: "stepConsent", icon: ClipboardCheck },
];

export function OnboardingForm({
  authenticatedProfile,
  initialValues,
  trial,
  businessTypeOptions,
  needsInfoNote,
  isReapplication = false,
}: {
  authenticatedProfile: { displayName: string; email: string | null; avatarUrl: string | null };
  initialValues?: InitialValues | null;
  trial: Trial;
  businessTypeOptions?: MerchantBusinessTypeOptionDto[];
  needsInfoNote?: string | null;
  isReapplication?: boolean;
}) {
  const router = useRouter();
  const { locale } = useAppLocale();
  const t = (key: OnboardingMessageKey, values?: Record<string, string | number>) => onboardingMessages.get(locale, key, values);
  const formRef = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState(Math.min(initialValues?.currentStep ?? 1, 4));
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [slugState, setSlugState] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const [isSlugManuallyEdited, setIsSlugManuallyEdited] = useState(Boolean(initialValues?.requestedSlug?.trim()));
  const [isGeneratingSlug, setIsGeneratingSlug] = useState(false);
  const [slugSuggestionError, setSlugSuggestionError] = useState("");
  const slugSuggestionRequestRef = useRef(0);
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
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function updateMerchantName(merchantName: string) {
    slugSuggestionRequestRef.current += 1;
    setIsGeneratingSlug(false);
    setState((current) => ({
      ...current,
      merchantName,
      requestedSlug: isSlugManuallyEdited
        ? current.requestedSlug
        : "",
    }));
    setSlugState("idle");
    setSlugSuggestionError("");
    clearFieldErrors(["merchantName", ...(isSlugManuallyEdited ? [] : ["requestedSlug" as const])]);
  }

  function updateRequestedSlug(requestedSlug: string) {
    slugSuggestionRequestRef.current += 1;
    setIsSlugManuallyEdited(true);
    setIsGeneratingSlug(false);
    setSlugState("idle");
    setSlugSuggestionError("");
    update("requestedSlug", requestedSlug.toLowerCase());
  }

  function regenerateRequestedSlug() {
    setIsSlugManuallyEdited(false);
    setSlugState("idle");
    void requestSlugSuggestion();
  }

  async function requestSlugSuggestion() {
    const merchantName = state.merchantName.trim();
    if (merchantName.length < 2) return;

    const requestVersion = slugSuggestionRequestRef.current + 1;
    slugSuggestionRequestRef.current = requestVersion;
    setIsGeneratingSlug(true);
    setSlugSuggestionError("");
    try {
      const response = await fetch(
        `/api/onboarding/public-identifier-suggestion?merchantName=${encodeURIComponent(merchantName)}`,
        { cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok || typeof result.suggestion !== "string") {
        throw new Error(t("slugSuggestionError"));
      }
      if (slugSuggestionRequestRef.current !== requestVersion) return;
      setState((current) => ({ ...current, requestedSlug: result.suggestion }));
      setSlugState("idle");
      clearFieldErrors(["requestedSlug"]);
    } catch (suggestionError) {
      if (slugSuggestionRequestRef.current !== requestVersion) return;
      setSlugSuggestionError(
        suggestionError instanceof Error
          ? suggestionError.message
          : t("slugSuggestionManual"),
      );
    } finally {
      if (slugSuggestionRequestRef.current === requestVersion) setIsGeneratingSlug(false);
    }
  }

  function clearFieldErrors(fields: Array<keyof FormState>) {
    setFieldErrors((current) => {
      if (!fields.some((field) => current[field])) return current;
      const next = { ...current };
      for (const field of fields) delete next[field];
      return next;
    });
  }

  function showResponseError(result: unknown, fallback: string) {
    const response = isRecord(result) ? result : {};
    const nextFieldErrors = parseFieldErrors(response.fieldErrors, locale);
    setFieldErrors(nextFieldErrors);
    setError(fallback);
    focusFirstInvalidField(formRef.current, nextFieldErrors);
  }

  function handleInvalid(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return;
    if (!isFormField(target.name)) return;
    const message = nativeValidationMessage(target.name, target, locale);
    setFieldErrors((current) => ({ ...current, [target.name]: message }));
    setError(t("checkFields"));
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>(":invalid")?.focus());
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (step < 4) {
      const saved = await saveDraft(step);
      if (saved) {
        const nextStep = Math.min(4, step + 1);
        setStep(nextStep);
        if (nextStep === 3 && !isSlugManuallyEdited) void requestSlugSuggestion();
      }
      return;
    }
    if (slugState === "taken") {
      setError(t("slugTakenSubmit"));
      const nextFieldErrors = { requestedSlug: t("slugInvalidOrTaken") };
      setFieldErrors(nextFieldErrors);
      focusFirstInvalidField(formRef.current, nextFieldErrors);
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
        showResponseError(result, t("submitError"));
        if (result.next) router.push(result.next);
        return;
      }
      router.push(result.next ?? "/onboarding/status");
      router.refresh();
    } catch {
      setError(t("networkError"));
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
        showResponseError(result, t("saveError"));
        if (result.next) router.push(result.next);
        return false;
      }
      setNotice(t("draftSaved"));
      return true;
    } catch {
      setError(t("networkError"));
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }

  async function checkSlug() {
    const slug = state.requestedSlug.trim().toLowerCase();
    update("requestedSlug", slug);
    if (!isValidPublicIdentifier(slug)) {
      setSlugState("taken");
      setFieldErrors((current) => ({
        ...current,
        requestedSlug: t("slugPattern"),
      }));
      return;
    }
    setSlugState("checking");
    try {
      const response = await fetch(`/api/onboarding?slug=${encodeURIComponent(slug)}`, { cache: "no-store" });
      const result = await response.json();
      const available = response.ok && result.available;
      setSlugState(available ? "available" : "taken");
      setFieldErrors((current) => {
        const next = { ...current };
        if (available) delete next.requestedSlug;
        else next.requestedSlug = t("slugTaken");
        return next;
      });
    } catch {
      setSlugState("idle");
    }
  }

  const ActiveIcon = steps[step - 1].icon;
  return (
    <form ref={formRef} onSubmit={submit} onInvalid={handleInvalid} className="mx-auto max-w-3xl border-y border-stone-200 bg-white py-6 sm:border sm:p-6">
      <header className="border-b border-stone-200 pb-5">
        <div className="flex items-center gap-3">
          <ActiveIcon className="h-6 w-6 text-teal-700" />
          <div>
            <h1 className="text-2xl font-semibold">{isReapplication ? t("reapplyTitle") : t("applicationTitle")}</h1>
            <p className="text-sm text-stone-600">
              {isReapplication
                ? t("reapplyDescription")
                : t("applicationDescription")}
            </p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-4 border border-stone-200" aria-label={t("progress")}>
          {steps.map((item, index) => {
            const Icon = item.icon;
            const active = index + 1 === step;
            const completed = index + 1 < step;
            return (
              <div key={item.labelKey} className={`flex min-h-14 items-center justify-center gap-2 px-2 text-xs font-semibold sm:text-sm ${active ? "bg-teal-50 text-teal-900" : "text-stone-500"}`}>
                {completed ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                <span>{t(item.labelKey)}</span>
              </div>
            );
          })}
        </div>
      </header>

      {isReapplication ? <p role="status" className="mt-5 border-l-4 border-teal-600 bg-teal-50 px-4 py-3 text-sm text-teal-950">{t("reapplyHistory")}</p> : null}
      {needsInfoNote ? <p className="mt-5 border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-950">{t("needsInfo", { note: needsInfoNote })}</p> : null}

      <section className="min-h-[420px] py-6">
        {step === 1 ? <ApplicantStep locale={locale} profile={authenticatedProfile} state={state} update={update} fieldErrors={fieldErrors} /> : null}
        {step === 2 ? <MerchantStep locale={locale} state={state} update={update} updateMerchantName={updateMerchantName} fieldErrors={fieldErrors} businessTypeOptions={businessTypeOptions ?? []} /> : null}
        {step === 3 ? <StallStep locale={locale} state={state} update={update} updateRequestedSlug={updateRequestedSlug} regenerateRequestedSlug={regenerateRequestedSlug} isSlugManuallyEdited={isSlugManuallyEdited} isGeneratingSlug={isGeneratingSlug} slugSuggestionError={slugSuggestionError} fieldErrors={fieldErrors} slugState={slugState} checkSlug={checkSlug} /> : null}
        {step === 4 ? <ConsentStep locale={locale} state={state} update={update} fieldErrors={fieldErrors} trial={trial} /> : null}
      </section>

      {error ? <p role="alert" className="mb-4 text-sm font-medium text-red-700">{error}</p> : null}
      {notice ? <p role="status" className="mb-4 text-sm font-medium text-teal-800">{notice}</p> : null}
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-5">
        <button type="button" disabled={step === 1 || isSubmitting} onClick={() => setStep((current) => Math.max(1, current - 1))} className="inline-flex min-h-11 items-center gap-2 px-3 text-sm font-semibold text-stone-700 disabled:opacity-40">
          <ChevronLeft className="h-4 w-4" />{t("previous")}
        </button>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={isSubmitting} onClick={() => void saveDraft(step)} className="inline-flex min-h-11 items-center gap-2 border border-stone-300 px-4 text-sm font-semibold disabled:opacity-50">
            <Save className="h-4 w-4" />{t("saveDraft")}
          </button>
          <button type="submit" disabled={isSubmitting} className="inline-flex min-h-11 items-center gap-2 bg-teal-700 px-5 text-sm font-semibold text-white disabled:opacity-50">
            {step < 4 ? <>{t("next")}<ChevronRight className="h-4 w-4" /></> : isSubmitting ? t("submitting") : t("submit")}
          </button>
        </div>
      </footer>
    </form>
  );
}

function ApplicantStep({ locale, profile, state, update, fieldErrors }: StepProps & { profile: { displayName: string; email: string | null; avatarUrl: string | null } }) {
  const t = messageGetter(locale);
  return <div className="grid gap-5">
    <div className="flex items-center gap-4 border-b border-stone-200 pb-4">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-stone-100" aria-hidden="true"><UserRound className="h-7 w-7 text-stone-500" /></span>
      <div><strong>{profile.displayName}</strong><p className="text-sm text-stone-500">{profile.email ?? t("emailMissing")}</p><p className="mt-1 text-xs text-teal-800">{t("verifiedIdentity")}</p></div>
    </div>
    <Field field="phone" label={t("fieldPhone")} error={fieldErrors.phone}><input {...fieldValidationProps("phone", fieldErrors)} type="tel" inputMode="tel" required value={state.phone} onChange={(event) => update("phone", event.target.value)} autoComplete="tel" minLength={6} maxLength={30} pattern={PHONE_INPUT_PATTERN} className={inputClass} /></Field>
    <Field field="lineId" label={t("fieldLineId")} error={fieldErrors.lineId}><input {...fieldValidationProps("lineId", fieldErrors)} type="text" value={state.lineId} onChange={(event) => update("lineId", event.target.value)} maxLength={80} className={inputClass} /></Field>
    <Field field="preferredContactMethod" label={t("fieldContactMethod")} error={fieldErrors.preferredContactMethod}><select {...fieldValidationProps("preferredContactMethod", fieldErrors)} value={state.preferredContactMethod} onChange={(event) => update("preferredContactMethod", event.target.value as FormState["preferredContactMethod"])} className={inputClass}><option value="PHONE">{t("contactPhone")}</option><option value="LINE">{t("contactLine")}</option><option value="EMAIL">{t("contactEmail")}</option></select></Field>
  </div>;
}

function MerchantStep({ locale, state, update, updateMerchantName, fieldErrors, businessTypeOptions }: StepProps & {
  businessTypeOptions: MerchantBusinessTypeOptionDto[];
  updateMerchantName(merchantName: string): void;
}) {
  const t = messageGetter(locale);
  const options = businessTypeOptions.length
    ? businessTypeOptions
    : merchantBusinessTypes.map((type, index) => ({
        code: type,
        legacyType: type,
        name: merchantBusinessTypeLabels[type],
        sortOrder: index,
        isActive: true,
      }));
  return <div className="grid gap-4 md:grid-cols-2">
    <Field field="merchantName" label={t("fieldMerchantName")} error={fieldErrors.merchantName}><input {...fieldValidationProps("merchantName", fieldErrors)} type="text" required value={state.merchantName} onChange={(event) => updateMerchantName(event.target.value)} minLength={2} maxLength={120} className={inputClass} /></Field>
    <Field field="businessType" label={t("fieldBusinessType")} error={fieldErrors.businessType}><select {...fieldValidationProps("businessType", fieldErrors)} value={state.businessType} onChange={(event) => update("businessType", event.target.value as FormState["businessType"])} className={inputClass}>{options.map((option) => <option key={option.code} value={option.legacyType}>{option.name}</option>)}</select></Field>
    <Field field="businessRegistrationNumber" label={t("fieldRegistration")} error={fieldErrors.businessRegistrationNumber}><input {...fieldValidationProps("businessRegistrationNumber", fieldErrors)} type="text" value={state.businessRegistrationNumber} onChange={(event) => update("businessRegistrationNumber", event.target.value)} maxLength={30} className={inputClass} /></Field>
    <Field field="contactName" label={t("fieldContactName")} error={fieldErrors.contactName}><input {...fieldValidationProps("contactName", fieldErrors)} type="text" required value={state.contactName} onChange={(event) => update("contactName", event.target.value)} minLength={2} maxLength={80} className={inputClass} /></Field>
    <Field field="businessPhone" label={t("fieldBusinessPhone")} error={fieldErrors.businessPhone}><input {...fieldValidationProps("businessPhone", fieldErrors)} type="tel" inputMode="tel" required value={state.businessPhone} onChange={(event) => update("businessPhone", event.target.value)} autoComplete="tel" minLength={6} maxLength={30} pattern={PHONE_INPUT_PATTERN} className={inputClass} /></Field>
    <Field field="city" label={t("fieldCity")} error={fieldErrors.city}><select {...fieldValidationProps("city", fieldErrors)} required value={state.city} onChange={(event) => update("city", event.target.value)} className={inputClass}><option value="">{t("selectCity")}</option>{taiwanCityOptions.map((city) => <option key={city} value={city}>{city}</option>)}</select></Field>
    <Field field="businessAddress" label={t("fieldAddress")} error={fieldErrors.businessAddress} full><input {...fieldValidationProps("businessAddress", fieldErrors)} type="text" required value={state.businessAddress} onChange={(event) => update("businessAddress", event.target.value)} minLength={5} maxLength={200} className={inputClass} /></Field>
    <Field field="merchantDescription" label={t("fieldDescription")} error={fieldErrors.merchantDescription} full><textarea {...fieldValidationProps("merchantDescription", fieldErrors)} value={state.merchantDescription} onChange={(event) => update("merchantDescription", event.target.value)} maxLength={1000} rows={4} className={inputClass} /></Field>
  </div>;
}

function StallStep({
  locale,
  state,
  update,
  updateRequestedSlug,
  regenerateRequestedSlug,
  isSlugManuallyEdited,
  isGeneratingSlug,
  slugSuggestionError,
  fieldErrors,
  slugState,
  checkSlug,
}: StepProps & {
  updateRequestedSlug(requestedSlug: string): void;
  regenerateRequestedSlug(): void;
  isSlugManuallyEdited: boolean;
  isGeneratingSlug: boolean;
  slugSuggestionError: string;
  slugState: string;
  checkSlug(): Promise<void>;
}) {
  const t = messageGetter(locale);
  return <div className="grid gap-4 md:grid-cols-2">
    <Field field="stallName" label={t("fieldStallName")} error={fieldErrors.stallName}><input {...fieldValidationProps("stallName", fieldErrors)} type="text" required value={state.stallName} onChange={(event) => update("stallName", event.target.value)} minLength={2} maxLength={120} className={inputClass} /></Field>
    <Field field="stallLocation" label={t("fieldStallLocation")} error={fieldErrors.stallLocation}><input {...fieldValidationProps("stallLocation", fieldErrors)} type="text" required value={state.stallLocation} onChange={(event) => update("stallLocation", event.target.value)} minLength={2} maxLength={200} className={inputClass} /></Field>
    <Field field="expectedStartDate" label={t("fieldStartDate")} error={fieldErrors.expectedStartDate}><input {...fieldValidationProps("expectedStartDate", fieldErrors)} type="date" value={state.expectedStartDate} onChange={(event) => update("expectedStartDate", event.target.value)} className={inputClass} /></Field>
    <Field field="estimatedDailyOrders" label={t("fieldDailyOrders")} error={fieldErrors.estimatedDailyOrders}><input {...fieldValidationProps("estimatedDailyOrders", fieldErrors)} type="number" min={0} max={100000} value={state.estimatedDailyOrders} onChange={(event) => update("estimatedDailyOrders", event.target.value)} className={inputClass} /></Field>
    <Field field="requestedSlug" label={t("fieldSlug")} error={fieldErrors.requestedSlug} full>
      <PublicIdentifierInputHint hintId="onboarding-public-identifier-rules" locale={locale}>
        <input type="text"
          {...fieldValidationProps(
            "requestedSlug",
            fieldErrors,
            slugState === "idle" ? "onboarding-public-identifier-rules" : "onboarding-public-identifier-rules slug-state",
          )}
          required
          value={state.requestedSlug}
          onChange={(event) => updateRequestedSlug(event.target.value)}
          onBlur={() => void checkSlug()}
          pattern={PUBLIC_IDENTIFIER_PATTERN}
          minLength={PUBLIC_IDENTIFIER_MIN_LENGTH}
          maxLength={PUBLIC_IDENTIFIER_MAX_LENGTH}
          className={inputClass}
        />
      </PublicIdentifierInputHint>
      {slugState !== "idle" ? (
        <p id="slug-state" aria-live="polite" className={`mt-1 text-xs ${slugState === "available" ? "text-teal-700" : slugState === "taken" ? "text-red-700" : "text-stone-500"}`}>
          {slugState === "checking" ? t("slugChecking") : slugState === "available" ? t("slugAvailable") : t("slugInvalid")}
        </p>
      ) : null}
    </Field>
    <div className="-mt-2 flex flex-wrap items-center justify-between gap-2 md:col-span-2">
      <p className="text-xs text-stone-600">
        {isGeneratingSlug
          ? t("slugGenerating")
          : slugSuggestionError
            ? slugSuggestionError
            : isSlugManuallyEdited
              ? t("slugManual")
              : t("slugAutomatic")}
      </p>
      <button
        type="button"
        disabled={isGeneratingSlug || state.merchantName.trim().length < 2}
        onClick={regenerateRequestedSlug}
        className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-xs font-semibold text-stone-800 disabled:opacity-50"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        {t("slugRegenerate")}
      </button>
    </div>
    <Toggle
      id="needs-multiple-staff"
      label={t("multiStaff")}
      description={t("multiStaffDescription")}
      checked={state.needsMultipleStaff}
      onChange={(checked) => update("needsMultipleStaff", checked)}
    />
    <Toggle
      id="needs-kitchen-view"
      label={t("kitchenView")}
      description={t("kitchenViewDescription")}
      checked={state.needsKitchenView}
      onChange={(checked) => update("needsKitchenView", checked)}
    />
  </div>;
}

function ConsentStep({ locale, state, update, fieldErrors, trial }: StepProps & { trial: Trial }) {
  const t = messageGetter(locale);
  return <div className="space-y-6">
    <section className="border-y border-stone-200 bg-stone-50 py-4">
      <h2 className="font-semibold">{trial.displayName}</h2>
      <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 text-sm sm:grid-cols-3">
        <Metric label={t("trialDays")} value={t("daysValue", { count: trial.trialDays ?? 14 })} />
        <Metric label={t("stalls")} value={t("stallsValue", { count: trial.maxStalls ?? 1 })} />
        <Metric label={t("staff")} value={t("staffValue", { count: trial.maxStaff ?? 2 })} />
        <Metric label={t("products")} value={t("productsValue", { count: trial.maxProducts ?? 50 })} />
        <Metric label="QR Code" value={t("qrValue", { count: trial.maxQrCodes ?? 1 })} />
        <Metric label={t("completedOrders")} value={t("ordersValue", { count: trial.includedOrders ?? 100 })} />
      </dl>
      <p className="mt-3 text-xs text-stone-500">{t("trialNotice")}</p>
    </section>
    <div className="space-y-3">
      <Consent field="termsAccepted" label={t("terms")} checked={state.termsAccepted} error={fieldErrors.termsAccepted} onChange={(checked) => update("termsAccepted", checked)} />
      <Consent field="privacyAccepted" label={t("privacy")} checked={state.privacyAccepted} error={fieldErrors.privacyAccepted} onChange={(checked) => update("privacyAccepted", checked)} />
      <Consent field="dataProcessingAccepted" label={t("dataProcessing")} checked={state.dataProcessingAccepted} error={fieldErrors.dataProcessingAccepted} onChange={(checked) => update("dataProcessingAccepted", checked)} />
      <Consent field="informationConfirmed" label={t("confirmInformation")} checked={state.informationConfirmed} error={fieldErrors.informationConfirmed} onChange={(checked) => update("informationConfirmed", checked)} />
    </div>
  </div>;
}

type StepProps = { locale: AppLocale; state: FormState; fieldErrors: FieldErrors; update<K extends keyof FormState>(key: K, value: FormState[K]): void };
const inputClass = "min-h-11 w-full border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-100";

function Field({ field, label, error, full, children }: { field: keyof FormState; label: string; error?: string; full?: boolean; children: React.ReactNode }) {
  return <label className={`block text-sm font-medium text-stone-800 ${full ? "md:col-span-2" : ""}`}><span className="mb-1.5 block">{label}</span>{children}{error ? <span id={fieldErrorId(field)} role="alert" className="mt-1.5 block text-xs font-medium text-red-700">{error}</span> : null}</label>;
}

function Toggle({ id, label, description, checked, onChange }: { id: string; label: string; description: string; checked: boolean; onChange(value: boolean): void }) {
  return <label htmlFor={id} className="flex min-h-12 items-start gap-3 border border-stone-200 px-3 py-3">
    <input id={id} type="checkbox" aria-labelledby={`${id}-label`} aria-describedby={`${id}-description`} checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-teal-700" />
    <span className="min-w-0">
      <span id={`${id}-label`} className="block text-sm font-medium text-stone-900">{label}</span>
      <span id={`${id}-description`} className="mt-1 block text-xs leading-5 text-stone-600">{description}</span>
    </span>
  </label>;
}

function Consent({ field, label, checked, error, onChange }: { field: keyof FormState; label: string; checked: boolean; error?: string; onChange(value: boolean): void }) {
  return <div><label className="flex items-start gap-3 text-sm"><input {...fieldValidationProps(field, error ? { [field]: error } : {})} required type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-0.5 h-5 w-5 accent-teal-700" /><span>{label}</span></label>{error ? <p id={fieldErrorId(field)} role="alert" className="ml-8 mt-1 text-xs font-medium text-red-700">{error}</p> : null}</div>;
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

function fieldErrorId(field: keyof FormState) {
  return `onboarding-${field}-error`;
}

function fieldValidationProps(field: keyof FormState, fieldErrors: FieldErrors, describedBy?: string) {
  const error = fieldErrors[field];
  return {
    name: field,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": [describedBy, error ? fieldErrorId(field) : null].filter(Boolean).join(" ") || undefined,
  };
}

function parseFieldErrors(value: unknown, locale: AppLocale): FieldErrors {
  if (!isRecord(value)) return {};
  const fieldErrors: FieldErrors = {};
  for (const [field, message] of Object.entries(value)) {
    if (isFormField(field) && typeof message === "string" && message.trim()) {
      fieldErrors[field] = onboardingMessages.get(locale, "validationGeneric", {
        label: localizedFieldLabel(field, locale),
      });
    }
  }
  return fieldErrors;
}

function isFormField(field: string): field is keyof FormState {
  return Object.prototype.hasOwnProperty.call(merchantApplicationFieldLabels, field);
}

function nativeValidationMessage(
  field: keyof FormState,
  target: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  locale: AppLocale,
) {
  const label = localizedFieldLabel(field, locale);
  if (target.validity.valueMissing) {
    return target instanceof HTMLInputElement && target.type === "checkbox"
      ? onboardingMessages.get(locale, "validationCheck", { label })
      : onboardingMessages.get(locale, "validationFill", { label });
  }
  if (target.validity.tooShort && target instanceof HTMLInputElement) {
    return onboardingMessages.get(locale, "validationTooShort", { label, count: target.minLength });
  }
  if (target.validity.tooLong) return onboardingMessages.get(locale, "validationTooLong", { label });
  if (target.validity.patternMismatch) {
    return field === "requestedSlug"
      ? onboardingMessages.get(locale, "slugPattern")
      : onboardingMessages.get(locale, "validationFormat", { label });
  }
  if (target.validity.rangeUnderflow || target.validity.rangeOverflow || target.validity.badInput) {
    return onboardingMessages.get(locale, "validationRange", { label });
  }
  return onboardingMessages.get(locale, "validationGeneric", { label });
}

function messageGetter(locale: AppLocale) {
  return (key: OnboardingMessageKey, values?: Record<string, string | number>) => onboardingMessages.get(locale, key, values);
}

function localizedFieldLabel(field: keyof FormState, locale: AppLocale) {
  const keyByField: Partial<Record<keyof FormState, OnboardingMessageKey>> = {
    phone: "fieldPhone",
    lineId: "fieldLineId",
    preferredContactMethod: "fieldContactMethod",
    merchantName: "fieldMerchantName",
    businessType: "fieldBusinessType",
    businessRegistrationNumber: "fieldRegistration",
    contactName: "fieldContactName",
    businessPhone: "fieldBusinessPhone",
    businessAddress: "fieldAddress",
    city: "fieldCity",
    merchantDescription: "fieldDescription",
    stallName: "fieldStallName",
    stallLocation: "fieldStallLocation",
    requestedSlug: "fieldSlug",
    estimatedDailyOrders: "fieldDailyOrders",
    expectedStartDate: "fieldStartDate",
    requestedPlanCode: "fieldPlan",
    needsMultipleStaff: "multiStaff",
    needsKitchenView: "kitchenView",
    termsAccepted: "terms",
    privacyAccepted: "privacy",
    dataProcessingAccepted: "dataProcessing",
    informationConfirmed: "confirmInformation",
  };
  const key = keyByField[field];
  return key ? onboardingMessages.get(locale, key) : merchantApplicationFieldLabels[field];
}

function focusFirstInvalidField(form: HTMLFormElement | null, fieldErrors: FieldErrors) {
  const firstField = Object.keys(fieldErrors).find(isFormField);
  if (!firstField) return;
  requestAnimationFrame(() => {
    const control = form?.elements.namedItem(firstField);
    if (control instanceof HTMLElement) control.focus();
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

"use client";

import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { KeyRound, LogIn, X } from "lucide-react";
import { useAppLocale } from "@/components/locale-provider";
import type { AppMessageKey } from "@/lib/app-messages";

const oauthErrorMessageKeys: Record<string, AppMessageKey> = {
  "not-configured": "login.oauth.error.notConfigured",
  "rate-limited": "login.oauth.error.rateLimited",
  "start-failed": "login.oauth.error.startFailed",
  "callback-failed": "login.oauth.error.callbackFailed",
  "account-conflict": "login.oauth.error.accountConflict",
};

type LoginProvider = {
  provider: "GOOGLE" | "LINE" | "APPLE" | "MICROSOFT";
  label: string;
};

type LocalQaAccount = {
  label: string;
  email: string;
  password: string;
};

type LoginAudience = "MERCHANT" | "STAFF";

export function LoginForm({
  audience = "MERCHANT",
  nextPath,
  legacyGoogleEnabled,
  oauthOnly,
  oauthProviders,
  oauthError,
  localQaAccounts,
}: {
  audience?: LoginAudience;
  nextPath?: string;
  legacyGoogleEnabled: boolean;
  oauthOnly: boolean;
  oauthProviders: LoginProvider[];
  oauthError?: string;
  localQaAccounts?: LocalQaAccount[];
}) {
  const { t } = useAppLocale();
  const locationSearch = useSyncExternalStore(subscribeToLocation, readLocationSearch, () => "");
  const searchParams = new URLSearchParams(locationSearch);
  const requestedNext = searchParams.get("next");
  const requestedNextPath = nextPath ?? (
    requestedNext && requestedNext.length <= 500 ? requestedNext : undefined
  );
  const requestedOauthError = oauthError ?? searchParams.get("oauthError") ?? undefined;
  const urlError = requestedOauthError
    ? t(oauthErrorMessageKeys[requestedOauthError] ?? "login.oauth.error.fallback")
    : "";
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isClientReady = useSyncExternalStore(subscribeToClientReady, readClientReady, readServerNotReady);
  const passwordDialogRef = useRef<HTMLDialogElement>(null);
  const hasOAuthProvider = oauthProviders.length > 0 || legacyGoogleEnabled;
  const titleKey = audience === "STAFF" ? "login.staff.title" : "login.title";
  const descriptionKey = audience === "STAFF" ? "login.staff.description" : "login.description";

  function openPasswordDialog() {
    setSubmissionError(null);
    if (!passwordDialogRef.current?.open) passwordDialogRef.current?.showModal();
  }

  function closePasswordDialog() {
    if (!isSubmitting) passwordDialogRef.current?.close();
  }

  async function authenticate(email: FormDataEntryValue | null, password: FormDataEntryValue | null) {
    setSubmissionError("");
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          next: requestedNextPath,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setSubmissionError(t(getLoginResponseMessageKey(response.status)));
        return;
      }
      window.location.assign(result.next);
    } catch {
      setSubmissionError(t("login.error.network"));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    await authenticate(formData.get("email"), formData.get("password"));
  }

  return (
    <section
      aria-labelledby="login-title"
      className="w-full max-w-md rounded-lg border border-stone-200 bg-white p-6 shadow-sm"
    >
      <div className="mb-6">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-teal-50 text-teal-800">
          <LogIn className="h-5 w-5" />
        </div>
        <h1 id="login-title" className="text-2xl font-semibold">{t(titleKey)}</h1>
        <p className="mt-2 text-sm text-stone-600">{t(descriptionKey)}</p>
      </div>
      {urlError ? <p role="alert" className="mb-4 text-sm text-red-700">{urlError}</p> : null}
      {localQaAccounts?.length ? (
        <div className="mb-5 rounded-md border border-teal-200 bg-teal-50 p-3">
          <p className="text-xs font-semibold text-teal-900">本機測試快速登入</p>
          <div data-testid="local-qa-login-grid" className="mt-2 grid grid-cols-2 gap-2">
            {localQaAccounts.map((account) => (
              <button key={account.email} type="button" disabled={!isClientReady || isSubmitting} onClick={() => void authenticate(account.email, account.password)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-teal-300 bg-white px-3 text-sm font-semibold text-teal-900 hover:bg-teal-100 disabled:opacity-50">
                <LogIn className="h-4 w-4" />{account.label}
              </button>
            ))}
          </div>
          {submissionError ? <p role="alert" className="mt-3 text-sm text-red-700">{submissionError}</p> : null}
        </div>
      ) : null}
      {hasOAuthProvider ? (
        <>
          <div className="space-y-3">
            {oauthProviders.map((provider) => (
              <a
                key={provider.provider}
                href={`/api/auth/${provider.provider.toLowerCase()}/start${requestedNextPath ? `?next=${encodeURIComponent(requestedNextPath)}` : ""}`}
                className={provider.provider === "GOOGLE"
                  ? "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800"
                  : "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-900 hover:bg-stone-50"}
              >
                <LogIn className="h-4 w-4" />
                {t("login.oauth.useProvider", { provider: provider.label })}
              </a>
            ))}
            {legacyGoogleEnabled ? (
              <a href={`/auth/google${requestedNextPath ? `?next=${encodeURIComponent(requestedNextPath)}` : ""}`} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800"><LogIn className="h-4 w-4" />{t("login.oauth.useProvider", { provider: "Google" })}</a>
            ) : null}
          </div>
          <p className="mt-3 text-center text-xs text-stone-500">
            {legacyGoogleEnabled && oauthProviders.length === 0
              ? t("login.oauth.legacyHint")
              : t("login.oauth.linkedHint")}
          </p>
        </>
      ) : null}
      {!oauthOnly ? (
        <>
          {hasOAuthProvider ? (
            <div className="my-5 flex items-center gap-3 text-xs text-stone-500">
              <span className="h-px flex-1 bg-stone-200" />
              <span>{t("login.otherMethods")}</span>
              <span className="h-px flex-1 bg-stone-200" />
            </div>
          ) : null}
          <button
            type="button"
            disabled={!isClientReady}
            onClick={openPasswordDialog}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-900 hover:bg-stone-50"
          >
            <KeyRound className="h-4 w-4" />
            {t("login.passwordButton")}
          </button>
        </>
      ) : null}
      {oauthOnly && oauthProviders.length === 0 ? (
        <p role="alert" className="mt-5 border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {t("login.noProviders")}
        </p>
      ) : null}
      {!oauthOnly ? (
        <dialog
          ref={passwordDialogRef}
          aria-labelledby="password-login-title"
          aria-describedby="password-login-description"
          onCancel={(event) => {
            if (isSubmitting) event.preventDefault();
          }}
          className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border border-stone-200 bg-white p-0 text-stone-950 shadow-2xl backdrop:bg-stone-950/70"
        >
          <form onSubmit={submit} className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="password-login-title" className="text-xl font-semibold">{t("login.passwordDialog.title")}</h2>
                <p id="password-login-description" className="mt-1 text-sm text-stone-600">
                  {t("login.passwordDialog.description")}
                </p>
              </div>
              <button
                type="button"
                onClick={closePasswordDialog}
                disabled={isSubmitting}
                aria-label={t("login.passwordDialog.close")}
                title={t("login.passwordDialog.close")}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-stone-300 text-stone-700 hover:bg-stone-50 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-5 space-y-4">
              <label className="block text-sm font-medium">
                {t("login.fields.email")}
                <input
                  name="email"
                  type="email"
                  autoComplete="username"
                  maxLength={120}
                  required
                  autoFocus
                  className="mt-1.5 w-full rounded-md border border-stone-300 px-3 py-2.5"
                />
              </label>
              <label className="block text-sm font-medium">
                {t("login.fields.password")}
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  maxLength={128}
                  required
                  className="mt-1.5 w-full rounded-md border border-stone-300 px-3 py-2.5"
                />
              </label>
            </div>
            {submissionError && !localQaAccounts?.length ? (
              <p role="alert" className="mt-4 text-sm text-red-700">{submissionError}</p>
            ) : null}
            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white hover:bg-stone-800 disabled:opacity-50"
            >
              <LogIn className="h-4 w-4" />
              {isSubmitting ? t("login.status.submitting") : t("login.submit")}
            </button>
          </form>
        </dialog>
      ) : null}
    </section>
  );
}

export function getLoginResponseMessageKey(status: number): AppMessageKey {
  if (status === 400) return "login.error.invalidFormat";
  if (status === 401) return "login.error.invalidCredentials";
  if (status === 403) return "login.error.authUnavailable";
  if (status === 429) return "login.error.rateLimited";
  return "login.error.generic";
}

function subscribeToLocation(callback: () => void) {
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
}

function readLocationSearch() {
  return window.location.search;
}

function subscribeToClientReady() {
  return () => undefined;
}

function readClientReady() {
  return true;
}

function readServerNotReady() {
  return false;
}

"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";
import { LogIn } from "lucide-react";

const oauthErrorMessages: Record<string, string> = {
  "not-configured": "Google 登入尚未完成環境設定。",
  "rate-limited": "Google 登入嘗試過於頻繁，請稍後再試。",
  "start-failed": "目前無法啟動 Google 登入。",
  "callback-failed": "Google 登入驗證失敗，請重新嘗試。",
  "account-conflict": "此 Email 已連結至其他登入身分，請聯絡管理員。",
};

export function LoginForm({ nextPath, googleEnabled, oauthError }: { nextPath?: string; googleEnabled: boolean; oauthError?: string }) {
  const locationSearch = useSyncExternalStore(subscribeToLocation, readLocationSearch, () => "");
  const searchParams = new URLSearchParams(locationSearch);
  const requestedNext = searchParams.get("next");
  const requestedNextPath = nextPath ?? (
    requestedNext && requestedNext.length <= 500 ? requestedNext : undefined
  );
  const requestedOauthError = oauthError ?? searchParams.get("oauthError") ?? undefined;
  const urlError = requestedOauthError
    ? oauthErrorMessages[requestedOauthError] ?? "Google 登入失敗。"
    : "";
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const error = submissionError ?? urlError;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    setSubmissionError("");
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: formData.get("email"),
          password: formData.get("password"),
          next: requestedNextPath,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setSubmissionError(result.error ?? "目前無法登入，請稍後再試。");
        return;
      }
      window.location.assign(result.next);
    } catch {
      setSubmissionError("目前無法連線，請確認網路後重試。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-md rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
      <div className="mb-6">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-teal-50 text-teal-800">
          <LogIn className="h-5 w-5" />
        </div>
        <h1 className="text-2xl font-semibold">登入 StallOrder</h1>
        <p className="mt-2 text-sm text-stone-600">商戶、店員與廚房人員共用此登入入口。</p>
      </div>
      <div className="space-y-4">
        <label className="block text-sm font-medium">
          電子郵件
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            className="mt-1.5 w-full rounded-md border border-stone-300 px-3 py-2.5"
          />
        </label>
        <label className="block text-sm font-medium">
          密碼
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="mt-1.5 w-full rounded-md border border-stone-300 px-3 py-2.5"
          />
        </label>
      </div>
      {error ? <p role="alert" className="mt-4 text-sm text-red-700">{error}</p> : null}
      <button
        type="submit"
        disabled={isSubmitting}
        className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-teal-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
      >
        <LogIn className="h-4 w-4" />
        {isSubmitting ? "登入中..." : "登入"}
      </button>
      {googleEnabled ? (
        <>
          <div className="my-5 flex items-center gap-3 text-xs text-stone-500"><span className="h-px flex-1 bg-stone-200" /><span>或</span><span className="h-px flex-1 bg-stone-200" /></div>
          <a href={`/auth/google${requestedNextPath ? `?next=${encodeURIComponent(requestedNextPath)}` : ""}`} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-900 hover:bg-stone-50"><LogIn className="h-4 w-4" />使用 Google 登入</a>
          <p className="mt-3 text-center text-xs text-stone-500">平台管理員請使用已授權的 Google 帳號登入。</p>
        </>
      ) : null}
    </form>
  );
}

function subscribeToLocation(callback: () => void) {
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
}

function readLocationSearch() {
  return window.location.search;
}

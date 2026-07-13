"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";

const oauthErrorMessages: Record<string, string> = {
  "not-configured": "Google 登入尚未完成環境設定。",
  "rate-limited": "Google 登入嘗試過於頻繁，請稍後再試。",
  "start-failed": "目前無法啟動 Google 登入。",
  "callback-failed": "Google 登入驗證失敗，請重新嘗試。",
  "account-conflict": "此 Email 已連結至其他登入身分，請聯絡管理員。",
};

export function LoginForm({ nextPath, googleEnabled, oauthError }: { nextPath?: string; googleEnabled: boolean; oauthError?: string }) {
  const router = useRouter();
  const [error, setError] = useState(oauthError ? oauthErrorMessages[oauthError] ?? "Google 登入失敗。" : "");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(formData: FormData) {
    setError("");
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: formData.get("email"),
          password: formData.get("password"),
          next: nextPath,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? "目前無法登入，請稍後再試。");
        return;
      }
      router.push(result.next);
      router.refresh();
    } catch {
      setError("目前無法連線，請確認網路後重試。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form action={submit} className="w-full max-w-md rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
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
          <a href={`/auth/google${nextPath ? `?next=${encodeURIComponent(nextPath)}` : ""}`} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-900 hover:bg-stone-50"><LogIn className="h-4 w-4" />使用 Google 登入</a>
        </>
      ) : null}
    </form>
  );
}

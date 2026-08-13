"use client";

import { useEffect } from "react";
import { csrfHeaders, readCsrfToken } from "@/lib/csrf-client";
import { nextAuthSessionCheckAt, shouldRefreshAuthSession } from "@/lib/session-lifetime";
import { createWebUuid } from "@/lib/web-uuid";

const NEXT_CHECK_KEY = "stallorder_auth_next_check:v1";
const REFRESH_LOCK_KEY = "stallorder_auth_refresh_lock:v1";
const IN_FLIGHT_GUARD_MS = 60_000;
const RETRY_DELAY_MS = 5 * 60_000;
const VISIBLE_CHECK_INTERVAL_MS = 15 * 60_000;

function readNextCheckAt() {
  try {
    const value = Number(window.localStorage.getItem(NEXT_CHECK_KEY));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function writeNextCheckAt(value: number) {
  try {
    window.localStorage.setItem(NEXT_CHECK_KEY, String(value));
  } catch {
    // Restricted storage still gets a best-effort refresh in the current tab.
  }
}

async function keepSessionAlive() {
  if (!readCsrfToken() || readNextCheckAt() > Date.now()) return;

  const now = Date.now();
  writeNextCheckAt(now + IN_FLIGHT_GUARD_MS);
  try {
    const current = await fetch("/api/auth/me", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (!current.ok) {
      if (current.status === 401) {
        window.location.assign("/login?reason=session-expired");
        return;
      }
      writeNextCheckAt(now + (current.status >= 500 ? RETRY_DELAY_MS : 12 * 60 * 60 * 1_000));
      return;
    }
    const body = await current.json() as { sessionExpiresAt?: unknown };
    if (typeof body.sessionExpiresAt !== "string") {
      writeNextCheckAt(now + RETRY_DELAY_MS);
      return;
    }
    if (!shouldRefreshAuthSession(body.sessionExpiresAt, now)) {
      writeNextCheckAt(nextAuthSessionCheckAt(body.sessionExpiresAt, now));
      return;
    }

    const refreshed = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "same-origin",
      headers: csrfHeaders(),
    });
    if (refreshed.status === 401) {
      window.location.assign("/login?reason=session-expired");
      return;
    }
    writeNextCheckAt(Date.now() + (refreshed.ok ? 12 * 60 * 60 * 1_000 : RETRY_DELAY_MS));
  } catch {
    writeNextCheckAt(Date.now() + RETRY_DELAY_MS);
  }
}

async function coordinatedKeepAlive() {
  if ("locks" in navigator) {
    await navigator.locks.request("stallorder-auth-refresh", { ifAvailable: true }, async (lock) => {
      if (lock) await keepSessionAlive();
    });
    return;
  }

  const owner = createWebUuid();
  const now = Date.now();
  try {
    const active = JSON.parse(window.localStorage.getItem(REFRESH_LOCK_KEY) ?? "null") as {
      owner?: unknown;
      expiresAt?: unknown;
    } | null;
    if (active && typeof active.expiresAt === "number" && active.expiresAt > now) return;
    window.localStorage.setItem(REFRESH_LOCK_KEY, JSON.stringify({ owner, expiresAt: now + IN_FLIGHT_GUARD_MS }));
    await new Promise((resolve) => window.setTimeout(resolve, 30));
    const claimed = JSON.parse(window.localStorage.getItem(REFRESH_LOCK_KEY) ?? "null") as { owner?: unknown } | null;
    if (claimed?.owner !== owner) return;
    await keepSessionAlive();
  } catch {
    await keepSessionAlive();
  } finally {
    try {
      const claimed = JSON.parse(window.localStorage.getItem(REFRESH_LOCK_KEY) ?? "null") as { owner?: unknown } | null;
      if (claimed?.owner === owner) window.localStorage.removeItem(REFRESH_LOCK_KEY);
    } catch {
      // The session check itself remains safe when storage is restricted.
    }
  }
}

export function SessionKeepAlive() {
  useEffect(() => {
    const check = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        void coordinatedKeepAlive();
      }
    };
    check();
    const intervalId = window.setInterval(check, VISIBLE_CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("online", check);
    };
  }, []);

  return null;
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BellRing, LoaderCircle, MessageCircle, RotateCcw } from "lucide-react";
import { useAppLocale } from "@/components/locale-provider";
import { publicMessages } from "@/lib/messages/public";
import {
  getOrCreateDeviceId,
  parseEdgeResponse,
  publicEdgeHeaders,
  publicEdgeUrl,
} from "@/lib/public-order-client";

type LinkStatus = {
  available: boolean;
  linked: boolean;
  displayName: string;
  officialAccountUrl: string;
  repeatOrderAvailable: boolean;
};

export function LineNotificationControls({ trackingToken }: { trackingToken: string }) {
  const { locale } = useAppLocale();
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const command = useCallback(async (action: "STATUS" | "START" | "REVOKE") => {
    const response = await fetch(publicEdgeUrl("manage-line-link"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...publicEdgeHeaders() },
      body: JSON.stringify({ action, trackingToken, deviceId: getOrCreateDeviceId() }),
      cache: "no-store",
    });
    const payload = await parseEdgeResponse(response);
    if (!response.ok) throw new Error(publicMessages.get(locale, "lineSettingsError"));
    return payload;
  }, [locale, trackingToken]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const result = new URLSearchParams(window.location.search).get("line");
      if (result === "linked") setMessage(publicMessages.get(locale, "lineLinkedSuccess"));
      else if (result === "error") setMessage(publicMessages.get(locale, "lineLinkedError"));
      void command("STATUS")
        .then((payload) => setStatus(payload as unknown as LinkStatus))
        .catch(() => setStatus(null));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [command, locale]);

  async function start() {
    setBusy(true);
    setMessage("");
    try {
      const payload = await command("START");
      const authorizationUrl = String(payload.authorizationUrl ?? "");
      if (!authorizationUrl.startsWith("https://access.line.me/")) {
        throw new Error(publicMessages.get(locale, "lineAuthorizationInvalid"));
      }
      window.location.assign(authorizationUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : publicMessages.get(locale, "lineConnectError"));
      setBusy(false);
    }
  }

  async function revoke() {
    if (!window.confirm(publicMessages.get(locale, "lineStopConfirm"))) return;
    setBusy(true);
    setMessage("");
    try {
      await command("REVOKE");
      setStatus((current) => current ? { ...current, linked: false } : current);
      setMessage(publicMessages.get(locale, "lineStopped"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : publicMessages.get(locale, "lineStopError"));
    } finally {
      setBusy(false);
    }
  }

  if (!status?.available && !status?.repeatOrderAvailable) return null;
  return (
    <section className="mt-7 border-y border-stone-200 py-5">
      <div className="flex items-center gap-3">
        <MessageCircle className="h-5 w-5 text-emerald-700" />
        <div>
          <h2 className="font-semibold">{status.displayName || publicMessages.get(locale, "lineDefaultName")}</h2>
          <p className="mt-1 text-xs text-stone-500">{status.linked ? publicMessages.get(locale, "lineLinked") : publicMessages.get(locale, "lineNotLinked")}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {status.available && !status.linked ? (
          <button type="button" onClick={() => void start()} disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
            {publicMessages.get(locale, "lineReceive")}
          </button>
        ) : null}
        {status.linked ? (
          <button type="button" onClick={() => void revoke()} disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-stone-300 px-4 text-sm font-semibold disabled:opacity-50">
            {publicMessages.get(locale, "lineStop")}
          </button>
        ) : null}
        {status.repeatOrderAvailable ? (
          <Link href={`/order/${encodeURIComponent(trackingToken)}/reorder`} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-teal-700 px-4 text-sm font-semibold text-teal-800">
            <RotateCcw className="h-4 w-4" />{publicMessages.get(locale, "lineReorder")}
          </Link>
        ) : null}
      </div>
      {status.officialAccountUrl ? <a href={status.officialAccountUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-semibold text-emerald-800 underline">{publicMessages.get(locale, "lineOpenOfficial")}</a> : null}
      {message ? <p role="status" className="mt-3 text-sm text-stone-700">{message}</p> : null}
    </section>
  );
}

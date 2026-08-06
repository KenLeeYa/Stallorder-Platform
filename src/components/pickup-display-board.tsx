"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  CheckCircle2,
  Clock3,
  Maximize2,
  RefreshCw,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { ProductImage } from "@/components/product-image";
import {
  collectUnannouncedReadyOrders,
  pickupVoiceMessage,
  type PickupDisplayOrder,
  type PublicPickupDisplay,
} from "@/lib/pickup-display-client";

type ConnectionState = "CONNECTING" | "REALTIME" | "POLLING";

export function PickupDisplayBoard({
  dataEndpoint,
  streamEndpoint,
}: {
  dataEndpoint: string;
  streamEndpoint: string;
}) {
  const [display, setDisplay] = useState<PublicPickupDisplay | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(true);
  const [connection, setConnection] = useState<ConnectionState>("CONNECTING");
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [origin, setOrigin] = useState("");

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch(dataEndpoint, { cache: "no-store" });
      const payload = await response.json() as { display?: PublicPickupDisplay; error?: string };
      if (!response.ok || !payload.display) {
        throw new Error(payload.error ?? "目前無法載入取餐顯示。");
      }
      setDisplay(payload.display);
      setError("");
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "目前無法載入取餐顯示。");
    } finally {
      setRefreshing(false);
    }
  }, [dataEndpoint]);

  useEffect(() => {
    const originTimer = window.setTimeout(() => setOrigin(window.location.origin), 0);
    const refreshTimer = window.setTimeout(() => void refresh(), 0);
    const fallback = window.setInterval(() => void refresh(), 12_000);
    const EventSourceConstructor = window.EventSource;
    if (typeof EventSourceConstructor !== "function") {
      const connectionTimer = window.setTimeout(() => setConnection("POLLING"), 0);
      return () => {
        window.clearTimeout(originTimer);
        window.clearTimeout(refreshTimer);
        window.clearTimeout(connectionTimer);
        window.clearInterval(fallback);
      };
    }

    const stream = new EventSourceConstructor(streamEndpoint);
    stream.onopen = () => setConnection("REALTIME");
    stream.addEventListener("ready", () => setConnection("REALTIME"));
    stream.addEventListener("display", () => {
      setConnection("REALTIME");
      void refresh();
    });
    stream.onerror = () => setConnection("POLLING");
    return () => {
      window.clearTimeout(originTimer);
      window.clearTimeout(refreshTimer);
      stream.close();
      window.clearInterval(fallback);
    };
  }, [refresh, streamEndpoint]);

  useEffect(() => {
    if (!display?.voice.enabled || voiceMuted || !("speechSynthesis" in window)) return;
    const storageKey = `stallorder:cds-announced:${display.stall.slug}`;
    let announcedKeys: string[] = [];
    try {
      const stored = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]");
      if (Array.isArray(stored)) {
        announcedKeys = stored.filter((value): value is string => typeof value === "string");
      }
    } catch {
      announcedKeys = [];
    }
    const { unannounced, nextKeys } = collectUnannouncedReadyOrders(
      display.ready,
      announcedKeys,
    );
    window.localStorage.setItem(storageKey, JSON.stringify(nextKeys));
    for (const order of unannounced) {
      const utterance = new SpeechSynthesisUtterance(pickupVoiceMessage(order));
      utterance.lang = display.voice.locale;
      window.speechSynthesis.speak(utterance);
    }
  }, [display, voiceMuted]);

  const menuUrl = display?.menuUrl && origin ? new URL(display.menuUrl, origin).toString() : null;
  const style = useMemo(() => ({
    "--cds-accent": display?.appearance.accentColor ?? "#0f766e",
    ...(display?.stall.backgroundImageUrl
      ? { backgroundImage: `linear-gradient(var(--cds-surface-overlay), var(--cds-surface-overlay)), url("${display.stall.backgroundImageUrl.replace(/["\\]/g, "")}")` }
      : {}),
  } as CSSProperties), [display]);

  if (!display && error) {
    return (
      <main className="grid min-h-screen place-items-center bg-stone-50 px-6 text-center">
        <div>
          <WifiOff className="mx-auto h-12 w-12 text-red-700" />
          <h1 className="mt-5 text-3xl font-semibold">目前無法使用取餐顯示</h1>
          <p role="alert" className="mt-3 text-stone-600">{error}</p>
          <button type="button" onClick={() => void refresh()} className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-md bg-stone-900 px-4 font-semibold text-white">
            <RefreshCw className="h-4 w-4" />重新載入
          </button>
        </div>
      </main>
    );
  }

  if (!display) return <PickupDisplayLoading />;

  return (
    <main style={style} className="min-h-screen bg-stone-50 bg-cover bg-center text-stone-950">
      <header className="border-b border-stone-300 bg-white/90 px-4 py-4 backdrop-blur-sm md:px-7">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-4">
          {display.stall.logoUrl ? (
            <ProductImage src={display.stall.logoUrl} alt={`${display.stall.name} 標誌`} width={72} height={72} sizes="72px" className="h-14 w-14 rounded-md object-cover md:h-16 md:w-16" />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold" style={{ color: "var(--cds-accent)" }}>取餐顯示</p>
            <h1 className="truncate text-2xl font-semibold md:text-4xl">{display.stall.name}</h1>
          </div>
          <ConnectionBadge state={connection} />
          {display.voice.enabled ? (
            <button type="button" title={voiceMuted ? "開啟語音" : "關閉語音"} onClick={() => setVoiceMuted((current) => !current)} className="grid h-11 w-11 place-items-center rounded-md border border-stone-300 bg-white">
              {voiceMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </button>
          ) : null}
          <button type="button" title="重新整理" disabled={refreshing} onClick={() => void refresh()} className="grid h-11 w-11 place-items-center rounded-md border border-stone-300 bg-white disabled:opacity-50">
            <RefreshCw className={`h-5 w-5 ${refreshing ? "animate-spin" : ""}`} />
          </button>
          <button type="button" title="全螢幕" onClick={() => void document.documentElement.requestFullscreen?.()} className="grid h-11 w-11 place-items-center rounded-md border border-stone-300 bg-white">
            <Maximize2 className="h-5 w-5" />
          </button>
        </div>
      </header>

      {display.appearance.announcementText ? (
        <div className="border-b border-stone-300 bg-amber-50 px-4 py-3 text-center text-base font-semibold text-amber-950 md:text-lg">
          {display.appearance.announcementText}
        </div>
      ) : null}

      <div className="mx-auto grid max-w-[1600px] gap-5 px-4 py-5 md:px-7 lg:grid-cols-2 lg:gap-7">
        <DisplayColumn
          title="製作中"
          icon={<Clock3 className="h-7 w-7" />}
          orders={display.preparing}
          emptyMessage="目前沒有製作中的訂單"
        />
        <DisplayColumn
          title="可以取餐"
          icon={<CheckCircle2 className="h-7 w-7" />}
          orders={display.ready}
          emptyMessage="目前沒有可取餐的訂單"
          ready
        />
      </div>

      <footer className="mx-auto flex max-w-[1600px] flex-wrap items-end justify-between gap-5 px-4 pb-6 md:px-7">
        <p className="text-xs text-stone-500">
          更新時間 {formatTime(display.refreshedAt)}
        </p>
        {menuUrl ? (
          <a href={menuUrl} className="flex items-center gap-3 rounded-md border border-stone-300 bg-white p-3 text-sm font-semibold" aria-label="掃描 QR Code 返回點餐菜單">
            <QRCodeSVG value={menuUrl} size={72} level="M" />
            <span>掃碼點餐</span>
          </a>
        ) : null}
      </footer>
    </main>
  );
}

function DisplayColumn({
  title,
  icon,
  orders,
  emptyMessage,
  ready = false,
}: {
  title: string;
  icon: React.ReactNode;
  orders: PickupDisplayOrder[];
  emptyMessage: string;
  ready?: boolean;
}) {
  return (
    <section aria-label={title} className="min-h-[36vh] border-y border-stone-300 bg-white/85 px-3 py-4 md:px-5">
      <div className="flex items-center gap-3 border-b border-stone-200 pb-4" style={ready ? { color: "var(--cds-accent)" } : undefined}>
        {icon}
        <h2 className="text-2xl font-semibold md:text-3xl">{title}</h2>
        <span className="ml-auto text-2xl font-semibold tabular-nums">{orders.length}</span>
      </div>
      {orders.length ? (
        <div className="grid gap-3 py-4 sm:grid-cols-2 xl:grid-cols-3">
          {orders.map((order) => (
            <article key={`${order.orderNo}:${order.readyAt ?? "preparing"}`} className={`rounded-md border p-4 ${ready ? "border-teal-600 bg-teal-50" : "border-stone-300 bg-white"}`}>
              <p className="text-sm font-semibold text-stone-500">訂單</p>
              <p className="mt-1 break-all text-3xl font-bold tabular-nums md:text-4xl">{order.orderNo}</p>
              {order.pickupCode ? <p className="mt-3 text-xl font-semibold tabular-nums">取餐碼 {order.pickupCode}</p> : null}
              {order.customerName ? <p className="mt-2 truncate text-base text-stone-700">{order.customerName}</p> : null}
              {ready && order.readyAt ? <p className="mt-3 text-sm text-stone-600">完成時間 {formatTime(order.readyAt)}</p> : null}
            </article>
          ))}
        </div>
      ) : <p className="grid min-h-40 place-items-center text-sm text-stone-500">{emptyMessage}</p>}
    </section>
  );
}

function ConnectionBadge({ state }: { state: ConnectionState }) {
  const realtime = state === "REALTIME";
  return (
    <span role="status" className={`inline-flex min-h-9 items-center gap-2 rounded-md border px-3 text-xs font-semibold ${realtime ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
      {realtime ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
      {realtime ? "即時連線" : state === "CONNECTING" ? "連線中" : "輪詢同步"}
    </span>
  );
}

function PickupDisplayLoading() {
  return (
    <main className="min-h-screen bg-stone-50 px-4 py-6" aria-busy="true">
      <div className="mx-auto max-w-[1600px] animate-pulse">
        <div className="h-16 w-72 rounded-md bg-stone-200" />
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          {[0, 1].map((column) => <div key={column} className="h-80 border-y border-stone-200 bg-white" />)}
        </div>
      </div>
    </main>
  );
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

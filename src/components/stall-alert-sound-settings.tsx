"use client";

import { useRef, useState } from "react";
import { Play, Save, Trash2, Upload, Volume2 } from "lucide-react";
import { SettingsFeedbackDialog } from "@/components/settings-feedback-dialog";
import {
  MAX_ALERT_SOUND_BYTES,
  MAX_ALERT_SOUND_DURATION_SECONDS,
} from "@/lib/alert-sound-upload";
import { playAlertSound, type AlertSoundPreset } from "@/lib/browser-alert-sound";
import { csrfFormHeaders, csrfHeaders } from "@/lib/csrf-client";
import { useMerchantMessages } from "@/lib/messages/merchant-client";

export type StallAlertSoundSettingsValue = {
  preset: AlertSoundPreset;
  volume: number;
  repeatCount: number;
  customSoundConfigured: boolean;
};

export function StallAlertSoundSettings({
  stallId,
  stallSlug,
  initialSettings,
}: {
  stallId: string;
  stallSlug: string;
  initialSettings: StallAlertSoundSettingsValue;
}) {
  const { m, label } = useMerchantMessages();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preset, setPreset] = useState(initialSettings.preset);
  const [volume, setVolume] = useState(initialSettings.volume);
  const [repeatCount, setRepeatCount] = useState(initialSettings.repeatCount);
  const [customSoundConfigured, setCustomSoundConfigured] = useState(initialSettings.customSoundConfigured);
  const [customSoundVersion, setCustomSoundVersion] = useState(0);
  const [busy, setBusy] = useState<"save" | "upload" | "remove" | null>(null);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  const customUrl = customSoundConfigured
    ? `/api/stalls/${encodeURIComponent(stallSlug)}/alert-sound?v=${customSoundVersion}`
    : null;

  async function saveSettings() {
    if (preset === "CUSTOM" && !customSoundConfigured) {
      setIsError(true);
      setMessage(m("請先上傳自訂提示音。"));
      return;
    }
    setBusy("save");
    setMessage("");
    try {
      const response = await fetch(`/api/stalls/${encodeURIComponent(stallSlug)}/ordering`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify({
          action: "UPDATE_ALERT_SETTINGS",
          settings: { preset, volume, repeatCount },
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload.error === "string" ? label(payload.error) : m("提示音設定儲存失敗。"));
      setIsError(false);
      setMessage(m("提示音設定已更新。"));
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : m("提示音設定儲存失敗。"));
    } finally {
      setBusy(null);
    }
  }

  async function uploadCustomSound(file: File | null) {
    if (!file) return;
    setMessage("");
    if (file.size === 0 || file.size > MAX_ALERT_SOUND_BYTES) {
      setIsError(true);
      setMessage(m("提示音檔案須小於 1MB。"));
      return;
    }
    if (!(await audioDurationIsAllowed(file))) {
      setIsError(true);
      setMessage(m("提示音長度須為 1 到 8 秒。"));
      return;
    }
    setBusy("upload");
    try {
      const form = new FormData();
      form.set("sound", file);
      const response = await fetch(`/api/merchant/stalls/${encodeURIComponent(stallId)}/alert-sound`, {
        method: "POST",
        headers: csrfFormHeaders(),
        body: form,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload.error === "string" ? label(payload.error) : m("自訂提示音上傳失敗。"));
      setCustomSoundConfigured(true);
      setCustomSoundVersion(Date.now());
      setPreset("CUSTOM");
      setIsError(false);
      setMessage(m("自訂提示音已上傳並套用。"));
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : m("自訂提示音上傳失敗。"));
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function removeCustomSound() {
    if (!customSoundConfigured || !window.confirm(m("確定移除自訂提示音？"))) return;
    setBusy("remove");
    setMessage("");
    try {
      const response = await fetch(`/api/merchant/stalls/${encodeURIComponent(stallId)}/alert-sound`, {
        method: "DELETE",
        headers: csrfFormHeaders(),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload.error === "string" ? label(payload.error) : m("自訂提示音移除失敗。"));
      setCustomSoundConfigured(false);
      setCustomSoundVersion(0);
      setPreset("URGENT");
      setIsError(false);
      setMessage(m("自訂提示音已移除，已改回強烈雙音。"));
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : m("自訂提示音移除失敗。"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="order-alert-sound-heading" className="mt-8 border-t border-stone-200 pt-6">
      <div className="flex items-start gap-3">
        <Volume2 aria-hidden="true" className="mt-0.5 h-5 w-5 text-teal-700" />
        <div>
          <h3 id="order-alert-sound-heading" className="text-lg font-semibold text-stone-900">{m("訂單提醒音")}</h3>
          <p className="mt-1 text-sm leading-6 text-stone-600">{m("店員開啟訂單提醒後，新訂單與到期預約單會使用此音效；裝置靜音與系統音量仍由裝置控制。")}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <label className="text-sm font-medium text-stone-700">
          {m("預設提示音")}
          <select value={preset} onChange={(event) => setPreset(event.target.value as AlertSoundPreset)} className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3">
            <option value="URGENT">{m("強烈雙音")}</option>
            <option value="BELL">{m("長鈴聲")}</option>
            <option value="CHIME">{m("三段提示音")}</option>
            <option value="CUSTOM" disabled={!customSoundConfigured}>{m("自訂提示音")}</option>
          </select>
        </label>
        <label className="text-sm font-medium text-stone-700">
          {m("音量 {volume}%", { volume })}
          <input type="range" min={10} max={100} step={10} value={volume} onChange={(event) => setVolume(Number(event.target.value))} className="mt-3 w-full accent-teal-700" />
        </label>
        <label className="text-sm font-medium text-stone-700">
          {m("重複次數")}
          <select value={repeatCount} onChange={(event) => setRepeatCount(Number(event.target.value))} className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3">
            {[1, 2, 3].map((count) => <option key={count} value={count}>{m("{count} 次", { count })}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => void playAlertSound({ preset, volume, repeatCount, customUrl })} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-teal-700 px-4 text-sm font-semibold text-teal-800"><Play className="h-4 w-4" />{m("試聽")}</button>
        <button type="button" disabled={busy !== null} onClick={() => void saveSettings()} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" />{busy === "save" ? m("儲存中...") : m("儲存提示音設定")}</button>
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-800">
          <Upload className="h-4 w-4" />{busy === "upload" ? m("上傳中...") : customSoundConfigured ? m("更換自訂提示音") : m("上傳自訂提示音")}
          <input ref={inputRef} type="file" accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/mp4" disabled={busy !== null} onChange={(event) => void uploadCustomSound(event.target.files?.[0] ?? null)} className="sr-only" />
        </label>
        {customSoundConfigured ? <button type="button" disabled={busy !== null} onClick={() => void removeCustomSound()} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-red-300 px-4 text-sm font-semibold text-red-700 disabled:opacity-50"><Trash2 className="h-4 w-4" />{m("移除自訂提示音")}</button> : null}
      </div>
      <p className="mt-3 text-xs leading-5 text-stone-500">{m("自訂檔案限 MP3、WAV 或 M4A，最多 1MB、1 到 8 秒；請勿上傳含個資或受限制內容的錄音。")}</p>
      {message ? <SettingsFeedbackDialog message={message} kind={isError ? "error" : "success"} onClose={() => setMessage("")} /> : null}
    </section>
  );
}

function audioDurationIsAllowed(file: File) {
  return new Promise<boolean>((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(result);
    };
    const timer = window.setTimeout(() => finish(false), 5_000);
    audio.addEventListener("loadedmetadata", () => {
      window.clearTimeout(timer);
      finish(Number.isFinite(audio.duration) && audio.duration >= 1 && audio.duration <= MAX_ALERT_SOUND_DURATION_SECONDS);
    }, { once: true });
    audio.addEventListener("error", () => {
      window.clearTimeout(timer);
      finish(false);
    }, { once: true });
    audio.preload = "metadata";
    audio.src = url;
  });
}

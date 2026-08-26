"use client";

import { type FormEvent, useState } from "react";
import { CalendarClock, CheckCircle2, GitBranch, LoaderCircle, Plus, RotateCcw, Send } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { parseFieldErrors, withoutFieldError } from "@/lib/form-field-errors";
import type { listCatalogVersions } from "@/server/catalog-versions/catalog-version-service";
import type { CatalogVersionStatus } from "@/server/catalog-versions/catalog-version-contract";

type CatalogVersionView = Awaited<ReturnType<typeof listCatalogVersions>>[number];

const statusLabels: Record<CatalogVersionStatus, string> = {
  DRAFT: "草稿",
  IN_REVIEW: "審核中",
  APPROVED: "已核准",
  SCHEDULED: "已排程",
  PUBLISHING: "發布中",
  ACTIVE: "目前版本",
  SUPERSEDED: "已被取代",
  ROLLED_BACK: "已回滾",
  FAILED: "發布失敗",
  ARCHIVED: "已封存",
};

const statusClasses: Record<CatalogVersionStatus, string> = {
  DRAFT: "bg-stone-100 text-stone-700",
  IN_REVIEW: "bg-amber-50 text-amber-800",
  APPROVED: "bg-sky-50 text-sky-800",
  SCHEDULED: "bg-violet-50 text-violet-800",
  PUBLISHING: "bg-cyan-50 text-cyan-800",
  ACTIVE: "bg-emerald-50 text-emerald-800",
  SUPERSEDED: "bg-stone-100 text-stone-600",
  ROLLED_BACK: "bg-orange-50 text-orange-800",
  FAILED: "bg-red-50 text-red-800",
  ARCHIVED: "bg-stone-100 text-stone-500",
};

type TransitionAction = { nextStatus: CatalogVersionStatus; label: string; tone?: "primary" | "danger" };

const transitionActions: Partial<Record<CatalogVersionStatus, readonly TransitionAction[]>> = {
  DRAFT: [{ nextStatus: "IN_REVIEW", label: "送審", tone: "primary" }, { nextStatus: "ARCHIVED", label: "封存" }],
  IN_REVIEW: [{ nextStatus: "APPROVED", label: "核准", tone: "primary" }, { nextStatus: "DRAFT", label: "退回草稿" }],
  APPROVED: [{ nextStatus: "SCHEDULED", label: "排程發布" }, { nextStatus: "PUBLISHING", label: "開始本機發布", tone: "primary" }, { nextStatus: "DRAFT", label: "退回草稿" }],
  SCHEDULED: [{ nextStatus: "PUBLISHING", label: "開始本機發布", tone: "primary" }, { nextStatus: "APPROVED", label: "取消排程" }],
  PUBLISHING: [{ nextStatus: "ACTIVE", label: "標記為目前版本", tone: "primary" }, { nextStatus: "FAILED", label: "標記失敗", tone: "danger" }],
  ACTIVE: [{ nextStatus: "ROLLED_BACK", label: "回滾版本", tone: "danger" }],
  SUPERSEDED: [{ nextStatus: "ROLLED_BACK", label: "回滾到此版本" }, { nextStatus: "ARCHIVED", label: "封存" }],
  ROLLED_BACK: [{ nextStatus: "ARCHIVED", label: "封存" }],
  FAILED: [{ nextStatus: "DRAFT", label: "回到草稿", tone: "primary" }, { nextStatus: "ARCHIVED", label: "封存" }],
};

export function CatalogVersionManager({
  organizationId,
  initialVersions,
}: {
  organizationId: string;
  initialVersions: readonly CatalogVersionView[];
}) {
  const [versions, setVersions] = useState([...initialVersions]);
  const [name, setName] = useState("");
  const [scheduledPublishAt, setScheduledPublishAt] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submitDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyKey) return;
    setBusyKey("CREATE_DRAFT");
    setMessage("");
    setFieldErrors({});
    try {
      const updated = await sendCommand({ operation: "CREATE_DRAFT", name, menuKey: "DEFAULT" });
      if (!updated) return;
      setVersions(updated);
      setName("");
      setMessage("已從目前共用商品建立本機菜單草稿。");
    } finally {
      setBusyKey(null);
    }
  }

  async function transition(versionId: string, action: TransitionAction) {
    const key = `${versionId}:${action.nextStatus}`;
    if (busyKey) return;
    if (action.nextStatus === "SCHEDULED" && !scheduledPublishAt) {
      setFieldErrors({ scheduledPublishAt: "請先選擇排程發布時間。" });
      return;
    }
    setBusyKey(key);
    setMessage("");
    setFieldErrors({});
    try {
      const updated = await sendCommand({
        operation: "TRANSITION",
        versionId,
        nextStatus: action.nextStatus,
        scheduledPublishAt: action.nextStatus === "SCHEDULED"
          ? new Date(scheduledPublishAt).toISOString()
          : null,
      });
      if (!updated) return;
      setVersions(updated);
      setMessage(`菜單版本已更新為「${statusLabels[action.nextStatus]}」。`);
    } finally {
      setBusyKey(null);
    }
  }

  async function sendCommand(command: Record<string, unknown>) {
    try {
      const response = await fetch(`/api/merchant/organizations/${organizationId}/catalog/versions`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify(command),
      });
      const payload = await response.json() as {
        error?: string;
        fieldErrors?: unknown;
        versions?: CatalogVersionView[];
      };
      if (!response.ok || !payload.versions) {
        setMessage(payload.error ?? "目前無法更新菜單版本。");
        setFieldErrors(parseFieldErrors(payload.fieldErrors));
        return null;
      }
      return payload.versions;
    } catch {
      setMessage("網路連線中斷，請稍後再試。");
      return null;
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm leading-6 text-teal-950">
        <div className="flex items-start gap-3">
          <GitBranch className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <h2 className="font-semibold">本機試用範圍</h2>
            <p className="mt-1 text-teal-900">
              版本草稿會快照目前共用商品並走審核生命週期；本機驗證期間不會直接改動現行 QR 與店員點餐菜單，也不會同步外送平台。
            </p>
          </div>
        </div>
      </section>

      <form onSubmit={submitDraft} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <Plus className="mt-1 h-5 w-5 text-teal-700" />
          <div>
            <h2 className="font-semibold text-stone-950">建立菜單版本</h2>
            <p className="mt-1 text-sm leading-6 text-stone-600">從目前共用商品建立不可變快照，供審核與發布演練。</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <label className="grid gap-1 text-sm font-medium text-stone-800">
            版本名稱
            <input
              type="text"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setFieldErrors((current) => withoutFieldError(current, "name"));
              }}
              aria-invalid={Boolean(fieldErrors.name)}
              aria-describedby={fieldErrors.name ? "catalog-version-name-error" : undefined}
              required
              maxLength={120}
              placeholder="例如：秋季菜單"
              className="min-h-11 rounded-md border border-stone-300 px-3 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
            />
            {fieldErrors.name ? <span id="catalog-version-name-error" className="text-sm text-red-700">{fieldErrors.name}</span> : null}
          </label>
          <button type="submit" disabled={Boolean(busyKey)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-stone-950 px-4 text-sm font-semibold text-white disabled:opacity-50">
            {busyKey === "CREATE_DRAFT" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            建立草稿
          </button>
        </div>
      </form>

      <section aria-labelledby="catalog-version-list-heading">
        <div className="flex flex-col gap-3 border-b border-stone-200 pb-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="catalog-version-list-heading" className="text-xl font-semibold text-stone-950">版本紀錄</h2>
            <p className="mt-1 text-sm text-stone-600">每個動作都會經過伺服器權限、CSRF、Feature Flag 與稽核檢查。</p>
          </div>
          <label className="grid gap-1 text-sm font-medium text-stone-700">
            排程時間
            <span className="flex min-h-11 items-center gap-2 rounded-md border border-stone-300 bg-white px-3">
              <CalendarClock className="h-4 w-4 text-stone-500" />
              <input
                type="datetime-local"
                value={scheduledPublishAt}
                onChange={(event) => {
                  setScheduledPublishAt(event.target.value);
                  setFieldErrors((current) => withoutFieldError(current, "scheduledPublishAt"));
                }}
                className="min-w-0 flex-1 bg-transparent outline-none"
              />
            </span>
            {fieldErrors.scheduledPublishAt ? <span className="text-sm text-red-700">{fieldErrors.scheduledPublishAt}</span> : null}
          </label>
        </div>

        {message ? <p role="status" className="mt-4 rounded-md bg-stone-100 px-3 py-2 text-sm font-medium text-stone-800">{message}</p> : null}

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {versions.map((version) => (
            <article key={version.id} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold tracking-wide text-teal-700">版本 {version.versionNumber} · {version.menuKey}</p>
                  <h3 className="mt-1 truncate text-lg font-semibold text-stone-950">{version.name}</h3>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${statusClasses[version.status]}`}>{statusLabels[version.status]}</span>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 border-y border-stone-100 py-3 text-sm">
                <div><dt className="text-stone-500">商品快照</dt><dd className="mt-1 font-semibold text-stone-900">{version.itemCount} 項</dd></div>
                <div><dt className="text-stone-500">發布紀錄</dt><dd className="mt-1 font-semibold text-stone-900">{version.publicationCount} 筆</dd></div>
                <div className="col-span-2"><dt className="text-stone-500">最後更新</dt><dd className="mt-1 font-medium text-stone-800"><time dateTime={version.updatedAt}>{new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" }).format(new Date(version.updatedAt))}</time></dd></div>
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                {(transitionActions[version.status] ?? []).map((action) => {
                  const key = `${version.id}:${action.nextStatus}`;
                  const Icon = action.nextStatus === "IN_REVIEW" ? Send : action.nextStatus === "ROLLED_BACK" ? RotateCcw : CheckCircle2;
                  return (
                    <button
                      key={action.nextStatus}
                      type="button"
                      disabled={Boolean(busyKey)}
                      onClick={() => void transition(version.id, action)}
                      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-3 text-sm font-semibold disabled:opacity-50 ${action.tone === "primary" ? "border-stone-950 bg-stone-950 text-white" : action.tone === "danger" ? "border-red-300 text-red-800" : "border-stone-300 text-stone-800"}`}
                    >
                      {busyKey === key ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                      {action.label}
                    </button>
                  );
                })}
              </div>
            </article>
          ))}
          {versions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-stone-300 p-8 text-center text-sm text-stone-600 lg:col-span-2">尚未建立菜單版本。</div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

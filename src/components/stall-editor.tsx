"use client";

import { useMerchantMessages } from "@/lib/messages/merchant-client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, ImageUp, MapPinned, Move, Plus, Save, Store, Trash2 } from "lucide-react";
import { ProductImage } from "@/components/product-image";
import { PublicIdentifierInputHint } from "@/components/public-identifier-input-hint";
import { csrfFormHeaders, csrfHeaders } from "@/lib/csrf-client";
import {
  PUBLIC_IDENTIFIER_MAX_LENGTH,
  PUBLIC_IDENTIFIER_MIN_LENGTH,
  PUBLIC_IDENTIFIER_PATTERN,
} from "@/lib/public-identifier";
import { PHONE_INPUT_PATTERN } from "@/lib/phone-input-pattern";
import { useUnsavedSettings } from "@/lib/unsaved-settings";

type StallDraft = {
  name: string;
  code: string;
  slug?: string;
  description: string;
  address: string;
  phone: string;
  timezone: string;
  currency: string;
  coverImageUrl?: string | null;
  coverImagePositionX?: number;
  coverImagePositionY?: number;
  coverImageZoom?: number;
  locationGuideImageUrl?: string | null;
  businessStatus?: "OPEN" | "PAUSED" | "CLOSED" | "SOLD_OUT";
  orderingEnabled?: boolean;
  isActive?: boolean;
};

type SaveSection = "basic" | "operations";
const basicFieldKeys = ["name", "code", "description", "address", "phone", "timezone", "currency"] as const;
const operationFieldKeys = ["businessStatus", "orderingEnabled", "isActive"] as const;

export function StallEditor({
  organizationId,
  stallId,
  initial,
  section = "all",
}: {
  organizationId: string;
  stallId?: string;
  initial: StallDraft;
  section?: "all" | SaveSection;
}) {
  const { label } = useMerchantMessages();
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  const [savedDraft, setSavedDraft] = useState(initial);
  const [messages, setMessages] = useState<Record<SaveSection, string>>({ basic: "", operations: "" });
  const [messageKinds, setMessageKinds] = useState<Record<SaveSection, "success" | "error" | null>>({ basic: null, operations: null });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [savingSection, setSavingSection] = useState<SaveSection | null>(null);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [savingCoverCrop, setSavingCoverCrop] = useState(false);
  const [removingCover, setRemovingCover] = useState(false);
  const [uploadingLocationGuide, setUploadingLocationGuide] = useState(false);
  const [removingLocationGuide, setRemovingLocationGuide] = useState(false);
  const basicFormRef = useRef<HTMLFormElement>(null);
  const operationsFormRef = useRef<HTMLFormElement>(null);
  const isEditing = Boolean(stallId);
  const basicDirty = basicFieldKeys.some((key) => draft[key] !== savedDraft[key]);
  const operationsDirty = isEditing && operationFieldKeys.some((key) => draft[key] !== savedDraft[key]);
  const coverCropDirty = Boolean(draft.coverImageUrl) && (
    coverPosition(draft, "x") !== coverPosition(savedDraft, "x")
    || coverPosition(draft, "y") !== coverPosition(savedDraft, "y")
    || coverZoom(draft) !== coverZoom(savedDraft)
  );
  useUnsavedSettings("stall-basic", basicDirty);
  useUnsavedSettings("stall-operations", operationsDirty);

  function update<K extends keyof StallDraft>(key: K, value: StallDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function setMessage(section: SaveSection, message: string, kind: "success" | "error" | null = "error") {
    setMessages((current) => ({ ...current, [section]: message }));
    setMessageKinds((current) => ({ ...current, [section]: kind }));
  }

  async function persist(payload: Record<string, unknown>, section: SaveSection) {
    setMessage(section, "", null);
    setFieldErrors({});
    setSavingSection(section);
    try {
      const response = await fetch(
        isEditing
          ? `/api/merchant/stalls/${stallId}`
          : `/api/merchant/organizations/${organizationId}/stalls`,
        {
          method: isEditing ? "PATCH" : "POST",
          headers: csrfHeaders(),
          body: JSON.stringify(payload),
        },
      );
      const responsePayload = await response.json();
      if (!response.ok) {
        const nextFieldErrors = parseFieldErrors(responsePayload.fieldErrors);
        setFieldErrors(nextFieldErrors);
        setMessage(section, responsePayload.error ?? label("目前無法儲存攤位。"));
        focusFirstInvalidField(section === "basic" ? basicFormRef.current : operationsFormRef.current, nextFieldErrors);
        return false;
      }

      if (!isEditing) {
        router.push(`/merchant/stalls/${responsePayload.stall.id}?organizationId=${organizationId}`);
        router.refresh();
        return true;
      }
      setMessage(section, section === "basic" ? label("基本資料已更新。") : label("營運狀態已更新。"), "success");
      router.refresh();
      return true;
    } catch (error) {
      setMessage(section, error instanceof Error ? error.message : label("目前無法儲存攤位。"));
      return false;
    } finally {
      setSavingSection(null);
    }
  }

  async function submitBasic(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const basicFields = {
      name: draft.name,
      code: draft.code,
      description: draft.description,
      address: draft.address,
      phone: draft.phone,
      timezone: draft.timezone,
      currency: draft.currency,
    };
    const saved = await persist(
      isEditing
        ? { operation: "UPDATE_BASIC", ...basicFields }
        : { ...basicFields, slug: draft.slug },
      "basic",
    );
    if (saved) setSavedDraft((current) => ({ ...current, ...basicFields }));
  }

  async function submitOperations(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isEditing) return;

    let confirmation: "DEACTIVATE" | undefined;
    if (draft.isActive === false) {
      const confirmed = window.confirm(label("確定停用此攤位？顧客與工作人員將無法進入，但歷史資料會保留。"));
      if (!confirmed) return;
      confirmation = "DEACTIVATE";
    }

    const saved = await persist({
      operation: "UPDATE_OPERATIONS",
      businessStatus: draft.businessStatus,
      orderingEnabled: draft.orderingEnabled,
      isActive: draft.isActive,
      confirmation,
    }, "operations");
    if (saved) setSavedDraft((current) => ({
      ...current,
      businessStatus: draft.businessStatus,
      orderingEnabled: draft.orderingEnabled,
      isActive: draft.isActive,
    }));
  }

  async function uploadCoverImage(file: File) {
    if (!stallId) return;
    const form = new FormData();
    form.set("image", file);
    setUploadingCover(true);
    setMessage("basic", "", null);
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/cover-image`, {
        method: "POST",
        headers: csrfFormHeaders(),
        body: form,
      });
      const payload = await response.json() as { imageUrl?: string; positionX?: number; positionY?: number; zoom?: number; error?: string };
      if (!response.ok || !payload.imageUrl) throw new Error(payload.error ?? label("圖片上傳失敗。"));
      const cover = {
        coverImageUrl: payload.imageUrl,
        coverImagePositionX: payload.positionX ?? 50,
        coverImagePositionY: payload.positionY ?? 50,
        coverImageZoom: payload.zoom ?? 100,
      };
      setDraft((current) => ({ ...current, ...cover }));
      setSavedDraft((current) => ({ ...current, ...cover }));
      setMessage("basic", label("線上 Menu 文宣圖片已更新。"), "success");
      router.refresh();
    } catch (error) {
      setMessage("basic", error instanceof Error ? error.message : label("圖片上傳失敗。"));
    } finally {
      setUploadingCover(false);
    }
  }

  function updateCoverCrop(key: "coverImagePositionX" | "coverImagePositionY" | "coverImageZoom", value: number) {
    setDraft((current) => ({ ...current, [key]: Math.round(value) }));
  }

  function moveCoverFocus(event: React.PointerEvent<HTMLDivElement>) {
    if (!(event.buttons & 1)) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateCoverCrop("coverImagePositionX", clamp(((event.clientX - bounds.left) / bounds.width) * 100, 0, 100));
    updateCoverCrop("coverImagePositionY", clamp(((event.clientY - bounds.top) / bounds.height) * 100, 0, 100));
  }

  async function saveCoverCrop() {
    if (!stallId || !draft.coverImageUrl) return;
    setSavingCoverCrop(true);
    setMessage("basic", "", null);
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/cover-image`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify({
          positionX: coverPosition(draft, "x"),
          positionY: coverPosition(draft, "y"),
          zoom: coverZoom(draft),
        }),
      });
      const payload = await response.json() as { positionX?: number; positionY?: number; zoom?: number; error?: string };
      if (!response.ok) throw new Error(payload.error ?? label("圖片顯示範圍儲存失敗。"));
      const cover = {
        coverImagePositionX: payload.positionX ?? coverPosition(draft, "x"),
        coverImagePositionY: payload.positionY ?? coverPosition(draft, "y"),
        coverImageZoom: payload.zoom ?? coverZoom(draft),
      };
      setDraft((current) => ({ ...current, ...cover }));
      setSavedDraft((current) => ({ ...current, ...cover }));
      setMessage("basic", label("文宣圖片顯示範圍已更新。"), "success");
      router.refresh();
    } catch (error) {
      setMessage("basic", error instanceof Error ? error.message : label("圖片顯示範圍儲存失敗。"));
    } finally {
      setSavingCoverCrop(false);
    }
  }

  async function removeCoverImage() {
    if (!stallId || !draft.coverImageUrl || !window.confirm(label("確定移除文宣圖片？"))) return;
    setRemovingCover(true);
    setMessage("basic", "", null);
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/cover-image`, {
        method: "DELETE",
        headers: csrfHeaders(),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? label("文宣圖片移除失敗。"));
      const cover = {
        coverImageUrl: null,
        coverImagePositionX: 50,
        coverImagePositionY: 50,
        coverImageZoom: 100,
      };
      setDraft((current) => ({ ...current, ...cover }));
      setSavedDraft((current) => ({ ...current, ...cover }));
      setMessage("basic", label("文宣圖片已移除。"), "success");
      router.refresh();
    } catch (error) {
      setMessage("basic", error instanceof Error ? error.message : label("文宣圖片移除失敗。"));
    } finally {
      setRemovingCover(false);
    }
  }

  async function uploadLocationGuideImage(file: File) {
    if (!stallId) return;
    const form = new FormData();
    form.set("image", file);
    setUploadingLocationGuide(true);
    setMessage("basic", "", null);
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/cover-image?slot=location-guide`, {
        method: "POST",
        headers: csrfFormHeaders(),
        body: form,
      });
      const payload = await response.json() as { imageUrl?: string; error?: string };
      if (!response.ok || !payload.imageUrl) {
        throw new Error(payload.error ?? label("地點指引圖上傳失敗。"));
      }
      setDraft((current) => ({ ...current, locationGuideImageUrl: payload.imageUrl }));
      setSavedDraft((current) => ({ ...current, locationGuideImageUrl: payload.imageUrl }));
      setMessage("basic", label("地點指引圖已更新。"), "success");
      router.refresh();
    } catch (error) {
      setMessage("basic", error instanceof Error ? error.message : label("地點指引圖上傳失敗。"));
    } finally {
      setUploadingLocationGuide(false);
    }
  }

  async function removeLocationGuideImage() {
    if (!stallId || !draft.locationGuideImageUrl || !window.confirm(label("確定移除地點指引圖？"))) return;
    setRemovingLocationGuide(true);
    setMessage("basic", "", null);
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/cover-image?slot=location-guide`, {
        method: "DELETE",
        headers: csrfHeaders(),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? label("地點指引圖移除失敗。"));
      setDraft((current) => ({ ...current, locationGuideImageUrl: null }));
      setSavedDraft((current) => ({ ...current, locationGuideImageUrl: null }));
      setMessage("basic", label("地點指引圖已移除。"), "success");
      router.refresh();
    } catch (error) {
      setMessage("basic", error instanceof Error ? error.message : label("地點指引圖移除失敗。"));
    } finally {
      setRemovingLocationGuide(false);
    }
  }

  return (
    <div className="border-t border-stone-200">
      {section !== "operations" ? <section aria-labelledby="stall-basic-heading" data-settings-section data-settings-scope="stall-basic" data-settings-search={label("基本資料 名稱 代碼 說明 地址 電話 時區 幣別")} className="border-b border-stone-200 data-[dirty=true]:border-l-2 data-[dirty=true]:border-l-amber-500">
        <div className="flex min-h-14 items-center gap-3 py-3 text-left">
          <Store aria-hidden="true" className="h-5 w-5 shrink-0 text-teal-700" />
          <div className="min-w-0 flex-1">
            <h2 id="stall-basic-heading" className="text-lg font-semibold">{label("基本資料")}</h2>
            {basicDirty ? <p className="mt-1 text-sm text-stone-600">{label("有尚未儲存的變更")}</p> : null}
          </div>
        </div>
        <form ref={basicFormRef} noValidate onSubmit={submitBasic} className="pb-7">
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label={label("攤位名稱")} field="name" error={fieldErrors.name}><input {...fieldValidationProps("name", fieldErrors.name)} type="text" value={draft.name} onChange={(event) => update("name", event.target.value)} required maxLength={80} className={inputClass(fieldErrors.name)} /></Field>
            <Field label={label("攤位代碼")} field="code" error={fieldErrors.code}>
              <input
                {...fieldValidationProps("code", fieldErrors.code, isEditing ? "stall-code-immutable-hint" : undefined)}
                type="text"
                value={draft.code}
                onChange={(event) => update("code", event.target.value.toUpperCase())}
                readOnly={isEditing}
                required
                maxLength={PUBLIC_IDENTIFIER_MAX_LENGTH}
                pattern="[A-Za-z0-9-]+"
                className={`${inputClass(fieldErrors.code)} uppercase read-only:cursor-not-allowed read-only:bg-stone-100 read-only:text-stone-600`}
              />
              {isEditing ? (
                <span id="stall-code-immutable-hint" className="mt-1.5 block text-xs leading-5 text-stone-600">
                  {label("為確保公開商店網址穩定，攤位建立後代碼即鎖定；如需更正，請聯絡平台管理員。")}
                </span>
              ) : null}
            </Field>
            {!isEditing ? (
              <Field label={label("公開識別名稱")} field="slug" error={fieldErrors.slug} full>
                <PublicIdentifierInputHint hintId="new-stall-public-identifier-rules">
                  <input type="text"
                    {...fieldValidationProps("slug", fieldErrors.slug, "new-stall-public-identifier-rules")}
                    value={draft.slug ?? ""}
                    onChange={(event) => update("slug", event.target.value.toLowerCase())}
                    required
                    minLength={PUBLIC_IDENTIFIER_MIN_LENGTH}
                    maxLength={PUBLIC_IDENTIFIER_MAX_LENGTH}
                    pattern={PUBLIC_IDENTIFIER_PATTERN}
                    className={inputClass(fieldErrors.slug)}
                  />
                </PublicIdentifierInputHint>
              </Field>
            ) : null}
            <Field label={label("說明")} field="description" error={fieldErrors.description} full><textarea {...fieldValidationProps("description", fieldErrors.description)} value={draft.description} onChange={(event) => update("description", event.target.value)} maxLength={500} rows={3} className={`${inputClass(fieldErrors.description)} resize-y`} /></Field>
            <Field label={label("地址")} field="address" error={fieldErrors.address} full><input {...fieldValidationProps("address", fieldErrors.address)} type="text" value={draft.address} onChange={(event) => update("address", event.target.value)} required maxLength={200} className={inputClass(fieldErrors.address)} /></Field>
            <Field label={label("電話")} field="phone" error={fieldErrors.phone}><input {...fieldValidationProps("phone", fieldErrors.phone)} type="tel" inputMode="tel" value={draft.phone} onChange={(event) => update("phone", event.target.value)} maxLength={30} pattern={PHONE_INPUT_PATTERN} autoComplete="tel" className={inputClass(fieldErrors.phone)} /></Field>
            <Field label={label("時區")} field="timezone" error={fieldErrors.timezone}><select {...fieldValidationProps("timezone", fieldErrors.timezone)} value={draft.timezone} onChange={(event) => update("timezone", event.target.value)} className={`${inputClass(fieldErrors.timezone)} bg-white`}><option value="Asia/Taipei">Asia/Taipei</option><option value="Asia/Tokyo">Asia/Tokyo</option><option value="Asia/Hong_Kong">Asia/Hong_Kong</option></select></Field>
            <Field label={label("幣別")} field="currency" error={fieldErrors.currency}><select {...fieldValidationProps("currency", fieldErrors.currency)} value={draft.currency} onChange={(event) => update("currency", event.target.value)} className={`${inputClass(fieldErrors.currency)} bg-white`}><option value="TWD">TWD</option><option value="JPY">JPY</option><option value="HKD">HKD</option></select></Field>
            {isEditing ? <div className="sm:col-span-2">
              <p className="text-sm font-medium">{label("線上 Menu 文宣圖片")}</p>
              <p className="mt-1 text-xs leading-5 text-stone-500">{label("支援 JPG、PNG、WebP，系統會自動壓縮並依手機、平板與電腦寬度裁切顯示。")}</p>
              {draft.coverImageUrl ? <>
                <div
                  className="relative mt-3 aspect-[3/1] max-h-64 touch-none select-none overflow-hidden rounded-md border border-stone-300 bg-stone-100 sm:aspect-[16/5]"
                  onPointerDown={moveCoverFocus}
                  onPointerMove={moveCoverFocus}
                >
                  <ProductImage
                    src={draft.coverImageUrl}
                    alt={label("線上 Menu 文宣圖片預覽")}
                    width={1200}
                    height={400}
                    sizes="(min-width: 640px) 800px, 100vw"
                    className="pointer-events-none h-full w-full object-cover"
                    style={coverImageStyle(draft)}
                  />
                  <span className="pointer-events-none absolute bottom-2 left-2 inline-flex items-center gap-1 rounded bg-black/65 px-2 py-1 text-xs font-semibold text-white"><Move className="h-3.5 w-3.5" />{label("拖曳選擇圖片顯示重點")}</span>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <CoverRange label={label("水平位置")} value={coverPosition(draft, "x")} min={0} max={100} onChange={(value) => updateCoverCrop("coverImagePositionX", value)} />
                  <CoverRange label={label("垂直位置")} value={coverPosition(draft, "y")} min={0} max={100} onChange={(value) => updateCoverCrop("coverImagePositionY", value)} />
                  <CoverRange label={label("圖片縮放")} value={coverZoom(draft)} min={100} max={200} suffix="%" onChange={(value) => updateCoverCrop("coverImageZoom", value)} />
                </div>
              </> : null}
              <div className="mt-3 flex flex-wrap gap-2">
              <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold">
                <ImageUp className="h-4 w-4" />
                {uploadingCover ? label("上傳中...") : label("上傳文宣圖片")}
                <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={uploadingCover || savingCoverCrop || removingCover || savingSection !== null} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadCoverImage(file); event.currentTarget.value = ""; }} />
              </label>
              {draft.coverImageUrl ? <>
                <button type="button" disabled={!coverCropDirty || savingCoverCrop || removingCover} onClick={() => void saveCoverCrop()} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-teal-800 px-3 text-sm font-semibold text-white disabled:opacity-40"><Save className="h-4 w-4" />{savingCoverCrop ? label("儲存中...") : label("儲存圖片範圍")}</button>
                <button type="button" disabled={removingCover || savingCoverCrop} onClick={() => void removeCoverImage()} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-red-300 px-3 text-sm font-semibold text-red-700 disabled:opacity-40"><Trash2 className="h-4 w-4" />{removingCover ? label("移除中...") : label("移除文宣圖片")}</button>
              </> : null}
              </div>
            </div> : null}
            {isEditing ? <div className="border-t border-stone-200 pt-5 sm:col-span-2">
              <div className="flex items-start gap-3">
                <MapPinned className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium">{label("Menu 地點指引圖")}</p>
                  <p className="mt-1 text-xs leading-5 text-stone-500">{label("可上傳店面照、入口照片或步行指引圖；顧客點選 Menu 的地圖按鈕後會在置中視窗查看。")}</p>
                </div>
              </div>
              {draft.locationGuideImageUrl ? (
                <div className="mt-3 max-w-xl overflow-hidden rounded-md border border-stone-300 bg-stone-100">
                  <ProductImage
                    src={draft.locationGuideImageUrl}
                    alt={label("店面與地點指引圖預覽")}
                    width={960}
                    height={720}
                    sizes="(min-width: 640px) 576px, 100vw"
                    className="h-auto max-h-96 w-full object-contain"
                  />
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold">
                  <ImageUp className="h-4 w-4" />
                  {uploadingLocationGuide ? label("上傳中...") : label("上傳地點指引圖")}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    disabled={uploadingLocationGuide || removingLocationGuide || savingSection !== null}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void uploadLocationGuideImage(file);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                {draft.locationGuideImageUrl ? (
                  <button
                    type="button"
                    disabled={uploadingLocationGuide || removingLocationGuide}
                    onClick={() => void removeLocationGuideImage()}
                    className="inline-flex min-h-10 items-center gap-2 rounded-md border border-red-300 px-3 text-sm font-semibold text-red-700 disabled:opacity-40"
                  >
                    <Trash2 className="h-4 w-4" />
                    {removingLocationGuide ? label("移除中...") : label("移除地點指引圖")}
                  </button>
                ) : null}
              </div>
            </div> : null}
          </div>
          {messages.basic ? <p role={messageKinds.basic === "success" ? "status" : "alert"} className={messageKinds.basic === "success" ? "mt-4 text-sm text-emerald-700" : "mt-4 text-sm text-red-700"}>{messages.basic}</p> : null}
          <button type="submit" disabled={savingSection !== null} className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-stone-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {isEditing ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {savingSection === "basic" ? label("儲存中...") : isEditing ? label("儲存基本資料") : label("建立攤位")}
          </button>
        </form>
      </section> : null}

      {isEditing && section !== "basic" ? (
        <section aria-labelledby="stall-operations-heading" data-settings-section data-settings-scope="stall-operations" data-settings-search={label("營運狀態 營業 顧客點餐 啟用 攤位")} className="border-b border-stone-200 data-[dirty=true]:border-l-2 data-[dirty=true]:border-l-amber-500">
          <div className="flex min-h-14 items-center gap-3 py-3 text-left">
            <Activity aria-hidden="true" className="h-5 w-5 shrink-0 text-teal-700" />
            <div className="min-w-0 flex-1">
              <h2 id="stall-operations-heading" className="text-lg font-semibold">{label("營運狀態")}</h2>
              {operationsDirty ? <p className="mt-1 text-sm text-stone-600">{label("有尚未儲存的變更")}</p> : null}
            </div>
          </div>
          <form ref={operationsFormRef} noValidate onSubmit={submitOperations} className="pb-7">
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium">{label("營業狀態")}<select value={draft.businessStatus} onChange={(event) => update("businessStatus", event.target.value as StallDraft["businessStatus"])} className="mt-1.5 h-11 w-full rounded-md border border-stone-300 bg-white px-3"><option value="OPEN">{label("營業中")}</option><option value="PAUSED">{label("暫停")}</option><option value="CLOSED">{label("關閉")}</option><option value="SOLD_OUT">{label("全攤售罄")}</option></select></label>
              <div className="space-y-3 pt-1 sm:pt-6">
                <label className="flex min-h-11 items-center gap-3 text-sm font-medium"><input type="checkbox" checked={draft.orderingEnabled} onChange={(event) => update("orderingEnabled", event.target.checked)} className="h-5 w-5" />{label("允許顧客點餐")}</label>
                <label className="flex min-h-11 items-center gap-3 text-sm font-medium text-red-800"><input type="checkbox" checked={draft.isActive} onChange={(event) => update("isActive", event.target.checked)} className="h-5 w-5" />{label("啟用此攤位")}</label>
              </div>
            </div>
            {messages.operations ? <p role={messageKinds.operations === "success" ? "status" : "alert"} className={messageKinds.operations === "success" ? "mt-4 text-sm text-emerald-700" : "mt-4 text-sm text-red-700"}>{messages.operations}</p> : null}
            <button type="submit" disabled={savingSection !== null} className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-stone-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              <Save className="h-4 w-4" />
              {savingSection === "operations" ? label("儲存中...") : label("儲存營運狀態")}
            </button>
          </form>
        </section>
      ) : null}
    </div>
  );
}

function Field({ label, field, error, full = false, children }: {
  label: string;
  field: string;
  error?: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return <label className={`text-sm font-medium ${full ? "sm:col-span-2" : ""}`}><span>{label}</span>{children}{error ? <span id={fieldErrorId(field)} role="alert" className="mt-1.5 block text-xs font-medium text-red-700">{error}</span> : null}</label>;
}

function fieldErrorId(field: string) {
  return `stall-${field}-error`;
}

function fieldValidationProps(field: string, error?: string, describedBy?: string) {
  return {
    name: field,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": [describedBy, error ? fieldErrorId(field) : null].filter(Boolean).join(" ") || undefined,
  };
}

function inputClass(error?: string) {
  return `mt-1.5 min-h-11 w-full rounded-md border px-3 py-2.5 ${error ? "border-red-500 bg-red-50" : "border-stone-300"}`;
}

function parseFieldErrors(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => (
    typeof entry[1] === "string" && Boolean(entry[1].trim())
  )));
}

function focusFirstInvalidField(form: HTMLFormElement | null, fieldErrors: Record<string, string>) {
  const field = Object.keys(fieldErrors)[0];
  if (!field) return;
  requestAnimationFrame(() => {
    const control = form?.elements.namedItem(field);
    if (control instanceof HTMLElement) control.focus();
  });
}

function coverPosition(draft: StallDraft, axis: "x" | "y") {
  return clamp(axis === "x" ? draft.coverImagePositionX ?? 50 : draft.coverImagePositionY ?? 50, 0, 100);
}

function coverZoom(draft: StallDraft) {
  return clamp(draft.coverImageZoom ?? 100, 100, 200);
}

function coverImageStyle(draft: StallDraft) {
  const x = coverPosition(draft, "x");
  const y = coverPosition(draft, "y");
  return {
    objectPosition: `${x}% ${y}%`,
    transform: `scale(${coverZoom(draft) / 100})`,
    transformOrigin: `${x}% ${y}%`,
  };
}

function CoverRange({ label, value, min, max, suffix = "", onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return <label className="text-xs font-medium text-stone-700"><span className="flex justify-between"><span>{label}</span><span>{value}{suffix}</span></span><input type="range" min={min} max={max} step={1} value={value} onChange={(event) => onChange(Number(event.target.value))} className="mt-1 w-full accent-teal-700" /></label>;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

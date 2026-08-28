"use client";

import { ExternalLink, MapPin, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ProductImage } from "@/components/product-image";
import type { AppLocale } from "@/lib/app-locale";

type Props = {
  stallName: string;
  location: string;
  address: string;
  guideImageUrl: string | null;
  googleMapsEmbedUrl: string | null;
  googleMapsNavigationUrl: string;
  locale: AppLocale;
};

const COPY: Record<AppLocale, {
  button: string;
  title: string;
  guideImage: string;
  map: string;
  mapUnavailable: string;
  navigation: string;
  close: string;
}> = {
  "zh-TW": {
    button: "查看地圖與店面指引",
    title: "店面位置與抵達指引",
    guideImage: "店面或抵達指引圖",
    map: "Google 地圖",
    mapUnavailable: "小地圖尚未設定，仍可使用下方按鈕開啟 Google 地圖導航。",
    navigation: "開啟 Google 地圖導航",
    close: "關閉",
  },
  en: {
    button: "Map & directions",
    title: "Location and directions",
    guideImage: "Storefront or arrival guide",
    map: "Google Maps",
    mapUnavailable: "The mini map is not configured. Use the button below to open Google Maps.",
    navigation: "Open Google Maps",
    close: "Close",
  },
  ja: {
    button: "地図・店舗案内",
    title: "店舗の場所とアクセス案内",
    guideImage: "店舗またはアクセス案内画像",
    map: "Google マップ",
    mapUnavailable: "ミニマップは未設定です。下のボタンから Google マップを開けます。",
    navigation: "Google マップを開く",
    close: "閉じる",
  },
  ko: {
    button: "지도 및 매장 안내",
    title: "매장 위치 및 방문 안내",
    guideImage: "매장 또는 방문 안내 이미지",
    map: "Google 지도",
    mapUnavailable: "미니 지도가 설정되지 않았습니다. 아래 버튼으로 Google 지도를 여세요.",
    navigation: "Google 지도 열기",
    close: "닫기",
  },
  vi: {
    button: "Bản đồ và chỉ dẫn",
    title: "Vị trí và chỉ dẫn đến cửa hàng",
    guideImage: "Hình cửa hàng hoặc hình chỉ dẫn",
    map: "Google Maps",
    mapUnavailable: "Bản đồ nhỏ chưa được thiết lập. Hãy dùng nút bên dưới để mở Google Maps.",
    navigation: "Mở Google Maps",
    close: "Đóng",
  },
  th: {
    button: "แผนที่และเส้นทาง",
    title: "ที่ตั้งร้านและเส้นทาง",
    guideImage: "ภาพหน้าร้านหรือภาพแนะนำเส้นทาง",
    map: "Google Maps",
    mapUnavailable: "ยังไม่ได้ตั้งค่าแผนที่ขนาดเล็ก ใช้ปุ่มด้านล่างเพื่อเปิด Google Maps",
    navigation: "เปิด Google Maps",
    close: "ปิด",
  },
};

export function LocationGuideDialog({
  stallName,
  location,
  address,
  guideImageUrl,
  googleMapsEmbedUrl,
  googleMapsNavigationUrl,
  locale,
}: Props) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const copy = COPY[locale];

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), a[href], iframe, [tabindex]:not([tabindex='-1'])",
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/55 bg-white/15 px-4 py-2 text-sm font-bold text-white shadow-sm backdrop-blur transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white print:hidden"
      >
        <MapPin className="h-4 w-4" aria-hidden="true" />
        {copy.button}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[100] grid place-items-center bg-black/65 p-3 backdrop-blur-sm sm:p-6"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setOpen(false);
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="location-guide-title"
            className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white text-stone-950 shadow-2xl sm:max-h-[calc(100dvh-3rem)]"
          >
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-stone-200 px-4 py-4 sm:px-6">
              <div className="min-w-0">
                <h2 id="location-guide-title" className="text-lg font-bold sm:text-xl">{copy.title}</h2>
                <p className="mt-1 truncate text-sm font-semibold text-teal-800">{stallName}</p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label={copy.close}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-stone-300 bg-white hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
              <div className="rounded-xl bg-stone-100 p-4">
                <p className="font-semibold">{location}</p>
                {address && address !== location ? <p className="mt-1 text-sm text-stone-700">{address}</p> : null}
              </div>

              {guideImageUrl ? (
                <section aria-labelledby="location-guide-image-title">
                  <h3 id="location-guide-image-title" className="mb-2 text-sm font-bold text-stone-700">{copy.guideImage}</h3>
                  <ProductImage
                    src={guideImageUrl}
                    alt={`${stallName} ${copy.guideImage}`}
                    width={1200}
                    height={800}
                    sizes="(min-width: 672px) 624px, calc(100vw - 56px)"
                    className="max-h-[48dvh] w-full rounded-xl border border-stone-200 object-contain"
                  />
                </section>
              ) : null}

              <section aria-labelledby="location-guide-map-title">
                <h3 id="location-guide-map-title" className="mb-2 text-sm font-bold text-stone-700">{copy.map}</h3>
                {googleMapsEmbedUrl ? (
                  <iframe
                    title={`${stallName} ${copy.map}`}
                    src={googleMapsEmbedUrl}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                    className="h-64 w-full rounded-xl border border-stone-200 sm:h-72"
                    allowFullScreen
                  />
                ) : (
                  <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
                    {copy.mapUnavailable}
                  </p>
                )}
                <a
                  href={googleMapsNavigationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-2 text-center text-sm font-bold text-white hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2"
                >
                  {copy.navigation}
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                </a>
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

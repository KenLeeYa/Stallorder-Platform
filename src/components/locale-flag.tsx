import Image from "next/image";
import type { QrLocale } from "@/lib/qr-order-i18n";

const localeFlagPaths: Record<QrLocale, string> = {
  "zh-TW": "/flags/tw.svg",
  en: "/flags/us.svg",
  ja: "/flags/jp.svg",
  ko: "/flags/kr.svg",
  vi: "/flags/vn.svg",
  th: "/flags/th.svg",
};

export function LocaleFlag({ locale, className = "h-3.5 w-5" }: { locale: QrLocale; className?: string }) {
  return <Image data-locale-flag={locale} src={localeFlagPaths[locale]} alt="" width={20} height={14} className={`${className} shrink-0 rounded-[2px] border border-black/10 object-cover`} />;
}

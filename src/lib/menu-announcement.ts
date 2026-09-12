import { z } from "zod";

export const menuAnnouncementSchema = z.object({
  enabled: z.boolean(),
  title: z.string().trim().max(80),
  content: z.string().trim().max(2000),
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
  expectedRevision: z.uuid().nullable(),
}).strict().superRefine((value, context) => {
  if (value.enabled && (!value.title || !value.content)) {
    context.addIssue({ code: "custom", message: "開啟公告前請填寫標題與內容。" });
  }
  if (value.startsAt && value.endsAt && value.endsAt <= value.startsAt) {
    context.addIssue({ code: "custom", message: "公告結束時間必須晚於開始時間。" });
  }
});
export type MenuAnnouncementView = {
  stallId: string; enabled: boolean; title: string; content: string;
  startsAt: string | null; endsAt: string | null; revision: string;
};
export function serializeMenuAnnouncement(value: {
  stallId: string; enabled: boolean; title: string; content: string;
  startsAt: Date | null; endsAt: Date | null; revision: string;
}): MenuAnnouncementView {
  return { ...value, startsAt: value.startsAt?.toISOString() ?? null, endsAt: value.endsAt?.toISOString() ?? null };
}
export function activeMenuAnnouncement(value: MenuAnnouncementView | null, now = Date.now()) {
  return Boolean(value?.enabled && value.title && value.content
    && (!value.startsAt || Date.parse(value.startsAt) <= now)
    && (!value.endsAt || Date.parse(value.endsAt) > now));
}
export const menuNoticeLabels = {
  "zh-TW": { title: "店家公告", view: "查看店家公告", close: "關閉公告", dismiss: "我知道了" },
  en: { title: "Store announcement", view: "View announcement", close: "Close announcement", dismiss: "Got it" },
  ja: { title: "店舗のお知らせ", view: "お知らせを見る", close: "お知らせを閉じる", dismiss: "確認しました" },
  ko: { title: "매장 공지", view: "공지 보기", close: "공지 닫기", dismiss: "확인" },
  vi: { title: "Thông báo cửa hàng", view: "Xem thông báo", close: "Đóng thông báo", dismiss: "Đã hiểu" },
  th: { title: "ประกาศร้านค้า", view: "ดูประกาศ", close: "ปิดประกาศ", dismiss: "เข้าใจแล้ว" },
} as const;

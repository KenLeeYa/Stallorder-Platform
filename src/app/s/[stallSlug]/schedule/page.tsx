import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, Clock3, MapPin, Megaphone, Navigation, Store } from "lucide-react";
import { getPublicStallSchedule } from "@/lib/stall-schedules";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ stallSlug: string }> };

export default async function PublicStallSchedulePage({ params }: PageProps) {
  const { stallSlug } = await params;
  const data = await getPublicStallSchedule(stallSlug);
  if (!data) notFound();

  const now = new Date(data.generatedAt);
  const todayKey = localDateKey(now, data.stall.timezone);
  const visible = data.schedules.filter((schedule) => schedule.status !== "CANCELLED");
  const current = visible.find((schedule) => (
    schedule.status === "OPEN"
    && Date.parse(schedule.startsAt) <= now.getTime()
    && Date.parse(schedule.endsAt) > now.getTime()
  ));
  const today = visible.filter((schedule) => (
    localDateKey(new Date(schedule.startsAt), data.stall.timezone) === todayKey
    || localDateKey(new Date(schedule.endsAt), data.stall.timezone) === todayKey
  ));
  const next = visible.find((schedule) => Date.parse(schedule.startsAt) > now.getTime());

  return (
    <main className="min-h-screen bg-stone-50 text-stone-950">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto max-w-3xl px-4 py-7 md:px-8">
          <div className="flex items-center gap-3 text-teal-800"><Store className="h-7 w-7" /><span className="text-sm font-semibold">攤點通</span></div>
          <h1 className="mt-3 text-3xl font-semibold">{data.stall.name} 出攤行程</h1>
          <p className="mt-2 text-sm text-stone-600">時間依 {data.stall.timezone} 顯示</p>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-8 px-4 py-7 md:px-8">
        <section aria-labelledby="current-location-title">
          <h2 id="current-location-title" className="flex items-center gap-2 text-xl font-semibold"><MapPin className="h-5 w-5 text-teal-700" />今天在哪裡</h2>
          {current ? <ScheduleCard schedule={current} timezone={data.stall.timezone} emphasis /> : today.length > 0 ? (
            <div className="mt-4 space-y-3">{today.map((schedule) => <ScheduleCard key={scheduleKey(schedule)} schedule={schedule} timezone={data.stall.timezone} />)}</div>
          ) : <p className="mt-4 border-y border-stone-200 py-6 text-sm text-stone-600">今天沒有公開的出攤行程。</p>}
        </section>

        <section aria-labelledby="next-schedule-title">
          <h2 id="next-schedule-title" className="flex items-center gap-2 text-xl font-semibold"><CalendarDays className="h-5 w-5 text-teal-700" />下一次出攤</h2>
          {next ? <ScheduleCard schedule={next} timezone={data.stall.timezone} /> : <p className="mt-4 border-y border-stone-200 py-6 text-sm text-stone-600">目前尚未公布下一次行程。</p>}
        </section>

        {visible.length > 0 ? (
          <section aria-labelledby="all-schedules-title">
            <h2 id="all-schedules-title" className="text-xl font-semibold">近期行程</h2>
            <div className="mt-4 divide-y divide-stone-200 border-y border-stone-200">
              {visible.slice(0, 12).map((schedule) => <ScheduleRow key={scheduleKey(schedule)} schedule={schedule} timezone={data.stall.timezone} />)}
            </div>
          </section>
        ) : null}

        <Link href={`/s/${data.stall.slug}`} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-teal-800">返回攤位資訊</Link>
      </div>
    </main>
  );
}

type PublicSchedule = NonNullable<Awaited<ReturnType<typeof getPublicStallSchedule>>>["schedules"][number];

function ScheduleCard({ schedule, timezone, emphasis = false }: { schedule: PublicSchedule; timezone: string; emphasis?: boolean }) {
  const place = schedule.location?.name ?? schedule.event?.venueName ?? "地點待公告";
  const address = schedule.location?.address ?? schedule.event?.address;
  const mapUrl = schedule.location?.mapUrl ?? coordinateMapUrl(schedule.location);
  return (
    <article className={`mt-4 rounded-md border p-5 ${emphasis ? "border-teal-600 bg-teal-50" : "border-stone-200 bg-white"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="font-semibold">{schedule.event?.name ?? place}</p><p className="mt-1 text-sm text-stone-600">{place}</p></div>
        <Status status={schedule.status} />
      </div>
      <p className="mt-4 flex items-start gap-2 text-sm"><Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-stone-500" />{formatRange(schedule.startsAt, schedule.endsAt, timezone)}</p>
      {address ? <p className="mt-2 flex items-start gap-2 text-sm"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-stone-500" />{address}</p> : null}
      {schedule.specialNotice ? <p className="mt-3 flex items-start gap-2 border-t border-stone-200 pt-3 text-sm"><Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />{schedule.specialNotice}</p> : null}
      {mapUrl ? <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-teal-800"><Navigation className="h-4 w-4" />開啟地圖導航</a> : null}
    </article>
  );
}

function ScheduleRow({ schedule, timezone }: { schedule: PublicSchedule; timezone: string }) {
  return <article className="grid gap-2 py-4 sm:grid-cols-[150px_1fr_auto] sm:items-center"><time className="text-sm font-semibold">{formatDateTime(schedule.startsAt, timezone)}</time><div><p className="font-semibold">{schedule.event?.name ?? schedule.location?.name ?? "出攤行程"}</p><p className="mt-1 text-sm text-stone-500">{schedule.location?.address ?? schedule.event?.address ?? "地點待公告"}</p></div><Status status={schedule.status} /></article>;
}

function Status({ status }: { status: PublicSchedule["status"] }) {
  const labels = { SCHEDULED: "預定", OPEN: "營業中", DELAYED: "延遲", CANCELLED: "取消", COMPLETED: "已結束" } as const;
  return <span className={`text-sm font-semibold ${status === "OPEN" ? "text-teal-800" : status === "DELAYED" ? "text-amber-700" : "text-stone-500"}`}>{labels[status]}</span>;
}

function formatRange(start: string, end: string, timezone: string) {
  const date = new Intl.DateTimeFormat("zh-TW", { timeZone: timezone, month: "numeric", day: "numeric", weekday: "short" }).format(new Date(start));
  const time = new Intl.DateTimeFormat("zh-TW", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date} ${time.format(new Date(start))}～${time.format(new Date(end))}`;
}

function formatDateTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("zh-TW", { timeZone: timezone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function localDateKey(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function coordinateMapUrl(location: PublicSchedule["location"]) {
  if (!location || location.latitude === null || location.longitude === null) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${location.latitude},${location.longitude}`)}`;
}

function scheduleKey(schedule: PublicSchedule) {
  return `${schedule.startsAt}:${schedule.location?.name ?? ""}:${schedule.event?.slug ?? ""}`;
}

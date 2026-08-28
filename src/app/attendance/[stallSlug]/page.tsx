import Link from "next/link";
import { notFound } from "next/navigation";
import { EmployeeAttendance } from "@/components/employee-attendance";
import { requirePagePermission } from "@/lib/authorization";
import { AttendanceError, getEmployeeAttendanceSnapshot } from "@/server/attendance/attendance-service";

type PageProps = { params: Promise<{ stallSlug: string }> };

export default async function AttendancePage({ params }: PageProps) {
  const { stallSlug } = await params;
  const authorization = await requirePagePermission(
    stallSlug,
    "USE_ATTENDANCE",
    `/attendance/${stallSlug}`,
  );
  let data: Awaited<ReturnType<typeof getEmployeeAttendanceSnapshot>> | null = null;
  let loadError: unknown = null;
  try {
    data = await getEmployeeAttendanceSnapshot({
      organizationId: authorization.stall.organizationId,
      stallId: authorization.stall.id,
      profileId: authorization.principal.user.id,
      sessionId: authorization.principal.sessionId,
      timezone: authorization.stall.timezone,
    });
  } catch (error) {
    loadError = error;
  }
  const returnHref = authorization.role === "KITCHEN"
    ? `/kitchen?stall=${encodeURIComponent(stallSlug)}`
    : `/staff/${encodeURIComponent(stallSlug)}`;

  if (loadError) {
    if (!(loadError instanceof AttendanceError)
      || !["ATTENDANCE_DISABLED", "ATTENDANCE_POLICY_INCOMPLETE"].includes(loadError.code)) {
      notFound();
    }
    return (
      <main className="grid min-h-screen place-items-center bg-stone-50 p-4">
        <section className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-2xl font-semibold">目前無法使用定位打卡</h1>
          <p className="mt-3 text-sm leading-6 text-stone-600">
            {loadError.code === "ATTENDANCE_DISABLED"
              ? "店家尚未啟用員工定位打卡。"
              : "店家的打卡位置尚未設定完成。"}
          </p>
          <Link href={returnHref} className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-md bg-teal-800 px-4 font-semibold text-white">
            返回工作介面
          </Link>
        </section>
      </main>
    );
  }
  if (!data) notFound();

  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-stone-50 px-4 py-6 sm:px-6 sm:py-8">
      <Link href={returnHref} className="inline-flex min-h-11 items-center text-sm font-semibold text-teal-800">
        ← 返回工作介面
      </Link>
      <header className="mt-3 border-b border-stone-200 pb-5">
        <p className="text-sm font-semibold text-teal-800">{authorization.stall.name}</p>
        <h1 className="mt-1 text-3xl font-semibold">員工定位打卡</h1>
        <p className="mt-2 text-sm text-stone-600">{authorization.principal.user.displayName}</p>
      </header>
      <div className="py-6">
        <EmployeeAttendance stallSlug={stallSlug} initialData={data} />
      </div>
    </main>
  );
}

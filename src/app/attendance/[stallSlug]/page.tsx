import Link from "next/link";
import { notFound } from "next/navigation";
import { EmployeeAttendance } from "@/components/employee-attendance";
import { EmployeeWorkforcePanel } from "@/components/employee-workforce-panel";
import { requirePagePermission } from "@/lib/authorization";
import { AttendanceError, getEmployeeAttendanceSnapshot } from "@/server/attendance/attendance-service";
import { getEmployeeWorkforceSnapshot } from "@/server/workforce/workforce-service";

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
  const attendanceError = loadError instanceof AttendanceError ? loadError : null;

  if (loadError) {
    if (!attendanceError
      || !["ATTENDANCE_DISABLED", "ATTENDANCE_POLICY_INCOMPLETE"].includes(attendanceError.code)) {
      notFound();
    }
  }
  const workforceData = await getEmployeeWorkforceSnapshot({
    organizationId: authorization.stall.organizationId,
    stallId: authorization.stall.id,
    profileId: authorization.principal.user.id,
  });
  if (attendanceError) {
    return (
      <main className="mx-auto min-h-screen max-w-2xl bg-stone-50 px-4 py-6 sm:px-6 sm:py-8">
        <Link href={returnHref} className="inline-flex min-h-11 items-center text-sm font-semibold text-teal-800">← 返回工作介面</Link>
        <header className="mt-3 border-b border-stone-200 pb-5"><p className="text-sm font-semibold text-teal-800">{authorization.stall.name}</p><h1 className="mt-1 text-3xl font-semibold">員工班表與休假</h1><p className="mt-2 text-sm text-stone-600">{authorization.principal.user.displayName}</p></header>
        <div className="space-y-5 py-6"><section className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-center"><h2 className="text-xl font-semibold">定位打卡目前未開放</h2><p className="mt-2 text-sm leading-6 text-stone-700">{attendanceError.code === "ATTENDANCE_DISABLED" ? "店家尚未啟用定位打卡；班表與休假功能仍可正常使用。" : "店家的打卡位置尚未設定完成；班表與休假功能仍可正常使用。"}</p></section><EmployeeWorkforcePanel stallSlug={stallSlug} initialData={workforceData} /></div>
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
        <div className="mt-5"><EmployeeWorkforcePanel stallSlug={stallSlug} initialData={workforceData} /></div>
      </div>
    </main>
  );
}

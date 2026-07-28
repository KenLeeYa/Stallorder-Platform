export const reportScheduleTypes = ["DAILY_SALES", "WEEKLY_SALES", "PAYMENT_VARIANCE"] as const;
export type ScheduledReportType = (typeof reportScheduleTypes)[number];

export const reportScheduleTypeLabels: Record<ScheduledReportType, string> = {
  DAILY_SALES: "\u6bcf\u65e5\u92b7\u552e\u65e5\u5831",
  WEEKLY_SALES: "\u6bcf\u9031\u71df\u904b\u9031\u5831",
  PAYMENT_VARIANCE: "\u4ed8\u6b3e\u5dee\u7570\u5831\u544a",
};

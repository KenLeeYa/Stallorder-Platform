export type ReportScheduleAccessScope = {
  canUseAllStalls: boolean;
  authorizedStallIds: readonly string[];
};

export function canAccessReportSchedule(
  stallIds: readonly string[],
  scope: ReportScheduleAccessScope,
) {
  if (scope.canUseAllStalls) return true;
  if (stallIds.length === 0) return false;
  const authorized = new Set(scope.authorizedStallIds);
  return stallIds.every((stallId) => authorized.has(stallId));
}

export function reportScheduleAccessScope(authorization: {
  authorizedStallIds: readonly string[];
  workspace: { canUseAllStalls: boolean };
}): ReportScheduleAccessScope {
  return {
    canUseAllStalls: authorization.workspace.canUseAllStalls,
    authorizedStallIds: authorization.authorizedStallIds,
  };
}

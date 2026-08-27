export function loginPathForReturnPath(returnPath: string) {
  const staffEntry = returnPath === "/staff"
    || returnPath.startsWith("/staff/")
    || returnPath === "/kitchen"
    || returnPath.startsWith("/kitchen?");
  const entryPath = staffEntry ? "/staff/login" : "/login";
  return `${entryPath}?next=${encodeURIComponent(returnPath)}`;
}

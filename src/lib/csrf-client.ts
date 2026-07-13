export function readCsrfToken() {
  if (typeof document === "undefined") return "";
  const cookie = document.cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith("stallorder_csrf="));
  return cookie ? decodeURIComponent(cookie.slice("stallorder_csrf=".length)) : "";
}

export function csrfHeaders() {
  return { "Content-Type": "application/json", "x-csrf-token": readCsrfToken() };
}

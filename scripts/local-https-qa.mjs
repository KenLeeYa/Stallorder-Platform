// LAN-only reverse proxy for physical-device QA. No public tunnel or provider configuration.
import { createServer as httpServer, request as httpRequest } from "node:http";
import { createServer as httpsServer } from "node:https";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const ip = process.env.LOCAL_QA_LAN_IP;
const directory = process.env.LOCAL_QA_TLS_DIRECTORY;
if (process.env.NODE_ENV !== "development" || !directory || !/^192\.168\.\d{1,3}\.\d{1,3}$/.test(ip ?? "")
  || process.env.NEXT_PUBLIC_APP_URL !== "http://127.0.0.1:3018"
  || new URL(process.env.DATABASE_URL ?? "file:///").hostname !== "127.0.0.1") throw new Error("LOCAL_HTTPS_TARGET_MISMATCH");
const origin = "https://" + ip + ":3443";
function allowed(request) {
  const address = request.socket.remoteAddress?.replace("::ffff:", "") ?? "";
  if (!address.startsWith(ip.slice(0, ip.lastIndexOf(".") + 1))) return false;
  if (![ip + ":3443", ip + ":3019"].includes(request.headers.host ?? "")) return false;
  return !request.headers.origin || request.headers.origin === origin;
}
function headersFor(request) {
  const headers = { ...request.headers, host: "127.0.0.1:3018" };
  // Only the validated, same-origin LAN request can reach the loopback test-login guard.
  if (headers.origin) headers.origin = "http://127.0.0.1:3018";
  if (headers.referer?.startsWith(origin)) headers.referer = headers.referer.replace(origin, "http://127.0.0.1:3018");
  for (const name of Object.keys(headers)) {
    if (name.startsWith("x-forwarded-") || name === "forwarded") delete headers[name];
  }
  return headers;
}
const server = httpsServer({
  cert: readFileSync(resolve(directory, "server.crt")), key: readFileSync(resolve(directory, "server.key")),
}, (request, response) => {
  if (!allowed(request)) { response.writeHead(403).end(); return; }
  const upstream = httpRequest({ hostname: "127.0.0.1", port: 3018, method: request.method,
    path: request.url, headers: headersFor(request) }, result => {
    const headers = { ...result.headers };
    if (headers.location?.startsWith("http://127.0.0.1:3018")) headers.location = headers.location.replace("http://127.0.0.1:3018", origin);
    response.writeHead(result.statusCode ?? 502, headers);
    result.pipe(response);
  });
  upstream.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end("Local QA server unavailable"); });
  request.on("aborted", () => upstream.destroy());
  request.pipe(upstream);
});
server.on("upgrade", (request, socket, head) => {
  if (!allowed(request)) { socket.destroy(); return; }
  const upstream = httpRequest({ hostname: "127.0.0.1", port: 3018, path: request.url, headers: headersFor(request) });
  upstream.on("upgrade", (response, remote, upstreamHead) => {
    socket.write("HTTP/1.1 101 Switching Protocols\r\n" + Object.entries(response.headers).map(([key, value]) => key + ": " + value).join("\r\n") + "\r\n\r\n");
    if (head.length) remote.write(head);
    if (upstreamHead.length) socket.write(upstreamHead);
    socket.pipe(remote).pipe(socket);
    socket.on("error", () => remote.destroy()); remote.on("error", () => socket.destroy());
  });
  upstream.on("error", () => socket.destroy()); upstream.end();
});
server.listen(3443, ip);
// Bootstrap exposes only the public certificate and setup instructions, never private keys.
httpServer((request, response) => {
  if (!allowed(request)) { response.writeHead(403).end(); return; }
  if (request.url === "/stallorder-local-ca.crt") {
    response.writeHead(200, { "content-type": "application/x-x509-ca-cert", "content-disposition": 'attachment; filename="stallorder-local-ca.crt"' });
    response.end(readFileSync(resolve(directory, "ca.crt"))); return;
  }
  if (request.url !== "/") { response.writeHead(404).end(); return; }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>StallOrder 實機測試</title>
    <style>body{font:18px/1.7 system-ui;max-width:680px;margin:auto;padding:24px}a{display:block;padding:14px;margin:16px 0;background:#0f766e;color:white;border-radius:10px}li{margin:14px 0}</style>
    <h1>StallOrder 實機測試</h1><p>僅供本機 Wi‑Fi 測試。憑證 7 天有效；測試後可移除。</p>
    <a href="/stallorder-local-ca.crt">1. 下載本機測試 CA 憑證</a>
    <ul><li>iPad：設定 → 已下載描述檔 → 安裝；再到一般 → 關於本機 → 憑證信任設定，啟用「StallOrder Local QA」的完全信任。</li>
    <li>Android：設定 → 安全性與隱私權 → 更多安全性設定 → 安裝憑證 → CA 憑證（名稱依品牌不同）。只需安裝上方的測試憑證。</li></ul>
    <a href="${origin}/login">2. 開啟 HTTPS 測試環境</a>
    <p>iPadOS 16.4 以上：Safari 分享 → 加入主畫面，從主畫面開啟；Android 使用 Chrome。</p>
    <p>按「店員」快速登入 → 鈴鐺「鎖屏通知」→ 開啟鎖屏通知 → 30 秒後測試通知 → 鎖屏。</p>
    <p>回到看板可查看推播接收與裝置顯示回報。勿擾模式、通知權限與音量會影響提示音。</p>`);
}).listen(3019, ip);
if (process.env.LOCAL_QA_PROCESS_RECEIPT) writeFileSync(process.env.LOCAL_QA_PROCESS_RECEIPT,
  JSON.stringify({ pid: process.pid, origin, bootstrap: "http://" + ip + ":3019", ports: [3019, 3443], retainedForManualQA: true }, null, 2));
console.log("LAN_QA_READY", origin, "bootstrap http://" + ip + ":3019");

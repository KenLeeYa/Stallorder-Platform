type ServiceStatus = "OPERATIONAL" | "DEGRADED" | "OUTAGE" | "MAINTENANCE";

type StatusEnvironment = {
  PRIMARY_HEALTH_URL?: string;
  INCIDENT_STATUS?: string;
  INCIDENT_SUMMARY?: string;
  INCIDENT_WORKAROUND?: string;
  PAYMENT_STATUS?: string;
};

type StatusSnapshot = {
  status: ServiceStatus;
  checkedAt: string;
  incident: {
    summary: string;
    workaround: string;
  };
  services: Array<{
    code: "QR_ORDERING" | "STAFF_ORDERING" | "PAYMENT_CHECKOUT";
    name: string;
    status: ServiceStatus;
    detail: string;
  }>;
};

const DEFAULT_HEALTH_URL = "https://app.qidaigo.com/api/health";
const DEFAULT_SUMMARY = "目前無已知重大事故。";
const DEFAULT_WORKAROUND = "若頁面暫時無法操作，請稍後重試或直接聯繫現場商家。";
const VALID_STATUSES = new Set<ServiceStatus>([
  "OPERATIONAL",
  "DEGRADED",
  "OUTAGE",
  "MAINTENANCE",
]);

function configuredStatus(value: string | undefined, fallback: ServiceStatus): ServiceStatus {
  const normalized = value?.trim().toUpperCase() as ServiceStatus | undefined;
  return normalized && VALID_STATUSES.has(normalized) ? normalized : fallback;
}

async function probePrimary(
  healthUrl: string,
  fetcher: typeof fetch,
): Promise<ServiceStatus> {
  let parsed: URL;
  try {
    parsed = new URL(healthUrl);
  } catch {
    return "DEGRADED";
  }
  if (parsed.protocol !== "https:") return "DEGRADED";

  try {
    const response = await fetcher(parsed.href, {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return "DEGRADED";
    const payload = await response.json() as { status?: unknown; health?: unknown };
    return payload.status === "ok" && payload.health === "HEALTHY"
      ? "OPERATIONAL"
      : "DEGRADED";
  } catch {
    return "DEGRADED";
  }
}

export async function createStatusSnapshot(
  env: StatusEnvironment,
  fetcher: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<StatusSnapshot> {
  const primaryStatus = await probePrimary(
    env.PRIMARY_HEALTH_URL?.trim() || DEFAULT_HEALTH_URL,
    fetcher,
  );
  const incidentStatus = configuredStatus(env.INCIDENT_STATUS, "OPERATIONAL");
  const paymentStatus = configuredStatus(env.PAYMENT_STATUS, "OPERATIONAL");
  const status = incidentStatus === "OPERATIONAL" ? primaryStatus : incidentStatus;
  const hasAutomaticIncident = primaryStatus !== "OPERATIONAL" && incidentStatus === "OPERATIONAL";

  return {
    status,
    checkedAt: now.toISOString(),
    incident: {
      summary: hasAutomaticIncident
        ? "主要服務健康檢查暫時無法通過，團隊正在確認。"
        : env.INCIDENT_SUMMARY?.trim() || DEFAULT_SUMMARY,
      workaround: env.INCIDENT_WORKAROUND?.trim() || DEFAULT_WORKAROUND,
    },
    services: [
      {
        code: "QR_ORDERING",
        name: "QR 點餐",
        status: primaryStatus,
        detail: primaryStatus === "OPERATIONAL" ? "顧客點餐入口正常" : "顧客點餐入口可能受影響",
      },
      {
        code: "STAFF_ORDERING",
        name: "店員接單",
        status: primaryStatus,
        detail: primaryStatus === "OPERATIONAL" ? "店員與廚房介面正常" : "店員與廚房介面可能受影響",
      },
      {
        code: "PAYMENT_CHECKOUT",
        name: "付款與結帳",
        status: primaryStatus === "OPERATIONAL" ? paymentStatus : "DEGRADED",
        detail: primaryStatus === "OPERATIONAL" && paymentStatus === "OPERATIONAL"
          ? "付款紀錄與結帳正常；第三方支付仍以結帳頁提示為準"
          : "付款或結帳可能受影響，請依現場指示處理",
      },
    ],
  };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}

function statusLabel(status: ServiceStatus) {
  return {
    OPERATIONAL: "正常",
    DEGRADED: "部分異常",
    OUTAGE: "服務中斷",
    MAINTENANCE: "維護中",
  }[status];
}

function renderHtml(snapshot: StatusSnapshot) {
  const checkedAt = new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Asia/Taipei",
  }).format(new Date(snapshot.checkedAt));
  const services = snapshot.services.map((service) => `
    <li class="service">
      <div>
        <strong>${escapeHtml(service.name)}</strong>
        <p>${escapeHtml(service.detail)}</p>
      </div>
      <span class="badge badge-${service.status.toLowerCase()}">${statusLabel(service.status)}</span>
    </li>`).join("");

  return `<!doctype html>
<html lang="zh-Hant-TW">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="60">
  <title>攤點通服務狀態</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #171717; background: #f7f7f5; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    main { width: min(720px, calc(100% - 32px)); margin: 0 auto; padding: 48px 0 64px; }
    header { margin-bottom: 28px; }
    .brand { color: #087f73; font-size: 15px; font-weight: 700; }
    h1 { margin: 10px 0 8px; font-size: clamp(30px, 7vw, 48px); line-height: 1.08; letter-spacing: 0; }
    .summary { margin: 0; color: #525252; line-height: 1.7; }
    .overall { border: 1px solid #d4d4d4; border-left: 5px solid #087f73; background: #fff; padding: 18px 20px; margin-bottom: 20px; }
    .overall strong { display: block; font-size: 20px; margin-bottom: 6px; }
    .overall p { margin: 0; color: #525252; line-height: 1.6; }
    ul { list-style: none; margin: 0; padding: 0; border-top: 1px solid #d4d4d4; }
    .service { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 4px; border-bottom: 1px solid #d4d4d4; }
    .service strong { font-size: 17px; }
    .service p { margin: 5px 0 0; color: #616161; line-height: 1.5; }
    .badge { flex: 0 0 auto; border: 1px solid currentColor; padding: 5px 9px; font-size: 14px; font-weight: 700; }
    .badge-operational { color: #087f73; }
    .badge-degraded, .badge-maintenance { color: #9a5b00; }
    .badge-outage { color: #b42318; }
    .workaround { margin-top: 24px; padding: 18px 20px; background: #fff8e7; border: 1px solid #e8c36a; }
    .workaround h2 { margin: 0 0 6px; font-size: 17px; }
    .workaround p { margin: 0; line-height: 1.6; }
    footer { margin-top: 28px; color: #737373; font-size: 14px; line-height: 1.6; }
    footer a { color: #087f73; }
    @media (max-width: 520px) { main { padding-top: 28px; } .service { align-items: flex-start; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div class="brand">攤點通</div>
      <h1>服務狀態</h1>
      <p class="summary">此頁獨立於主要應用程式運作，每 60 秒重新整理。</p>
    </header>
    <section class="overall">
      <strong>${statusLabel(snapshot.status)}</strong>
      <p>${escapeHtml(snapshot.incident.summary)}</p>
    </section>
    <ul>${services}
    </ul>
    <section class="workaround">
      <h2>替代處理方式</h2>
      <p>${escapeHtml(snapshot.incident.workaround)}</p>
    </section>
    <footer>
      最後檢查：${escapeHtml(checkedAt)}<br>
      <a href="https://app.qidaigo.com">返回攤點通</a>
    </footer>
  </main>
</body>
</html>`;
}

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

export async function handleRequest(
  request: Request,
  env: StatusEnvironment,
  fetcher: typeof fetch = fetch,
) {
  const url = new URL(request.url);
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD", ...SECURITY_HEADERS } });
  }
  if (url.pathname === "/health") {
    return new Response(request.method === "HEAD" ? null : "ok", {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...SECURITY_HEADERS },
    });
  }
  if (url.pathname !== "/" && url.pathname !== "/api/status") {
    return new Response(request.method === "HEAD" ? null : "Not Found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", ...SECURITY_HEADERS },
    });
  }

  const snapshot = await createStatusSnapshot(env, fetcher);
  if (url.pathname === "/api/status") {
    return new Response(request.method === "HEAD" ? null : JSON.stringify(snapshot), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...SECURITY_HEADERS },
    });
  }
  return new Response(request.method === "HEAD" ? null : renderHtml(snapshot), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...SECURITY_HEADERS },
  });
}

const worker = {
  fetch(request: Request, env: StatusEnvironment) {
    return handleRequest(request, env);
  },
};

export default worker;

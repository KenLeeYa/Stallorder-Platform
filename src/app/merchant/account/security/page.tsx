import { AccountSecurityPanel } from "@/components/account-security-panel";
import { prisma } from "@/lib/prisma";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { requireWorkspacePage } from "@/lib/workspace";
import { resolveResilienceFeatureFlags } from "@/server/resilience/feature-flag-service";
import { getOAuthProviderAvailability } from "@/server/auth/oauth/provider-registry";
import { oauthProviders } from "@/server/auth/oauth/types";

const labels = {
  GOOGLE: "Google",
  LINE: "LINE",
  APPLE: "Apple",
  MICROSOFT: "Microsoft",
} as const;

const copies = {
  "zh-TW": { title: "帳號與安全性", description: "管理登入方式、Passkey 架構與已登入裝置。供應商識別碼與權杖不會顯示於此頁。", loginMethods: "登入方式", loginDescription: "不同供應商只會在明確綁定後連到同一個 StallOrder 帳號，不會只憑 Email 自動合併。", linked: "已綁定", notLinked: "尚未綁定", link: "綁定", unlink: "解除綁定", lastLinked: "最近使用", unavailable: "未設定或功能旗標未開啟", lastIdentityWarning: "至少需保留一個可用登入方式。", sessions: "登入裝置", sessionsDescription: "僅顯示安全的裝置參考，不顯示 IP、Cookie 或完整瀏覽器指紋。", currentDevice: "目前裝置", otherDevice: "其他裝置", lastActive: "最近活動", expires: "到期", logoutDevice: "登出此裝置", logoutAll: "登出所有裝置", passkeys: "Passkeys / WebAuthn", passkeyReady: "Passkey challenge 與資料模型已就緒；正式註冊仍需完成 WebAuthn attestation verifier 驗證。", passkeyBlocked: "Passkey 預設關閉，完成 RP ID、Origin 與 WebAuthn verifier 驗證後才能啟用。", actionFailed: "操作失敗，請稍後再試。", confirmUnlink: "解除綁定會登出所有裝置，確定繼續？", confirmLogoutAll: "確定登出所有裝置？" },
  en: { title: "Account and security", description: "Manage login methods, Passkey architecture, and signed-in devices. Provider subjects and tokens are never shown here.", loginMethods: "Login methods", loginDescription: "Providers connect to the same StallOrder account only through explicit linking; Email alone never merges accounts.", linked: "Linked", notLinked: "Not linked", link: "Link", unlink: "Unlink", lastLinked: "Last used", unavailable: "Not configured or disabled", lastIdentityWarning: "Keep at least one usable login method.", sessions: "Signed-in devices", sessionsDescription: "Only safe device references are shown; IP, cookies, and full browser fingerprints stay hidden.", currentDevice: "Current device", otherDevice: "Other device", lastActive: "Last active", expires: "Expires", logoutDevice: "Log out device", logoutAll: "Log out all devices", passkeys: "Passkeys / WebAuthn", passkeyReady: "The Passkey challenge and data model are ready; registration still requires a verified WebAuthn attestation verifier.", passkeyBlocked: "Passkeys default OFF until RP ID, Origin, and the WebAuthn verifier are verified.", actionFailed: "The action failed. Try again.", confirmUnlink: "Unlinking signs out every device. Continue?", confirmLogoutAll: "Log out every device?" },
  vi: { title: "Tài khoản và bảo mật", description: "Quản lý phương thức đăng nhập, kiến trúc Passkey và thiết bị đã đăng nhập. Không hiển thị mã định danh hay token của nhà cung cấp.", loginMethods: "Phương thức đăng nhập", loginDescription: "Chỉ liên kết rõ ràng mới nối nhà cung cấp vào cùng tài khoản; không tự gộp chỉ theo Email.", linked: "Đã liên kết", notLinked: "Chưa liên kết", link: "Liên kết", unlink: "Hủy liên kết", lastLinked: "Dùng gần nhất", unavailable: "Chưa cấu hình hoặc đang tắt", lastIdentityWarning: "Phải giữ ít nhất một phương thức đăng nhập khả dụng.", sessions: "Thiết bị đăng nhập", sessionsDescription: "Chỉ hiển thị tham chiếu thiết bị an toàn; không hiển thị IP, Cookie hay dấu vân tay trình duyệt đầy đủ.", currentDevice: "Thiết bị hiện tại", otherDevice: "Thiết bị khác", lastActive: "Hoạt động gần nhất", expires: "Hết hạn", logoutDevice: "Đăng xuất thiết bị", logoutAll: "Đăng xuất mọi thiết bị", passkeys: "Passkeys / WebAuthn", passkeyReady: "Challenge và mô hình dữ liệu Passkey đã sẵn sàng; đăng ký thật vẫn cần verifier WebAuthn đã xác minh.", passkeyBlocked: "Passkey mặc định tắt đến khi xác minh RP ID, Origin và verifier WebAuthn.", actionFailed: "Thao tác thất bại. Vui lòng thử lại.", confirmUnlink: "Hủy liên kết sẽ đăng xuất mọi thiết bị. Tiếp tục?", confirmLogoutAll: "Đăng xuất mọi thiết bị?" },
} as const;

export default async function AccountSecurityPage() {
  const [{ principal }, { locale }, flags] = await Promise.all([
    requireWorkspacePage(),
    getRequestAppLocale(),
    resolveResilienceFeatureFlags(["AUTH_PASSKEYS_ENABLED"]),
  ]);
  const [identities, sessions, passkeyCount, availability] = await Promise.all([
    prisma.authIdentity.findMany({
      where: { profileId: principal.user.id, revokedAt: null },
      select: { provider: true, lastLoginAt: true },
    }),
    prisma.authSession.findMany({
      where: { profileId: principal.user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: "desc" },
      select: { id: true, deviceId: true, issuedAt: true, lastSeenAt: true, expiresAt: true },
    }),
    prisma.passkeyCredential.count({ where: { profileId: principal.user.id, revokedAt: null } }),
    Promise.all(oauthProviders.map(async (provider) => ({
      provider,
      availability: await getOAuthProviderAvailability(provider),
    }))),
  ]);
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  });
  const copy = locale === "zh-TW" || locale === "vi" ? copies[locale] : copies.en;

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-4xl px-4 py-8 md:px-8">
      <header className="mb-7 border-b border-stone-200 pb-5"><h1 className="text-3xl font-semibold">{copy.title}</h1><p className="mt-2 text-sm text-stone-600">{copy.description}</p></header>
      <AccountSecurityPanel
        initialProviders={availability.map(({ provider, availability: state }) => {
          const identity = identities.find((candidate) => candidate.provider === provider);
          return { provider, label: labels[provider], enabled: state.enabled, linkedAt: identity ? dateFormatter.format(identity.lastLoginAt) : null };
        })}
        initialSessions={sessions.map((session) => ({
          id: session.id,
          label: session.deviceId ? `Device ${session.deviceId.slice(0, 8)}` : "Device",
          issuedAt: dateFormatter.format(session.issuedAt),
          lastSeenAt: dateFormatter.format(session.lastSeenAt),
          expiresAt: dateFormatter.format(session.expiresAt),
          current: session.id === principal.sessionId,
        }))}
        passkeyCount={passkeyCount}
        passkeysEnabled={flags.AUTH_PASSKEYS_ENABLED.enabled}
        copy={copy}
      />
    </main>
  );
}

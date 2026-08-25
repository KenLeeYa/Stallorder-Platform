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
  "zh-TW": { title: "帳號與安全性", description: "管理登入方式與登入裝置。", loginMethods: "登入方式", loginDescription: "只有您主動綁定的登入方式，才會連到同一帳號；相同 Email 不會自動合併。", linked: "已綁定", notLinked: "尚未綁定", link: "綁定", unlink: "解除綁定", lastLinked: "最近使用", unavailable: "尚未開放", lastIdentityWarning: "至少需保留一個可用登入方式。", sessions: "登入裝置", sessionsDescription: "顯示裝置的大致類型；部分瀏覽器無法顯示精確型號。", currentDevice: "目前裝置", otherDevice: "其他裝置", lastActive: "最近活動", expires: "到期", logoutDevice: "登出此裝置", logoutAll: "登出所有裝置", passkeys: "Passkeys", passkeyReady: "可使用裝置的 Passkey 快速登入。", passkeyBlocked: "Passkey 尚未開放。", actionFailed: "操作失敗，請稍後再試。", confirmUnlink: "解除綁定會登出所有裝置，確定繼續？", confirmLogoutAll: "確定登出所有裝置？" },
  en: { title: "Account and security", description: "Manage login methods and signed-in devices.", loginMethods: "Login methods", loginDescription: "Only login methods you link will use the same account. Matching email addresses are not merged automatically.", linked: "Linked", notLinked: "Not linked", link: "Link", unlink: "Unlink", lastLinked: "Last used", unavailable: "Not available yet", lastIdentityWarning: "Keep at least one usable login method.", sessions: "Signed-in devices", sessionsDescription: "Shows the general device type. Some browsers cannot show the exact model.", currentDevice: "Current device", otherDevice: "Other device", lastActive: "Last active", expires: "Expires", logoutDevice: "Log out device", logoutAll: "Log out all devices", passkeys: "Passkeys", passkeyReady: "Use your device Passkey for faster sign-in.", passkeyBlocked: "Passkeys are not available yet.", actionFailed: "The action failed. Try again.", confirmUnlink: "Unlinking signs out every device. Continue?", confirmLogoutAll: "Log out every device?" },
  vi: { title: "Tài khoản và bảo mật", description: "Quản lý cách đăng nhập và thiết bị đã đăng nhập.", loginMethods: "Phương thức đăng nhập", loginDescription: "Chỉ những cách đăng nhập bạn chủ động liên kết mới dùng chung một tài khoản. Email giống nhau không tự gộp.", linked: "Đã liên kết", notLinked: "Chưa liên kết", link: "Liên kết", unlink: "Hủy liên kết", lastLinked: "Dùng gần nhất", unavailable: "Chưa khả dụng", lastIdentityWarning: "Phải giữ ít nhất một phương thức đăng nhập khả dụng.", sessions: "Thiết bị đăng nhập", sessionsDescription: "Hiển thị loại thiết bị chung. Một số trình duyệt không cho biết chính xác mẫu máy.", currentDevice: "Thiết bị hiện tại", otherDevice: "Thiết bị khác", lastActive: "Hoạt động gần nhất", expires: "Hết hạn", logoutDevice: "Đăng xuất thiết bị", logoutAll: "Đăng xuất mọi thiết bị", passkeys: "Passkeys", passkeyReady: "Dùng Passkey của thiết bị để đăng nhập nhanh hơn.", passkeyBlocked: "Passkey chưa khả dụng.", actionFailed: "Thao tác thất bại. Vui lòng thử lại.", confirmUnlink: "Hủy liên kết sẽ đăng xuất mọi thiết bị. Tiếp tục?", confirmLogoutAll: "Đăng xuất mọi thiết bị?" },
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
      select: { id: true, deviceId: true, deviceLabel: true, issuedAt: true, lastSeenAt: true, expiresAt: true },
    }),
    flags.AUTH_PASSKEYS_ENABLED.enabled
      ? prisma.passkeyCredential.count({ where: { profileId: principal.user.id, revokedAt: null } })
      : Promise.resolve(0),
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
          label: session.deviceLabel ?? (session.deviceId ? `Device ${session.deviceId.slice(0, 8)}` : "Device"),
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

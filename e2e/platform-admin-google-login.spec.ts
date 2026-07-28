import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const email = "platform.admin.e2e@stallorder.test";
const authUserId = "a9000000-0000-4000-8000-000000000001";
let profileId = "";

test.describe("Staging 平台管理員 Google 登入", () => {
  test.beforeAll(async () => {
    const owner = await prisma.profile.findUniqueOrThrow({
      where: { email: "owner@stallorder.test" },
      select: { passwordHash: true },
    });
    if (!owner.passwordHash) throw new Error("示範 owner 缺少密碼雜湊");

    await prisma.$executeRaw`delete from auth.users where id = ${authUserId}::uuid or email = ${email}`;
    await prisma.$executeRaw`
      insert into auth.users (
        instance_id, id, aud, role, email, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at
      ) values (
        '00000000-0000-0000-0000-000000000000'::uuid,
        ${authUserId}::uuid,
        'authenticated',
        'authenticated',
        ${email},
        now(),
        '{"provider":"google","providers":["google"]}'::jsonb,
        '{"full_name":"Staging 平台管理員 E2E"}'::jsonb,
        now(),
        now()
      )
    `;

    const profile = await prisma.profile.upsert({
      where: { email },
      update: {
        authUserId: null,
        isActive: false,
        passwordHash: owner.passwordHash,
        platformRole: null,
      },
      create: {
        email,
        displayName: "Staging 平台管理員 E2E",
        isActive: false,
        passwordHash: owner.passwordHash,
      },
      select: { id: true },
    });
    profileId = profile.id;
    await prisma.authSession.deleteMany({ where: { profileId } });
    await prisma.auditLog.deleteMany({
      where: { actorProfileId: profileId, action: "PLATFORM_ADMIN_BOOTSTRAPPED" },
    });
  });

  test.afterAll(async () => {
    try {
      if (profileId) {
        await prisma.authSession.deleteMany({ where: { profileId } });
        await prisma.auditLog.deleteMany({ where: { actorProfileId: profileId } });
        await prisma.profile.deleteMany({ where: { id: profileId } });
      }
      await prisma.$executeRaw`delete from auth.users where id = ${authUserId}::uuid`;
    } finally {
      await prisma.$disconnect();
    }
  });

  test("未指定導向時，已驗證允許清單 Email 會進入平台後台且匿名無法存取", async ({ page }) => {
    const anonymousResponse = await page.request.get("/admin/billing", { maxRedirects: 0 });
    expect(anonymousResponse.status()).toBe(307);
    const anonymousRedirect = new URL(anonymousResponse.headers().location!, "http://localhost:3001");
    expect(anonymousRedirect.pathname).toBe("/login");
    expect(anonymousRedirect.searchParams.get("next")).toBe("/admin/billing");

    await page.goto("/login");
    const googleLogin = page.getByRole("link", { name: "使用 Google 登入", exact: true });
    await expect(googleLogin).toHaveAttribute("href", "/auth/google");
    await googleLogin.click();
    await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:55431\/auth\/v1\/authorize/);
    await page.getByRole("link", { name: email, exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/billing$/, { timeout: 20_000 });
    await expect(page.getByRole("link", { name: "平台管理後台", exact: true })).toBeVisible();
    const hasSecureApplicationSession = (await page.context().cookies()).some(
      (cookie) => cookie.name === "stallorder_session"
        && cookie.httpOnly
        && cookie.sameSite === "Lax",
    );
    expect(hasSecureApplicationSession).toBe(true);

    const profile = await prisma.profile.findUniqueOrThrow({
      where: { email },
      select: { authUserId: true, isActive: true, platformRole: true },
    });
    expect(profile.authUserId).toBe(authUserId);
    expect(profile.isActive).toBe(true);
    expect(profile.platformRole).toBe("PLATFORM_ADMIN");
    await expect.poll(() => prisma.auditLog.count({
      where: {
        actorProfileId: profileId,
        action: "PLATFORM_ADMIN_BOOTSTRAPPED",
        outcome: "SUCCESS",
      },
    })).toBe(1);
    expect(await prisma.authSession.count({ where: { profileId } })).toBeGreaterThan(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/merchant-applications");
    await expect(page.getByTestId("merchant-applications-mobile-list")).toHaveCSS("display", "grid");
    await expect(page.getByTestId("merchant-applications-desktop-table")).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

    const logoutResponse = page.waitForResponse((response) => (
      response.url().endsWith("/api/auth/logout")
      && response.request().method() === "POST"
    ));
    await page.getByRole("button", { name: "登出", exact: true }).click();
    expect((await logoutResponse).status()).toBe(200);
    await expect(page).toHaveURL(/\/login$/);
    expect(await prisma.authSession.count({ where: { profileId } })).toBe(0);

    await page.goto("/admin/billing");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Fbilling$/);
  });
});

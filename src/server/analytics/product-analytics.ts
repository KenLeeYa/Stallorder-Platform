import "server-only";
import type { SessionPrincipal } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createProductAnalytics, noopAnalytics } from "./analytics-adapter";
export const productAnalytics = createProductAnalytics(noopAnalytics, async (principal: SessionPrincipal) => {
    const session = await prisma.authSession.findFirst({ where: { id: principal.sessionId, profileId: principal.user.id, revokedAt: null, expiresAt: { gt: new Date() } }, include: { profile: true } });
    if (!session || !session.profile.isActive || session.profileSessionVersion !== session.profile.sessionVersion)
        return false;
    return (await prisma.notificationPreference.findUnique({ where: { profileId: principal.user.id }, select: { analyticsConsent: true } }))?.analyticsConsent === true;
}, principal => principal.user.id);

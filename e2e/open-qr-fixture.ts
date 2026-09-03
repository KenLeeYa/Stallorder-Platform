import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

type BusinessHourSnapshot = {
  id: string;
  opensAt: string;
  closesAt: string;
  isClosed: boolean;
};

export async function createOpenQrFixture(input: {
  organizationId: string;
  stallId: string;
  tokenPrefix: string;
  label: string;
}) {
  const databaseUrl = process.env.DATABASE_URL;
  const hostname = databaseUrl ? new URL(databaseUrl).hostname : "";
  if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) {
    throw new Error("OPEN_QR_FIXTURE_REQUIRES_LOCAL_DATABASE");
  }

  const prisma = new PrismaClient();
  let originalHours: BusinessHourSnapshot[] = [];
  let qrCodeId = "";
  const qrToken = `${input.tokenPrefix}-${randomUUID()}`;

  try {
    const [hours, qrVersion] = await Promise.all([
      prisma.stallBusinessHour.findMany({
        where: { organizationId: input.organizationId, stallId: input.stallId },
        orderBy: { dayOfWeek: "asc" },
        select: { id: true, opensAt: true, closesAt: true, isClosed: true },
      }),
      prisma.qrCode.aggregate({
        where: { stallId: input.stallId },
        _max: { tokenVersion: true },
      }),
    ]);
    if (hours.length !== 7) throw new Error("OPEN_QR_FIXTURE_HOURS_INCOMPLETE");
    originalHours = hours;
    await prisma.stallBusinessHour.updateMany({
      where: { organizationId: input.organizationId, stallId: input.stallId },
      data: { opensAt: "00:00", closesAt: "23:59", isClosed: false },
    });
    qrCodeId = (
      await prisma.qrCode.create({
        data: {
          organizationId: input.organizationId,
          stallId: input.stallId,
          token: qrToken,
          label: input.label,
          state: "ACTIVE",
          tokenVersion: (qrVersion._max.tokenVersion ?? 0) + 1,
        },
        select: { id: true },
      })
    ).id;
  } catch (error) {
    await restore();
    throw error;
  }

  async function restore() {
    try {
      if (qrCodeId) {
        await prisma.publicOrderAttempt.deleteMany({ where: { qrCodeId } });
        await prisma.qrCode.deleteMany({ where: { id: qrCodeId } });
      }
      await Promise.all(
        originalHours.map((hour) =>
          prisma.stallBusinessHour.update({
            where: { id: hour.id },
            data: {
              opensAt: hour.opensAt,
              closesAt: hour.closesAt,
              isClosed: hour.isClosed,
            },
          }),
        ),
      );
    } finally {
      await prisma.$disconnect();
    }
  }

  return { qrToken, restore };
}

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/security";
import { completeStreamlinedOrderAfterPickup } from "@/server/printing/streamlined-order-completion";

type PickupVerificationMethod = "CODE" | "MANUAL";

export async function findReadyPickupOrdersByCode({
  stallId,
  code,
}: {
  stallId: string;
  code: string;
}) {
  const [businessDateRow] = await prisma.$queryRaw<Array<{ businessDate: Date }>>`
    select public.stall_business_date(${stallId}::uuid, now()) as "businessDate"
  `;
  if (!businessDateRow) return [];

  return prisma.order.findMany({
    where: {
      stallId,
      pickupCodeServiceDate: businessDateRow.businessDate,
      fulfillmentType: "TAKEOUT",
      status: "READY",
      pickupVerifiedAt: null,
      pickupCodeLength: code.length,
      pickupCodeHash: hashToken(code),
    },
    select: { id: true },
    take: 2,
  });
}

export async function verifyReadyTakeoutOrder({
  orderId,
  stallId,
  organizationId,
  actorProfileId,
  verificationMethod,
  code,
  confirmationOrderNo,
  verifiedAt = new Date(),
}: {
  orderId: string;
  stallId: string;
  organizationId: string;
  actorProfileId: string;
  verificationMethod: PickupVerificationMethod;
  code?: string;
  confirmationOrderNo?: string;
  verifiedAt?: Date;
}) {
  if (verificationMethod === "CODE" && !code) return null;
  if (verificationMethod === "MANUAL" && !confirmationOrderNo) return null;

  return prisma.$transaction(async (transaction: Prisma.TransactionClient) => {
    const result = await transaction.order.updateMany({
      where: {
        id: orderId,
        stallId,
        fulfillmentType: "TAKEOUT",
        status: "READY",
        pickupVerifiedAt: null,
        ...(verificationMethod === "CODE"
          ? { pickupCodeLength: code?.length, pickupCodeHash: hashToken(code ?? "") }
          : { orderNo: confirmationOrderNo }),
      },
      data: { pickupVerifiedAt: verifiedAt, pickupVerificationMethod: verificationMethod },
    });
    if (result.count !== 1) return null;

    await transaction.orderEvent.create({
      data: {
        organizationId,
        stallId,
        orderId,
        eventType: verificationMethod === "CODE" ? "PICKUP_CODE_VERIFIED" : "PICKUP_MANUALLY_VERIFIED",
        createdBy: actorProfileId,
      },
    });
    await completeStreamlinedOrderAfterPickup(transaction, orderId, verifiedAt);
    return { pickupVerifiedAt: verifiedAt, pickupVerificationMethod: verificationMethod };
  });
}

import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

export async function getStallBySlug(slug: string) {
  const stall = await prisma.stall.findUnique({
    where: { slug },
    include: { merchant: true },
  });

  if (!stall || !stall.isActive || !["TRIALING", "ACTIVE"].includes(stall.merchant.status)) {
    notFound();
  }

  return stall;
}

export async function getStallForApi(slug: string) {
  return prisma.stall.findFirst({
    where: {
      slug,
      isActive: true,
      merchant: { status: { in: ["TRIALING", "ACTIVE"] } },
    },
    select: { id: true, slug: true, name: true, currency: true },
  });
}

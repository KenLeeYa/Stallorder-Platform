import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

export async function getStallBySlug(slug: string) {
  const stall = await prisma.stall.findUnique({
    where: { slug },
    include: { organization: true },
  });

  if (!stall || !stall.isActive || !["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD"].includes(stall.organization.status)) {
    notFound();
  }

  return stall;
}

export async function getStallForApi(slug: string) {
  return prisma.stall.findFirst({
    where: {
      slug,
      isActive: true,
      organization: { status: { in: ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD"] } },
    },
    select: { id: true, slug: true, name: true, currency: true },
  });
}

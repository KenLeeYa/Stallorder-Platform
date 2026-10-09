import { createHash } from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getPagePrincipal } from "@/lib/auth";
import { ProductFeedback } from "@/components/product-feedback";
import { FeedbackError, requireFeedbackOrganization } from "@/server/feedback/feedback-service";
export default async function FeedbackPage({ searchParams }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const principal = await getPagePrincipal();
    if (!principal)
        redirect("/login?next=%2Ffeedback");
    const params = z.object({ organizationId: z.uuid().optional(), requestId: z.uuid().optional() }).strict().safeParse(await searchParams);
    if (!params.success)
        notFound();
    const organizationId = params.data.organizationId ?? null;
    try {
        await requireFeedbackOrganization(principal, organizationId);
    }
    catch (error) {
        if (error instanceof FeedbackError)
            notFound();
        throw error;
    }
    const identity = createHash("sha256").update(JSON.stringify([principal.user.id, principal.sessionId, organizationId])).digest("hex");
    return <main className="mx-auto max-w-3xl space-y-5 px-4 py-8"><h1 className="text-2xl font-semibold">產品回饋</h1><ProductFeedback identity={identity} organizationId={organizationId} requestId={params.data.requestId}/><a className="inline-flex min-h-12 items-center rounded border px-3 py-2" href={organizationId ? `/merchant/dashboard?organizationId=${organizationId}` : "/onboarding"}>返回工作區</a></main>;
}

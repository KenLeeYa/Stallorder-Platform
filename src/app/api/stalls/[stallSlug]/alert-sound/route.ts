import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ stallSlug: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { stallSlug } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "VIEW_ORDERS");
  if (!authorization.ok) return authorization.response;
  const settings = await prisma.stallOrderingSettings.findUnique({
    where: { stallId: authorization.stall.id },
    select: { orderAlertSoundObjectPath: true },
  });
  const objectPath = settings?.orderAlertSoundObjectPath;
  if (!objectPath) return NextResponse.json({ error: "尚未設定自訂提示音。" }, { status: 404 });
  const expectedPrefix = `${authorization.stall.organizationId}/stall-alerts/${authorization.stall.id}/`;
  if (!objectPath.startsWith(expectedPrefix)) {
    return NextResponse.json({ error: "提示音路徑不正確。" }, { status: 409 });
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    return NextResponse.json({ error: "尚未設定音效儲存服務。" }, { status: 503 });
  }
  const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const downloaded = await admin.storage.from("alert-sounds").download(objectPath);
  if (downloaded.error || !downloaded.data) {
    return NextResponse.json({ error: "提示音無法讀取。" }, { status: 404 });
  }
  return new Response(await downloaded.data.arrayBuffer(), {
    headers: {
      "cache-control": "private, no-store, max-age=0",
      "content-type": contentTypeForPath(objectPath),
      "x-content-type-options": "nosniff",
      "x-request-id": authorization.requestId,
    },
  });
}

function contentTypeForPath(path: string) {
  if (path.endsWith(".mp3")) return "audio/mpeg";
  if (path.endsWith(".wav")) return "audio/wav";
  return "audio/mp4";
}

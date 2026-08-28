import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      revision: process.env.VERCEL_GIT_COMMIT_SHA
        ?? process.env.GITHUB_SHA
        ?? "local",
    },
    {
      headers: {
        "cache-control": "no-store, max-age=0, must-revalidate",
      },
    },
  );
}

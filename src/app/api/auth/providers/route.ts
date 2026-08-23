import { NextResponse } from "next/server";
import { createRequestId } from "@/lib/security";
import {
  getOAuthProviderAvailability,
} from "@/server/auth/oauth/provider-registry";
import { oauthProviders } from "@/server/auth/oauth/types";

const labels = {
  GOOGLE: "Google",
  LINE: "LINE",
  APPLE: "Apple",
  MICROSOFT: "Microsoft",
} as const;

export async function GET() {
  const requestId = createRequestId();
  const providers = await Promise.all(oauthProviders.map(async (provider) => {
    const availability = await getOAuthProviderAvailability(provider);
    return {
      provider,
      label: labels[provider],
      enabled: availability.enabled,
      configured: availability.configured,
    };
  }));
  return NextResponse.json(
    { providers },
    {
      headers: {
        "cache-control": "no-store",
        "x-request-id": requestId,
      },
    },
  );
}

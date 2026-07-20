import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export function isSupabaseAuthConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL
    && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

export function isGoogleLoginEnabled() {
  return process.env.NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED === "true"
    && isSupabaseAuthConfigured();
}

export async function createSupabaseAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) throw new Error("SUPABASE_AUTH_NOT_CONFIGURED");

  const cookieStore = await cookies();
  return createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        for (const cookie of cookiesToSet) cookieStore.set(cookie.name, cookie.value, cookie.options);
      },
    },
  });
}

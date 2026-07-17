"use client";

import { createBrowserClient } from "@supabase/ssr";

export function isSupabaseBrowserConfigured() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return Boolean(url && publishableKey && !publishableKey.startsWith("replace-with-"));
}

export function createOptionalSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey || !isSupabaseBrowserConfigured()) return null;
  return createBrowserClient(url, publishableKey);
}

"use client";

import { createBrowserClient } from "@supabase/ssr";

export function getSupabaseBrowserUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_REALTIME_URL?.trim()
    || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
}

export function isSupabaseBrowserConfigured() {
  const url = getSupabaseBrowserUrl();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return Boolean(url && publishableKey && !publishableKey.startsWith("replace-with-"));
}

export function createOptionalSupabaseBrowserClient() {
  const url = getSupabaseBrowserUrl();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey || !isSupabaseBrowserConfigured()) return null;
  return createBrowserClient(url, publishableKey);
}

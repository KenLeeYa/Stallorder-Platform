import { createClient } from "npm:@supabase/supabase-js@2.110.2";
import { getServiceRoleKey, requireEnv } from "./env.ts";

export function createServiceClient() {
  return createClient(requireEnv("SUPABASE_URL"), getServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "x-application-name": "stallorder-edge" } },
  });
}

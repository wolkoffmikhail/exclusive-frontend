import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export function getSupabaseServiceRoleConfig() {
  const url =
    process.env.SUPABASE_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Supabase service-role configuration is missing");
  }

  return { url, key };
}

export function createServiceRoleClient() {
  const { url, key } = getSupabaseServiceRoleConfig();

  return createSupabaseClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

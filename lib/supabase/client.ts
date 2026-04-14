"use client"

import { createBrowserClient } from "@supabase/ssr"

function getBrowserSupabaseUrl() {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL || "/supabase"
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw
  const path = raw.startsWith("/") ? raw : `/${raw}`
  return `${window.location.origin}${path}`
}

export function createClient() {
  const supabaseUrl = getBrowserSupabaseUrl()
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY")
  }

  return createBrowserClient(supabaseUrl, supabaseKey, {
  cookieOptions: { name: "sb-auth" },
  })

}

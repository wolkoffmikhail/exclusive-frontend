import { createBrowserClient } from "@supabase/ssr"

export function createClientComponent() {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL || "/supabase"
  const supabaseUrl =
    raw.startsWith("http://") || raw.startsWith("https://")
      ? raw
      : `${window.location.origin}${raw.startsWith("/") ? raw : `/${raw}`}`

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

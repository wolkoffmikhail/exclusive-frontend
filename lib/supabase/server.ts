import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

export const dynamic = "force-dynamic"

export async function createClient() {
  const cookieStore = await cookies()

  const supabaseUrl = process.env.SUPABASE_INTERNAL_URL
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl) throw new Error("SUPABASE_INTERNAL_URL is not set")
  if (!supabaseKey) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is not set")

  return createServerClient(supabaseUrl, supabaseKey, {
  cookieOptions: { name: "sb-auth" },
  cookies: {
    getAll() {
      return cookieStore.getAll()
    },
    setAll(cookiesToSet) {
      try {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, { ...options })
        })
      } catch {
        // ignore (Server Components)
      }
    },
  },
})
}


"use client"

import { createBrowserClient } from "@supabase/ssr"
import { createContext, useContext, useMemo } from "react"

type SupabaseClientType = ReturnType<typeof createBrowserClient>

const SupabaseContext = createContext<SupabaseClientType | null>(null)

export function useSupabase() {
  const client = useContext(SupabaseContext)
  if (!client) throw new Error("useSupabase must be used within SupabaseProvider")
  return client
}

export function SupabaseProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => {
    const raw = process.env.NEXT_PUBLIC_SUPABASE_URL || "/supabase"
    const supabaseUrl =
      raw.startsWith("http://") || raw.startsWith("https://")
        ? raw
        : `${window.location.origin}${raw}`

    const supabaseKey =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

    if (!supabaseKey) {
      throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY (or PUBLISHABLE_KEY)")
    }

    return createBrowserClient(supabaseUrl, supabaseKey, {
      cookieOptions: { name: "sb-auth" },
    })
  }, [])

  return <SupabaseContext.Provider value={supabase}>{children}</SupabaseContext.Provider>
}

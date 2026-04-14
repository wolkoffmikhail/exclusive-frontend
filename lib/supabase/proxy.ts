import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { hasEnvVars } from "../utils"

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  if (!hasEnvVars) return response

  const supabaseUrl = process.env.SUPABASE_INTERNAL_URL
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  if (!supabaseUrl || !supabaseKey) return response

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookieOptions: { name: "sb-auth" },
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        // прокидываем куки в request (как требует supabase/ssr)
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))

        // ВАЖНО: пересоздаём response и кладём куки в response
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, { ...options })
        })
      },
    },
  })

  // триггерит refresh и корректно прокидывает cookies
  await supabase.auth.getUser()

  return response
}


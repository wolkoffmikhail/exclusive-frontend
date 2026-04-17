import { NextResponse } from "next/server"
import { listRecentImportJobs } from "@/lib/server/import-journal"
import { createAdminClient } from "@/lib/supabase/admin"

export const runtime = "nodejs"

export async function GET() {
  try {
    const adminClient = createAdminClient()
    const jobs = await listRecentImportJobs(adminClient, 12)
    return NextResponse.json({ jobs })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось загрузить журнал импортов",
      },
      { status: 500 }
    )
  }
}

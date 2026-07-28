import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { runScheduledNewsIngestion, createSupabaseScheduledNewsIngestionStore } from "@/lib/server/news-ingestion/scheduled";
import { isAuthorizedCronSecretRequest } from "@/lib/server/news-ingestion/cron-auth";
import { createServiceRoleClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export function isAuthorizedNewsIngestionRequest(request: NextRequest) {
  return isAuthorizedCronSecretRequest(request);
}

function commaList(value: string | null) {
  return Array.from(new Set((value ?? "").split(",").map((item) => item.trim()).filter(Boolean)));
}

function integerEnv(name: string) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function enabledEnv(name: string) {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export async function POST(request: NextRequest) {
  const auth = isAuthorizedNewsIngestionRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.reason }, { status: auth.reason === "unauthorized" ? 401 : 503 });
  }

  const supabase = createServiceRoleClient();
  const summary = await runScheduledNewsIngestion(createSupabaseScheduledNewsIngestionStore(supabase), {
    cbrLimit: integerEnv("NEWS_INGEST_CBR_LIMIT"),
    foreignInsightLimit: integerEnv("NEWS_INGEST_FOREIGN_INSIGHT_LIMIT"),
    enableForeignInsights: enabledEnv("NEWS_INGEST_ENABLE_FOREIGN_INSIGHTS"),
    familyIds: commaList(process.env.NEWS_INGEST_FAMILY_IDS ?? null),
    familyLimit: integerEnv("NEWS_INGEST_FAMILY_LIMIT"),
    syncMoexAliases: enabledEnv("NEWS_INGEST_SYNC_MOEX_ALIASES"),
    moexAssetLimit: integerEnv("NEWS_INGEST_MOEX_ASSET_LIMIT"),
    secUserAgent: process.env.NEWS_INGEST_SEC_USER_AGENT,
  });

  revalidatePath("/news");
  revalidatePath("/dashboard");

  return NextResponse.json(summary, { status: summary.ok ? 200 : 207 });
}

export async function GET(request: NextRequest) {
  return POST(request);
}

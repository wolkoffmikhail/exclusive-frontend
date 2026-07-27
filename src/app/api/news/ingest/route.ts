import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { runScheduledNewsIngestion, createSupabaseScheduledNewsIngestionStore } from "@/lib/server/news-ingestion/scheduled";
import { createServiceRoleClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function configuredSecret() {
  return process.env.NEWS_INGEST_SECRET || process.env.CRON_SECRET || null;
}

function bearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() ?? null;
}

export function isAuthorizedNewsIngestionRequest(request: NextRequest) {
  const expected = configuredSecret();
  if (!expected) return { ok: false, reason: "news_ingest_secret_missing" };

  const actual = bearerToken(request) || request.headers.get("x-cron-secret")?.trim() || null;
  if (actual !== expected) return { ok: false, reason: "unauthorized" };

  return { ok: true, reason: null };
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
    familyIds: commaList(process.env.NEWS_INGEST_FAMILY_IDS ?? null),
    familyLimit: integerEnv("NEWS_INGEST_FAMILY_LIMIT"),
    syncMoexAliases: enabledEnv("NEWS_INGEST_SYNC_MOEX_ALIASES"),
    moexAssetLimit: integerEnv("NEWS_INGEST_MOEX_ASSET_LIMIT"),
  });

  revalidatePath("/news");
  revalidatePath("/dashboard");

  return NextResponse.json(summary, { status: summary.ok ? 200 : 207 });
}

export async function GET(request: NextRequest) {
  return POST(request);
}

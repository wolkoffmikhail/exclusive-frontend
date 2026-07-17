"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActiveFamily, getPortfolioData } from "@/lib/portfolio/data";
import { planLimitAlertLifecycle } from "@/lib/portfolio/alerts";
import { evaluatePortfolioLimitCheck } from "@/lib/portfolio/limits";
import { canEditFamilyData, canManageFamily } from "@/lib/portfolio/permissions";
import { buildMaxAlertMessage, sendMaxMessage } from "@/lib/server/notifications/max";
import { buildTelegramAlertMessage, sendTelegramMessage } from "@/lib/server/notifications/telegram";
import { createClient } from "@/lib/supabase/server";

type Stage5ReturnTo = "/recommendations" | "/news" | "/watchlist" | "/events" | "/dashboard" | "/settings" | "/assets";

const recommendationStatuses = new Set(["open", "accepted", "rejected", "archived"]);
const newsKinds = new Set(["portfolio_news", "market_news", "idea"]);
const watchlistStatuses = new Set(["watching", "considering", "done", "archived"]);
const eventTypes = new Set(["dividend", "coupon", "redemption"]);
const eventStatuses = new Set(["scheduled", "done", "cancelled"]);
const limitTypes = new Set(["asset_share", "asset_class_share", "currency_share", "cash_min_share", "cash_max_share"]);
const limitDirections = new Set(["min", "max"]);
const limitSeverities = new Set(["info", "warning", "critical"]);
const notificationStatuses = new Set(["enabled", "disabled"]);

const defaultLimitTemplates = [
  { limit_type: "cash_min_share", scope_key: null, threshold_value: 0.05, direction: "min", severity: "warning" },
  { limit_type: "cash_max_share", scope_key: null, threshold_value: 0.3, direction: "max", severity: "warning" },
  { limit_type: "asset_class_share", scope_key: "stock", threshold_value: 0.7, direction: "max", severity: "info" },
] as const;

function textField(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function optionalTextField(formData: FormData, name: string) {
  const value = textField(formData, name);
  return value || null;
}

function safeReturnTo(value: string | null | undefined, fallback: Stage5ReturnTo): Stage5ReturnTo {
  if (value === "/recommendations" || value === "/news" || value === "/watchlist" || value === "/events" || value === "/dashboard" || value === "/settings" || value === "/assets") {
    return value;
  }
  return fallback;
}

function redirectWithStage5Error(code: string, returnTo: Stage5ReturnTo): never {
  redirect(`${returnTo}?stage5_error=${encodeURIComponent(code)}`);
}

function redirectWithStage5Saved(code: string, returnTo: Stage5ReturnTo): never {
  redirect(`${returnTo}?stage5_saved=${encodeURIComponent(code)}`);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseOptionalAmount(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim().replace(",", ".");
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseRequiredThreshold(value: FormDataEntryValue | null) {
  const parsed = parseOptionalAmount(value);
  if (parsed === null) return null;
  return parsed > 1 ? parsed / 100 : parsed;
}

function normalizeCurrency(value: string | null) {
  const normalized = (value ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

async function getStage5Context(returnTo: Stage5ReturnTo, requiredRole: "viewer" | "editor" | "admin" = "editor") {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/login");

  const family = await getActiveFamily(supabase, userId);
  if (!family) redirectWithStage5Error("no-family", returnTo);
  if (requiredRole === "admin") {
    if (!canManageFamily(family.role)) redirectWithStage5Error("forbidden", returnTo);
  } else if (requiredRole === "editor" && !canEditFamilyData(family.role)) {
    redirectWithStage5Error("forbidden", returnTo);
  }

  return { family, supabase, userId };
}

async function assertAssetBelongsToFamily(supabase: Awaited<ReturnType<typeof createClient>>, familyId: string, assetId: string | null) {
  if (!assetId) return;
  const { data: asset } = await supabase
    .from("assets")
    .select("id")
    .eq("family_id", familyId)
    .eq("id", assetId)
    .maybeSingle();
  if (!asset) throw new Error("asset-not-found");
}

async function addAudit({
  action,
  afterData,
  entityId,
  entityTable,
  familyId,
  supabase,
  userId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  familyId: string;
  userId: string;
  action: string;
  entityTable: string;
  entityId: string | null;
  afterData: Record<string, unknown>;
}) {
  await supabase.from("audit_log").insert({
    family_id: familyId,
    actor_user_id: userId,
    action,
    entity_table: entityTable,
    entity_id: entityId,
    after_data: afterData,
  });
}

async function getTelegramPreference(supabase: Awaited<ReturnType<typeof createClient>>, familyId: string) {
  const { data } = await supabase
    .from("notification_preferences")
    .select("id, status, settings")
    .eq("family_id", familyId)
    .eq("channel", "telegram")
    .maybeSingle();

  return data as { id: string; status: string; settings: Record<string, unknown> } | null;
}

async function recordTelegramDelivery({
  alertId,
  errorMessage,
  familyId,
  payload,
  sentAt,
  status,
  supabase,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  familyId: string;
  alertId: string | null;
  status: "sent" | "failed" | "skipped";
  errorMessage: string | null;
  payload: Record<string, unknown>;
  sentAt: string | null;
}) {
  await supabase.from("notification_deliveries").insert({
    family_id: familyId,
    alert_id: alertId,
    channel: "telegram",
    status,
    error_message: errorMessage,
    payload,
    sent_at: sentAt,
  });
}

async function sendTelegramForAlert({
  alertId,
  familyId,
  href,
  severity,
  supabase,
  title,
  value,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  familyId: string;
  alertId: string;
  title: string;
  severity: string;
  value?: string | null;
  href?: string | null;
}) {
  const preference = await getTelegramPreference(supabase, familyId);
  if (!preference || preference.status !== "enabled") return;

  const { data: alreadySent } = await supabase
    .from("notification_deliveries")
    .select("id")
    .eq("family_id", familyId)
    .eq("alert_id", alertId)
    .eq("channel", "telegram")
    .eq("status", "sent")
    .limit(1)
    .maybeSingle();

  if (alreadySent?.id) return;

  const chatId = typeof preference.settings.chat_id === "string" ? preference.settings.chat_id : null;
  const messageThreadId = typeof preference.settings.message_thread_id === "string" ? preference.settings.message_thread_id : null;
  const appUrl = process.env.APP_PUBLIC_URL ? `${process.env.APP_PUBLIC_URL}${href ?? "/settings"}` : href;
  const result = await sendTelegramMessage({
    chatId,
    messageThreadId,
    text: buildTelegramAlertMessage({ appUrl, severity, title, value }),
  });

  await recordTelegramDelivery({
    supabase,
    familyId,
    alertId,
    status: result.status,
    errorMessage: result.errorMessage,
    payload: result.payload,
    sentAt: result.status === "sent" ? new Date().toISOString() : null,
  });
}

async function getMaxPreference(supabase: Awaited<ReturnType<typeof createClient>>, familyId: string) {
  const { data } = await supabase
    .from("notification_preferences")
    .select("id, status, settings")
    .eq("family_id", familyId)
    .eq("channel", "max")
    .maybeSingle();

  return data as { id: string; status: string; settings: Record<string, unknown> } | null;
}

async function recordMaxDelivery({
  alertId,
  errorMessage,
  familyId,
  payload,
  sentAt,
  status,
  supabase,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  familyId: string;
  alertId: string | null;
  status: "sent" | "failed" | "skipped";
  errorMessage: string | null;
  payload: Record<string, unknown>;
  sentAt: string | null;
}) {
  await supabase.from("notification_deliveries").insert({
    family_id: familyId,
    alert_id: alertId,
    channel: "max",
    status,
    error_message: errorMessage,
    payload,
    sent_at: sentAt,
  });
}

async function sendMaxForAlert({
  alertId,
  familyId,
  href,
  severity,
  supabase,
  title,
  value,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  familyId: string;
  alertId: string;
  title: string;
  severity: string;
  value?: string | null;
  href?: string | null;
}) {
  const preference = await getMaxPreference(supabase, familyId);
  if (!preference || preference.status !== "enabled") return;

  const { data: alreadySent } = await supabase
    .from("notification_deliveries")
    .select("id")
    .eq("family_id", familyId)
    .eq("alert_id", alertId)
    .eq("channel", "max")
    .eq("status", "sent")
    .limit(1)
    .maybeSingle();

  if (alreadySent?.id) return;

  const recipientType = preference.settings.recipient_type === "chat" ? "chat" : "user";
  const userId = typeof preference.settings.user_id === "string" ? preference.settings.user_id : null;
  const chatId = typeof preference.settings.chat_id === "string" ? preference.settings.chat_id : null;
  const appUrl = process.env.APP_PUBLIC_URL ? `${process.env.APP_PUBLIC_URL}${href ?? "/settings"}` : href;
  const result = await sendMaxMessage({
    recipient: recipientType === "user" ? { type: "user", id: userId } : { type: "chat", id: chatId },
    text: buildMaxAlertMessage({ appUrl, severity, title, value }),
  });

  await recordMaxDelivery({
    supabase,
    familyId,
    alertId,
    status: result.status,
    errorMessage: result.errorMessage,
    payload: result.payload,
    sentAt: result.status === "sent" ? new Date().toISOString() : null,
  });
}

async function addWatchlistRecord({
  familyId,
  itemType,
  newsItemId = null,
  recommendationId = null,
  assetId = null,
  notes,
  supabase,
  title,
  userId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  familyId: string;
  userId: string;
  itemType: "asset" | "news" | "idea" | "recommendation";
  title: string;
  notes: string | null;
  assetId?: string | null;
  newsItemId?: string | null;
  recommendationId?: string | null;
}) {
  let existingQuery = supabase
    .from("watchlist_items")
    .select("id")
    .eq("family_id", familyId)
    .neq("status", "archived")
    .eq("item_type", itemType);

  if (assetId) existingQuery = existingQuery.eq("asset_id", assetId);
  if (newsItemId) existingQuery = existingQuery.eq("news_item_id", newsItemId);
  if (recommendationId) existingQuery = existingQuery.eq("recommendation_id", recommendationId);

  const { data: existing } = await existingQuery.limit(1).maybeSingle();
  if (existing?.id) {
    await supabase
      .from("watchlist_items")
      .update({ notes, status: "watching", updated_by: userId })
      .eq("family_id", familyId)
      .eq("id", existing.id);
    return existing.id as string;
  }

  const { data: inserted, error } = await supabase
    .from("watchlist_items")
    .insert({
      family_id: familyId,
      item_type: itemType,
      asset_id: assetId,
      news_item_id: newsItemId,
      recommendation_id: recommendationId,
      title,
      notes,
      created_by: userId,
      updated_by: userId,
    })
    .select("id")
    .single();

  if (error || !inserted?.id) throw new Error(`watchlist insert failed: ${error?.message ?? "unknown"}`);
  return inserted.id as string;
}

async function ensureRecommendationFromForm(formData: FormData, returnTo: Stage5ReturnTo, requiredRole: "editor" | "admin" = "editor") {
  const { family, supabase, userId } = await getStage5Context(returnTo, requiredRole);
  const recommendationId = textField(formData, "recommendation_id");

  if (isUuid(recommendationId)) {
    const { data: recommendation } = await supabase
      .from("recommendations")
      .select("id, title")
      .eq("family_id", family.id)
      .eq("id", recommendationId)
      .maybeSingle();
    if (!recommendation) redirectWithStage5Error("recommendation-not-found", returnTo);
    return { family, recommendation, supabase, userId };
  }

  const fingerprint = textField(formData, "fingerprint");
  const title = textField(formData, "title");
  const body = optionalTextField(formData, "body");
  const reason = optionalTextField(formData, "reason");
  const priority = textField(formData, "priority") || "normal";
  const recommendationType = textField(formData, "recommendation_type") || "manual";
  const confidence = parseOptionalAmount(formData.get("confidence"));

  if (!fingerprint || !title) redirectWithStage5Error("recommendation-generated-invalid", returnTo);

  const { data: existing } = await supabase
    .from("recommendations")
    .select("id, title")
    .eq("family_id", family.id)
    .eq("fingerprint", fingerprint)
    .in("status", ["draft", "open"])
    .limit(1)
    .maybeSingle();

  if (existing?.id) return { family, recommendation: existing, supabase, userId };

  const { data: inserted, error } = await supabase
    .from("recommendations")
    .insert({
      family_id: family.id,
      title,
      body,
      reason,
      priority,
      recommendation_type: recommendationType,
      source: "rule_based",
      confidence,
      fingerprint,
      last_generated_at: new Date().toISOString(),
      created_by: userId,
      updated_by: userId,
    })
    .select("id, title")
    .single();

  if (error || !inserted?.id) throw new Error(`recommendation insert failed: ${error?.message ?? "unknown"}`);

  await addAudit({
    supabase,
    familyId: family.id,
    userId,
    action: "persist_generated_recommendation",
    entityTable: "recommendations",
    entityId: inserted.id,
    afterData: { title, fingerprint, recommendation_type: recommendationType },
  });

  return { family, recommendation: inserted, supabase, userId };
}

export async function createNewsItem(formData: FormData) {
  const returnTo = safeReturnTo(textField(formData, "return_to"), "/news");
  const { family, supabase, userId } = await getStage5Context(returnTo);

  const title = textField(formData, "title");
  const source = textField(formData, "source");
  const kind = textField(formData, "kind") || "portfolio_news";
  const assetId = optionalTextField(formData, "asset_id");
  const publishedAt = textField(formData, "published_at") || new Date().toISOString();

  if (!title) redirectWithStage5Error("news-title-required", returnTo);
  if (!source) redirectWithStage5Error("news-source-required", returnTo);
  if (!newsKinds.has(kind)) redirectWithStage5Error("news-kind-invalid", returnTo);

  try {
    await assertAssetBelongsToFamily(supabase, family.id, assetId);
  } catch {
    redirectWithStage5Error("asset-not-found", returnTo);
  }

  const { data: newsItem, error } = await supabase
    .from("news_items")
    .insert({
      family_id: family.id,
      asset_id: assetId,
      source,
      external_id: optionalTextField(formData, "external_id"),
      kind,
      title,
      summary: optionalTextField(formData, "summary"),
      url: optionalTextField(formData, "url"),
      published_at: publishedAt,
      payload: {},
    })
    .select("id")
    .single();

  if (error || !newsItem?.id) throw new Error(`news insert failed: ${error?.message ?? "unknown"}`);

  await addAudit({
    supabase,
    familyId: family.id,
    userId,
    action: "create_news_item",
    entityTable: "news_items",
    entityId: newsItem.id,
    afterData: { title, source, kind, asset_id: assetId },
  });

  revalidatePath("/news");
  revalidatePath("/dashboard");
  redirectWithStage5Saved("news", returnTo);
}

export async function addNewsToWatchlist(formData: FormData) {
  const returnTo = safeReturnTo(textField(formData, "return_to"), "/news");
  const { family, supabase, userId } = await getStage5Context(returnTo);
  const newsItemId = textField(formData, "news_item_id");
  if (!newsItemId) redirectWithStage5Error("news-required", returnTo);

  const { data: newsItem } = await supabase
    .from("news_items")
    .select("id, title, kind")
    .eq("family_id", family.id)
    .eq("id", newsItemId)
    .maybeSingle();

  if (!newsItem) redirectWithStage5Error("news-not-found", returnTo);

  const watchlistId = await addWatchlistRecord({
    supabase,
    familyId: family.id,
    userId,
    itemType: newsItem.kind === "idea" ? "idea" : "news",
    newsItemId: newsItem.id,
    title: newsItem.title,
    notes: optionalTextField(formData, "notes"),
  });

  await addAudit({
    supabase,
    familyId: family.id,
    userId,
    action: "add_news_to_watchlist",
    entityTable: "watchlist_items",
    entityId: watchlistId,
    afterData: { news_item_id: newsItem.id, title: newsItem.title },
  });

  revalidatePath("/news");
  revalidatePath("/watchlist");
  revalidatePath("/dashboard");
  redirectWithStage5Saved("watchlist-news", returnTo);
}

export async function addAssetToWatchlist(formData: FormData) {
  const returnTo = safeReturnTo(textField(formData, "return_to"), "/assets");
  const { family, supabase, userId } = await getStage5Context(returnTo);
  const assetId = textField(formData, "asset_id");
  if (!assetId) redirectWithStage5Error("asset-required", returnTo);

  const { data: asset } = await supabase
    .from("assets")
    .select("id, name, ticker, currency_code")
    .eq("family_id", family.id)
    .eq("id", assetId)
    .maybeSingle();

  if (!asset) redirectWithStage5Error("asset-not-found", returnTo);

  const watchlistId = await addWatchlistRecord({
    supabase,
    familyId: family.id,
    userId,
    itemType: "asset",
    assetId: asset.id,
    title: asset.name,
    notes: optionalTextField(formData, "notes"),
  });

  await addAudit({
    supabase,
    familyId: family.id,
    userId,
    action: "add_asset_to_watchlist",
    entityTable: "watchlist_items",
    entityId: watchlistId,
    afterData: { asset_id: asset.id, title: asset.name, ticker: asset.ticker, currency_code: asset.currency_code },
  });

  revalidatePath("/assets");
  revalidatePath("/watchlist");
  revalidatePath("/dashboard");
  redirectWithStage5Saved("watchlist-asset", returnTo);
}

export async function saveRecommendationToWatchlist(formData: FormData) {
  const returnTo = safeReturnTo(textField(formData, "return_to"), "/recommendations");
  const { family, recommendation, supabase, userId } = await ensureRecommendationFromForm(formData, returnTo);

  const watchlistId = await addWatchlistRecord({
    supabase,
    familyId: family.id,
    userId,
    itemType: "recommendation",
    recommendationId: recommendation.id,
    title: recommendation.title,
    notes: optionalTextField(formData, "notes"),
  });

  await addAudit({
    supabase,
    familyId: family.id,
    userId,
    action: "add_recommendation_to_watchlist",
    entityTable: "watchlist_items",
    entityId: watchlistId,
    afterData: { recommendation_id: recommendation.id, title: recommendation.title },
  });

  revalidatePath("/recommendations");
  revalidatePath("/watchlist");
  revalidatePath("/dashboard");
  redirectWithStage5Saved("watchlist-recommendation", returnTo);
}

export async function updateRecommendationStatus(formData: FormData) {
  const returnTo = safeReturnTo(textField(formData, "return_to"), "/recommendations");
  const status = textField(formData, "status");
  if (!recommendationStatuses.has(status)) redirectWithStage5Error("recommendation-status-invalid", returnTo);

  const { family, recommendation, supabase, userId } = await ensureRecommendationFromForm(formData, returnTo);
  const now = new Date().toISOString();
  const statusDate: Record<string, string | null> = {};
  if (status === "accepted") statusDate.accepted_at = now;
  if (status === "rejected") statusDate.rejected_at = now;
  if (status === "archived") statusDate.archived_at = now;

  const { error } = await supabase
    .from("recommendations")
    .update({
      status,
      updated_by: userId,
      status_changed_by: userId,
      ...statusDate,
    })
    .eq("family_id", family.id)
    .eq("id", recommendation.id);

  if (error) throw new Error(`recommendation status update failed: ${error.message}`);

  await addAudit({
    supabase,
    familyId: family.id,
    userId,
    action: "update_recommendation_status",
    entityTable: "recommendations",
    entityId: recommendation.id,
    afterData: { status },
  });

  revalidatePath("/recommendations");
  revalidatePath("/dashboard");
  redirectWithStage5Saved("recommendation-status", returnTo);
}

export async function markRecommendationRead(formData: FormData) {
  const returnTo = safeReturnTo(textField(formData, "return_to"), "/recommendations");
  const { family, recommendation, supabase, userId } = await ensureRecommendationFromForm(formData, returnTo);
  const readAt = new Date().toISOString();

  const { error } = await supabase
    .from("recommendation_reads")
    .upsert({
      family_id: family.id,
      recommendation_id: recommendation.id,
      user_id: userId,
      read_at: readAt,
    }, { onConflict: "family_id,recommendation_id,user_id" });

  if (error) throw new Error(`recommendation read upsert failed: ${error.message}`);

  await addAudit({
    supabase,
    familyId: family.id,
    userId,
    action: "mark_recommendation_read",
    entityTable: "recommendation_reads",
    entityId: recommendation.id,
    afterData: { recommendation_id: recommendation.id, read_at: readAt },
  });

  revalidatePath("/recommendations");
  redirectWithStage5Saved("recommendation-read", returnTo);
}

export async function updateWatchlistItem(formData: FormData) {
  const returnTo = safeReturnTo(textField(formData, "return_to"), "/watchlist");
  const { family, supabase, userId } = await getStage5Context(returnTo);
  const itemId = textField(formData, "watchlist_item_id");
  const status = textField(formData, "status") || "watching";

  if (!itemId) redirectWithStage5Error("watchlist-required", returnTo);
  if (!watchlistStatuses.has(status)) redirectWithStage5Error("watchlist-status-invalid", returnTo);

  const { data: item } = await supabase
    .from("watchlist_items")
    .select("id")
    .eq("family_id", family.id)
    .eq("id", itemId)
    .maybeSingle();

  if (!item) redirectWithStage5Error("watchlist-not-found", returnTo);

  const { error } = await supabase
    .from("watchlist_items")
    .update({
      notes: optionalTextField(formData, "notes"),
      status,
      updated_by: userId,
    })
    .eq("family_id", family.id)
    .eq("id", itemId);

  if (error) throw new Error(`watchlist update failed: ${error.message}`);

  await addAudit({
    supabase,
    familyId: family.id,
    userId,
    action: "update_watchlist_item",
    entityTable: "watchlist_items",
    entityId: itemId,
    afterData: { status },
  });

  revalidatePath("/watchlist");
  revalidatePath("/news");
  revalidatePath("/recommendations");
  redirectWithStage5Saved("watchlist", returnTo);
}

export async function archiveWatchlistItem(formData: FormData) {
  const returnTo = safeReturnTo(textField(formData, "return_to"), "/watchlist");
  const { family, supabase, userId } = await getStage5Context(returnTo);
  const itemId = textField(formData, "watchlist_item_id");

  if (!itemId) redirectWithStage5Error("watchlist-required", returnTo);

  const { data: item } = await supabase
    .from("watchlist_items")
    .select("id, item_type, news_item_id, asset_id, recommendation_id")
    .eq("family_id", family.id)
    .eq("id", itemId)
    .maybeSingle();

  if (!item) redirectWithStage5Error("watchlist-not-found", returnTo);

  const { error } = await supabase
    .from("watchlist_items")
    .update({
      status: "archived",
      updated_by: userId,
    })
    .eq("family_id", family.id)
    .eq("id", itemId);

  if (error) throw new Error(`watchlist archive failed: ${error.message}`);

  await addAudit({
    supabase,
    familyId: family.id,
    userId,
    action: "archive_watchlist_item",
    entityTable: "watchlist_items",
    entityId: itemId,
    afterData: {
      status: "archived",
      item_type: item.item_type,
      news_item_id: item.news_item_id,
      asset_id: item.asset_id,
      recommendation_id: item.recommendation_id,
    },
  });

  revalidatePath("/watchlist");
  revalidatePath("/news");
  revalidatePath("/assets");
  revalidatePath("/recommendations");
  revalidatePath("/dashboard");
  redirectWithStage5Saved("watchlist-archived", returnTo);
}

export async function createPortfolioEvent(formData: FormData) {
  const returnTo = safeReturnTo(textField(formData, "return_to"), "/events");
  const { family, supabase, userId } = await getStage5Context(returnTo);

  const title = textField(formData, "title");
  const eventType = textField(formData, "event_type");
  const eventDate = textField(formData, "event_date");
  const assetId = optionalTextField(formData, "asset_id");
  const amount = parseOptionalAmount(formData.get("amount"));
  const currencyCode = normalizeCurrency(optionalTextField(formData, "currency_code") ?? family.baseCurrency);

  if (!title) redirectWithStage5Error("event-title-required", returnTo);
  if (!eventTypes.has(eventType)) redirectWithStage5Error("event-type-invalid", returnTo);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) redirectWithStage5Error("event-date-invalid", returnTo);
  if (textField(formData, "amount") && amount === null) redirectWithStage5Error("event-amount-invalid", returnTo);
  if (amount !== null && !currencyCode) redirectWithStage5Error("currency-invalid", returnTo);

  try {
    await assertAssetBelongsToFamily(supabase, family.id, assetId);
  } catch {
    redirectWithStage5Error("asset-not-found", returnTo);
  }

  const portfolioId = textField(formData, "portfolio_id") || null;
  const { data: event, error } = await supabase
    .from("events")
    .insert({
      family_id: family.id,
      portfolio_id: portfolioId,
      asset_id: assetId,
      event_type: eventType,
      title,
      event_date: eventDate,
      amount,
      currency_code: amount !== null ? currencyCode : null,
      status: "scheduled",
      source: "manual",
      payload: {},
      created_by: userId,
      updated_by: userId,
    })
    .select("id")
    .single();

  if (error || !event?.id) throw new Error(`event insert failed: ${error?.message ?? "unknown"}`);

  await addAudit({
    supabase,
    familyId: family.id,
    userId,
    action: "create_portfolio_event",
    entityTable: "events",
    entityId: event.id,
    afterData: { title, event_type: eventType, event_date: eventDate, asset_id: assetId },
  });

  revalidatePath("/events");
  revalidatePath("/dashboard");
  redirectWithStage5Saved("event", returnTo);
}

export async function updatePortfolioEvent(formData: FormData) {
  const returnTo = safeReturnTo(textField(formData, "return_to"), "/events");
  const { family, supabase, userId } = await getStage5Context(returnTo);

  const eventId = textField(formData, "event_id");
  const title = textField(formData, "title");
  const eventType = textField(formData, "event_type");
  const eventDate = textField(formData, "event_date");
  const status = textField(formData, "status") || "scheduled";
  const assetId = optionalTextField(formData, "asset_id");
  const amount = parseOptionalAmount(formData.get("amount"));
  const currencyCode = normalizeCurrency(optionalTextField(formData, "currency_code") ?? family.baseCurrency);

  if (!eventId) redirectWithStage5Error("event-required", returnTo);
  if (!title) redirectWithStage5Error("event-title-required", returnTo);
  if (!eventTypes.has(eventType)) redirectWithStage5Error("event-type-invalid", returnTo);
  if (!eventStatuses.has(status)) redirectWithStage5Error("event-status-invalid", returnTo);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) redirectWithStage5Error("event-date-invalid", returnTo);
  if (textField(formData, "amount") && amount === null) redirectWithStage5Error("event-amount-invalid", returnTo);
  if (amount !== null && !currencyCode) redirectWithStage5Error("currency-invalid", returnTo);

  try {
    await assertAssetBelongsToFamily(supabase, family.id, assetId);
  } catch {
    redirectWithStage5Error("asset-not-found", returnTo);
  }

  const { data: existing } = await supabase
    .from("events")
    .select("id")
    .eq("family_id", family.id)
    .eq("id", eventId)
    .maybeSingle();

  if (!existing) redirectWithStage5Error("event-not-found", returnTo);

  const { error } = await supabase
    .from("events")
    .update({
      asset_id: assetId,
      event_type: eventType,
      title,
      event_date: eventDate,
      amount,
      currency_code: amount !== null ? currencyCode : null,
      status,
      updated_by: userId,
    })
    .eq("family_id", family.id)
    .eq("id", eventId);

  if (error) throw new Error(`event update failed: ${error.message}`);

  await addAudit({
    supabase,
    familyId: family.id,
    userId,
    action: "update_portfolio_event",
    entityTable: "events",
    entityId: eventId,
    afterData: { title, event_type: eventType, event_date: eventDate, status, asset_id: assetId },
  });

  revalidatePath("/events");
  revalidatePath("/dashboard");
  redirectWithStage5Saved("event-updated", returnTo);
}

export async function createLimit(formData: FormData) {
  const returnTo = safeReturnTo(textField(formData, "return_to"), "/settings");
  const { family, supabase, userId } = await getStage5Context(returnTo, "admin");

  const limitType = textField(formData, "limit_type");
  const direction = textField(formData, "direction");
  const severity = textField(formData, "severity") || "warning";
  const threshold = parseRequiredThreshold(formData.get("threshold_value"));
  const scopeKey = optionalTextField(formData, "scope_key");

  if (!limitTypes.has(limitType)) redirectWithStage5Error("limit-type-invalid", returnTo);
  if (!limitDirections.has(direction)) redirectWithStage5Error("limit-direction-invalid", returnTo);
  if (!limitSeverities.has(severity)) redirectWithStage5Error("limit-severity-invalid", returnTo);
  if (threshold === null) redirectWithStage5Error("limit-threshold-invalid", returnTo);
  if ((limitType === "asset_share" || limitType === "asset_class_share" || limitType === "currency_share") && !scopeKey) {
    redirectWithStage5Error("limit-scope-required", returnTo);
  }

  if (limitType === "asset_share") {
    try {
      await assertAssetBelongsToFamily(supabase, family.id, scopeKey);
    } catch {
      redirectWithStage5Error("asset-not-found", returnTo);
    }
  }

  const { data: limit, error } = await supabase
    .from("limits")
    .insert({
      family_id: family.id,
      limit_type: limitType,
      scope_key: scopeKey,
      threshold_value: threshold,
      direction,
      severity,
      created_by: userId,
      updated_by: userId,
    })
    .select("id")
    .single();

  if (error || !limit?.id) throw new Error(`limit insert failed: ${error?.message ?? "unknown"}`);

  await addAudit({
    supabase,
    familyId: family.id,
    userId,
    action: "create_limit",
    entityTable: "limits",
    entityId: limit.id,
    afterData: { limit_type: limitType, scope_key: scopeKey, threshold_value: threshold, direction, severity },
  });

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  redirectWithStage5Saved("limit", returnTo);
}

export async function createDefaultLimits(formData: FormData) {
  const returnTo = safeReturnTo(textField(formData, "return_to"), "/settings");
  const { family, supabase, userId } = await getStage5Context(returnTo, "admin");

  const { data: activeLimits } = await supabase
    .from("limits")
    .select("limit_type, scope_key, direction")
    .eq("family_id", family.id)
    .eq("status", "active");

  const existingKeys = new Set((activeLimits ?? []).map((limit) => `${limit.limit_type}:${limit.scope_key ?? ""}:${limit.direction}`));
  const templatesToInsert = defaultLimitTemplates.filter((template) => !existingKeys.has(`${template.limit_type}:${template.scope_key ?? ""}:${template.direction}`));

  if (templatesToInsert.length > 0) {
    const { error } = await supabase
      .from("limits")
      .insert(templatesToInsert.map((template) => ({
        family_id: family.id,
        ...template,
        created_by: userId,
        updated_by: userId,
      })));
    if (error) throw new Error(`default limits insert failed: ${error.message}`);
  }

  await addAudit({
    supabase,
    familyId: family.id,
    userId,
    action: "create_default_limits",
    entityTable: "limits",
    entityId: null,
    afterData: { inserted_count: templatesToInsert.length },
  });

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  redirectWithStage5Saved(templatesToInsert.length > 0 ? "limits-template" : "limits-template-empty", returnTo);
}

export async function updateLimit(formData: FormData) {
  const returnTo = safeReturnTo(textField(formData, "return_to"), "/settings");
  const { family, supabase, userId } = await getStage5Context(returnTo, "admin");

  const limitId = textField(formData, "limit_id");
  const limitType = textField(formData, "limit_type");
  const direction = textField(formData, "direction");
  const severity = textField(formData, "severity") || "warning";
  const threshold = parseRequiredThreshold(formData.get("threshold_value"));
  const scopeKey = optionalTextField(formData, "scope_key");

  if (!limitId) redirectWithStage5Error("limit-required", returnTo);
  if (!limitTypes.has(limitType)) redirectWithStage5Error("limit-type-invalid", returnTo);
  if (!limitDirections.has(direction)) redirectWithStage5Error("limit-direction-invalid", returnTo);
  if (!limitSeverities.has(severity)) redirectWithStage5Error("limit-severity-invalid", returnTo);
  if (threshold === null) redirectWithStage5Error("limit-threshold-invalid", returnTo);
  if ((limitType === "asset_share" || limitType === "asset_class_share" || limitType === "currency_share") && !scopeKey) {
    redirectWithStage5Error("limit-scope-required", returnTo);
  }

  if (limitType === "asset_share") {
    try {
      await assertAssetBelongsToFamily(supabase, family.id, scopeKey);
    } catch {
      redirectWithStage5Error("asset-not-found", returnTo);
    }
  }

  const { data: existing } = await supabase
    .from("limits")
    .select("id")
    .eq("family_id", family.id)
    .eq("id", limitId)
    .maybeSingle();

  if (!existing) redirectWithStage5Error("limit-not-found", returnTo);

  const { error } = await supabase
    .from("limits")
    .update({
      limit_type: limitType,
      scope_key: scopeKey,
      threshold_value: threshold,
      direction,
      severity,
      updated_by: userId,
    })
    .eq("family_id", family.id)
    .eq("id", limitId);

  if (error) throw new Error(`limit update failed: ${error.message}`);

  await addAudit({
    supabase,
    familyId: family.id,
    userId,
    action: "update_limit",
    entityTable: "limits",
    entityId: limitId,
    afterData: { limit_type: limitType, scope_key: scopeKey, threshold_value: threshold, direction, severity },
  });

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  redirectWithStage5Saved("limit-updated", returnTo);
}

export async function archiveLimit(formData: FormData) {
  const returnTo = safeReturnTo(textField(formData, "return_to"), "/settings");
  const { family, supabase, userId } = await getStage5Context(returnTo, "admin");
  const limitId = textField(formData, "limit_id");
  if (!limitId) redirectWithStage5Error("limit-required", returnTo);

  const { data: limit } = await supabase
    .from("limits")
    .select("id")
    .eq("family_id", family.id)
    .eq("id", limitId)
    .maybeSingle();

  if (!limit) redirectWithStage5Error("limit-not-found", returnTo);

  const { error } = await supabase
    .from("limits")
    .update({ status: "archived", updated_by: userId })
    .eq("family_id", family.id)
    .eq("id", limitId);

  if (error) throw new Error(`limit archive failed: ${error.message}`);

  await addAudit({
    supabase,
    familyId: family.id,
    userId,
    action: "archive_limit",
    entityTable: "limits",
    entityId: limitId,
    afterData: { status: "archived" },
  });

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  redirectWithStage5Saved("limit-archived", returnTo);
}

export async function checkLimits(formData: FormData) {
  const returnTo = safeReturnTo(textField(formData, "return_to"), "/settings");
  const { family, supabase, userId } = await getStage5Context(returnTo, "admin");
  const portfolioData = await getPortfolioData(supabase, family);
  const limitCheck = evaluatePortfolioLimitCheck({
    analytics: portfolioData.analytics,
    positions: portfolioData.positions,
    limits: portfolioData.limits,
  });
  const violations = limitCheck.violations;
  const now = new Date().toISOString();
  const activeLimitAlerts = portfolioData.systemAlerts.filter((alert) => alert.source === "limits" && alert.fingerprint);
  const alertPlan = planLimitAlertLifecycle({
    existingAlerts: activeLimitAlerts,
    violations,
  });

  for (const { alertId, violation } of alertPlan.update) {
    const alertRecord = {
      title: violation.title,
      condition_type: violation.limitType,
      status: "triggered",
      severity: violation.severity,
      fingerprint: violation.fingerprint,
      payload: {
        ...violation.payload,
        href: violation.href,
      },
      triggered_at: now,
      last_checked_at: now,
      source: "limits",
      updated_by: userId,
    };

    const { error } = await supabase
      .from("alerts")
      .update(alertRecord)
      .eq("family_id", family.id)
      .eq("id", alertId);
    if (error) throw new Error(`alert update failed: ${error.message}`);

    if (violation.severity === "critical") {
      const notificationValue = `Текущее значение: ${violation.payload.current_percent}%, порог: ${violation.payload.threshold_percent}%`;
      await sendTelegramForAlert({
        supabase,
        familyId: family.id,
        alertId,
        title: violation.title,
        severity: violation.severity,
        value: notificationValue,
        href: violation.href,
      });
      await sendMaxForAlert({
        supabase,
        familyId: family.id,
        alertId,
        title: violation.title,
        severity: violation.severity,
        value: notificationValue,
        href: violation.href,
      });
    }
  }

  for (const violation of alertPlan.create) {
    const alertRecord = {
      title: violation.title,
      condition_type: violation.limitType,
      status: "triggered",
      severity: violation.severity,
      fingerprint: violation.fingerprint,
      payload: {
        ...violation.payload,
        href: violation.href,
      },
      triggered_at: now,
      last_checked_at: now,
      source: "limits",
      updated_by: userId,
    };

    const { data: insertedAlert, error } = await supabase
      .from("alerts")
      .insert({
        ...alertRecord,
        family_id: family.id,
        created_by: userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(`alert insert failed: ${error.message}`);
    const alertId = insertedAlert?.id as string | undefined;

    if (alertId && violation.severity === "critical") {
      const notificationValue = `Текущее значение: ${violation.payload.current_percent}%, порог: ${violation.payload.threshold_percent}%`;
      await sendTelegramForAlert({
        supabase,
        familyId: family.id,
        alertId,
        title: violation.title,
        severity: violation.severity,
        value: notificationValue,
        href: violation.href,
      });
      await sendMaxForAlert({
        supabase,
        familyId: family.id,
        alertId,
        title: violation.title,
        severity: violation.severity,
        value: notificationValue,
        href: violation.href,
      });
    }
  }

  for (const alert of alertPlan.resolve) {
    const { error } = await supabase
      .from("alerts")
      .update({
        status: "archived",
        resolved_at: now,
        last_checked_at: now,
        updated_by: userId,
      })
      .eq("family_id", family.id)
      .eq("id", alert.id);
    if (error) throw new Error(`alert resolve failed: ${error.message}`);
  }

  await addAudit({
    supabase,
    familyId: family.id,
    userId,
    action: "check_limits",
    entityTable: "alerts",
    entityId: null,
    afterData: {
      violation_count: violations.length,
      partial_count: limitCheck.issues.filter((issue) => issue.status === "partial").length,
      skipped_count: limitCheck.issues.filter((issue) => issue.status === "skipped").length,
      issues: limitCheck.issues.map((issue) => issue.payload),
      created_count: alertPlan.create.length,
      updated_count: alertPlan.update.length,
      resolved_count: alertPlan.resolve.length,
    },
  });

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  redirectWithStage5Saved(
    violations.length > 0
      ? "limits-checked-with-alerts"
      : limitCheck.issues.length > 0
        ? "limits-checked-partial"
        : "limits-checked",
    returnTo,
  );
}

export async function saveTelegramSettings(formData: FormData) {
  const returnTo = safeReturnTo(textField(formData, "return_to"), "/settings");
  const { family, supabase, userId } = await getStage5Context(returnTo, "admin");
  const status = textField(formData, "status") || "disabled";
  const chatId = optionalTextField(formData, "chat_id");
  const messageThreadId = optionalTextField(formData, "message_thread_id");

  if (!notificationStatuses.has(status)) redirectWithStage5Error("telegram-status-invalid", returnTo);
  if (status === "enabled" && !chatId) redirectWithStage5Error("telegram-chat-required", returnTo);

  const settings: Record<string, string> = {};
  if (chatId) settings.chat_id = chatId;
  if (messageThreadId) settings.message_thread_id = messageThreadId;

  const { data: existing } = await supabase
    .from("notification_preferences")
    .select("id")
    .eq("family_id", family.id)
    .eq("channel", "telegram")
    .maybeSingle();

  if (existing?.id) {
    const { error } = await supabase
      .from("notification_preferences")
      .update({ status, settings, updated_by: userId })
      .eq("family_id", family.id)
      .eq("id", existing.id);
    if (error) throw new Error(`telegram settings update failed: ${error.message}`);
  } else {
    const { error } = await supabase
      .from("notification_preferences")
      .insert({
        family_id: family.id,
        channel: "telegram",
        status,
        settings,
        created_by: userId,
        updated_by: userId,
      });
    if (error) throw new Error(`telegram settings insert failed: ${error.message}`);
  }

  await addAudit({
    supabase,
    familyId: family.id,
    userId,
    action: "save_telegram_settings",
    entityTable: "notification_preferences",
    entityId: existing?.id ?? null,
    afterData: { channel: "telegram", status, has_chat_id: Boolean(chatId), has_thread_id: Boolean(messageThreadId) },
  });

  revalidatePath("/settings");
  redirectWithStage5Saved("telegram-settings", returnTo);
}

export async function testTelegramNotification(formData: FormData) {
  const returnTo = safeReturnTo(textField(formData, "return_to"), "/settings");
  const { family, supabase } = await getStage5Context(returnTo, "admin");
  const preference = await getTelegramPreference(supabase, family.id);
  if (!preference || preference.status !== "enabled") redirectWithStage5Error("telegram-not-enabled", returnTo);

  const chatId = typeof preference.settings.chat_id === "string" ? preference.settings.chat_id : null;
  const messageThreadId = typeof preference.settings.message_thread_id === "string" ? preference.settings.message_thread_id : null;
  const result = await sendTelegramMessage({
    chatId,
    messageThreadId,
    text: buildTelegramAlertMessage({
      severity: "info",
      title: "Тестовое уведомление",
      value: "Telegram для инвестиционного портфеля настроен.",
      appUrl: process.env.APP_PUBLIC_URL ?? null,
    }),
  });

  await recordTelegramDelivery({
    supabase,
    familyId: family.id,
    alertId: null,
    status: result.status,
    errorMessage: result.errorMessage,
    payload: result.payload,
    sentAt: result.status === "sent" ? new Date().toISOString() : null,
  });

  revalidatePath("/settings");
  redirectWithStage5Saved(result.status === "sent" ? "telegram-test-sent" : `telegram-test-${result.status}`, returnTo);
}

export async function saveMaxSettings(formData: FormData) {
  const returnTo = safeReturnTo(textField(formData, "return_to"), "/settings");
  const { family, supabase, userId } = await getStage5Context(returnTo, "admin");
  const status = textField(formData, "status") || "disabled";
  const recipientType = textField(formData, "recipient_type") || "user";
  const userIdValue = optionalTextField(formData, "user_id");
  const chatId = optionalTextField(formData, "chat_id");

  if (!notificationStatuses.has(status)) redirectWithStage5Error("max-status-invalid", returnTo);
  if (recipientType !== "user" && recipientType !== "chat") redirectWithStage5Error("max-recipient-invalid", returnTo);
  if (status === "enabled" && recipientType === "user" && !userIdValue) redirectWithStage5Error("max-user-required", returnTo);
  if (status === "enabled" && recipientType === "chat" && !chatId) redirectWithStage5Error("max-chat-required", returnTo);

  const settings: Record<string, string> = { recipient_type: recipientType };
  if (userIdValue) settings.user_id = userIdValue;
  if (chatId) settings.chat_id = chatId;

  const { data: existing } = await supabase
    .from("notification_preferences")
    .select("id")
    .eq("family_id", family.id)
    .eq("channel", "max")
    .maybeSingle();

  if (existing?.id) {
    const { error } = await supabase
      .from("notification_preferences")
      .update({ status, settings, updated_by: userId })
      .eq("family_id", family.id)
      .eq("id", existing.id);
    if (error) throw new Error(`max settings update failed: ${error.message}`);
  } else {
    const { error } = await supabase
      .from("notification_preferences")
      .insert({
        family_id: family.id,
        channel: "max",
        status,
        settings,
        created_by: userId,
        updated_by: userId,
      });
    if (error) throw new Error(`max settings insert failed: ${error.message}`);
  }

  await addAudit({
    supabase,
    familyId: family.id,
    userId,
    action: "save_max_settings",
    entityTable: "notification_preferences",
    entityId: existing?.id ?? null,
    afterData: {
      channel: "max",
      status,
      recipient_type: recipientType,
      has_user_id: Boolean(userIdValue),
      has_chat_id: Boolean(chatId),
    },
  });

  revalidatePath("/settings");
  redirectWithStage5Saved("max-settings", returnTo);
}

export async function testMaxNotification(formData: FormData) {
  const returnTo = safeReturnTo(textField(formData, "return_to"), "/settings");
  const { family, supabase } = await getStage5Context(returnTo, "admin");
  const preference = await getMaxPreference(supabase, family.id);
  if (!preference || preference.status !== "enabled") redirectWithStage5Error("max-not-enabled", returnTo);

  const recipientType = preference.settings.recipient_type === "chat" ? "chat" : "user";
  const userIdValue = typeof preference.settings.user_id === "string" ? preference.settings.user_id : null;
  const chatId = typeof preference.settings.chat_id === "string" ? preference.settings.chat_id : null;
  const result = await sendMaxMessage({
    recipient: recipientType === "user" ? { type: "user", id: userIdValue } : { type: "chat", id: chatId },
    text: buildMaxAlertMessage({
      severity: "info",
      title: "Тестовое уведомление",
      value: "MAX для инвестиционного портфеля настроен.",
      appUrl: process.env.APP_PUBLIC_URL ?? null,
    }),
  });

  await recordMaxDelivery({
    supabase,
    familyId: family.id,
    alertId: null,
    status: result.status,
    errorMessage: result.errorMessage,
    payload: result.payload,
    sentAt: result.status === "sent" ? new Date().toISOString() : null,
  });

  revalidatePath("/settings");
  redirectWithStage5Saved(result.status === "sent" ? "max-test-sent" : `max-test-${result.status}`, returnTo);
}

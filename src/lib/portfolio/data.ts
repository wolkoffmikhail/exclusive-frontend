import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPortfolioAnalytics, type PortfolioAnalytics } from "./analytics";
import { calculateCashBalances, calculatePositions, type CalculatedCashBalance } from "./calculations";
import { buildRuleBasedRecommendations, type RuleBasedRecommendation } from "./recommendations";

export type ActiveFamily = {
  id: string;
  name: string;
  baseCurrency: string;
  role: "admin" | "editor" | "viewer";
};

export type Portfolio = {
  id: string;
  family_id: string;
  name: string;
  base_currency: string;
  status: string;
  description: string | null;
  created_at: string;
};

export type Account = {
  id: string;
  family_id: string;
  portfolio_id: string;
  account_type_code: string;
  name: string;
  institution_name: string | null;
  currency_code: string;
  status: string;
};

export type Asset = {
  id: string;
  family_id: string;
  asset_type_code: string;
  name: string;
  ticker: string | null;
  isin: string | null;
  market: string | null;
  currency_code: string | null;
  status: string;
};

export type Operation = {
  id: string;
  family_id: string;
  account_id: string;
  asset_id: string | null;
  trade_date: string;
  operation_type_code: string;
  quantity: number | string | null;
  price: number | string | null;
  gross_amount: number | string | null;
  fee_amount: number | string | null;
  tax_amount: number | string | null;
  net_amount: number | string;
  currency_code: string;
  source: string;
  operation_group_id: string | null;
  metadata: Record<string, unknown>;
  notes: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
};

export type Position = {
  id: string;
  family_id: string;
  portfolio_id: string;
  account_id: string;
  account_name: string;
  asset_id: string | null;
  asset_name: string;
  ticker: string | null;
  asset_type_code: string | null;
  quantity: number;
  average_price: number | null;
  book_value: number;
  market_price: number | null;
  market_value: number | null;
  unrealized_pnl: number | null;
  valuation_date: string | null;
  net_cash_flow: number;
  currency_code: string;
};

export type PositionSnapshot = {
  id: string;
  family_id: string;
  portfolio_id: string;
  account_id: string | null;
  asset_id: string;
  snapshot_date: string;
  quantity: number | string;
  book_value_amount: number | string | null;
  market_value_amount: number | string | null;
  currency_code: string;
  source: string;
};

export type ImportJob = {
  id: string;
  family_id: string;
  account_id: string | null;
  original_file_name: string;
  storage_object_key: string | null;
  file_size_bytes: number | null;
  sha256: string;
  status: string;
  error_message: string | null;
  created_at: string;
};

export type ImportRow = {
  id: string;
  family_id: string;
  import_id: string;
  row_number: number;
  raw_data: Record<string, unknown>;
  normalized_data: Record<string, unknown> | null;
  status: string;
  error_message: string | null;
  created_at: string;
};

export type AuditLogEntry = {
  id: string;
  family_id: string;
  actor_user_id: string | null;
  action: string;
  entity_table: string;
  entity_id: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  created_at: string;
};

export type Recommendation = {
  id: string;
  family_id: string;
  portfolio_id: string | null;
  title: string;
  body: string | null;
  status: "draft" | "open" | "accepted" | "rejected" | "archived" | string;
  priority: "low" | "normal" | "high" | "critical" | string;
  due_on: string | null;
  recommendation_type: string;
  reason: string | null;
  source: "manual" | "rule_based" | "imported" | "external" | string;
  confidence: number | string | null;
  metrics: Record<string, unknown>;
  fingerprint: string | null;
  last_generated_at: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  href?: string;
  isGenerated?: boolean;
  linkedAssetId?: string | null;
};

export type RecommendationRead = {
  id: string;
  family_id: string;
  recommendation_id: string;
  user_id: string;
  read_at: string;
};

export type RecommendationLink = {
  id: string;
  family_id: string;
  recommendation_id: string;
  entity_table: "assets" | "accounts" | "portfolios" | "operations" | "events" | "news_items" | string;
  entity_id: string;
  relation_type: string;
  created_at: string;
};

export type NewsItem = {
  id: string;
  family_id: string;
  asset_id: string | null;
  source: string;
  external_id: string | null;
  kind: "portfolio_news" | "market_news" | "idea" | string;
  title: string;
  summary: string | null;
  url: string | null;
  published_at: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type WatchlistItem = {
  id: string;
  family_id: string;
  item_type: "asset" | "news" | "idea" | "recommendation" | string;
  asset_id: string | null;
  news_item_id: string | null;
  recommendation_id: string | null;
  title: string;
  notes: string | null;
  status: "watching" | "considering" | "done" | "archived" | string;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PortfolioEvent = {
  id: string;
  family_id: string;
  portfolio_id: string | null;
  asset_id: string | null;
  event_type: string;
  title: string;
  event_date: string;
  payload: Record<string, unknown>;
  status: "scheduled" | "done" | "cancelled" | string;
  amount: number | string | null;
  currency_code: string | null;
  source: "manual" | "import" | "external" | "calculated" | string;
  external_id: string | null;
  created_at: string;
  updated_at: string;
};

export type PortfolioLimit = {
  id: string;
  family_id: string;
  limit_type: string;
  scope_key: string | null;
  threshold_value: number | string;
  direction: "min" | "max" | string;
  severity: "info" | "warning" | "critical" | string;
  status: "active" | "archived" | string;
  created_at: string;
  updated_at: string;
};

export type SystemAlert = {
  id: string;
  family_id: string;
  portfolio_id: string | null;
  asset_id: string | null;
  title: string;
  condition_type: string;
  status: string;
  payload: Record<string, unknown>;
  triggered_at: string | null;
  severity: "info" | "warning" | "critical" | string;
  fingerprint: string | null;
  resolved_at: string | null;
  last_checked_at: string | null;
  source: string;
  created_at: string;
  updated_at: string;
};

export type NotificationPreference = {
  id: string;
  family_id: string;
  channel: "telegram" | string;
  status: "enabled" | "disabled" | string;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type NotificationDelivery = {
  id: string;
  family_id: string;
  alert_id: string | null;
  channel: "telegram" | string;
  status: "pending" | "sent" | "failed" | "skipped" | string;
  error_message: string | null;
  payload: Record<string, unknown>;
  sent_at: string | null;
  created_at: string;
};

export type PortfolioData = {
  family: ActiveFamily | null;
  portfolios: Portfolio[];
  accounts: Account[];
  assets: Asset[];
  operations: Operation[];
  operationCount: number;
  positionSnapshots: PositionSnapshot[];
  positions: Position[];
  cashBalances: CalculatedCashBalance[];
  analytics: PortfolioAnalytics;
  imports: ImportJob[];
  importRows: ImportRow[];
  auditLog: AuditLogEntry[];
  recommendations: Recommendation[];
  recommendationReads: RecommendationRead[];
  recommendationLinks: RecommendationLink[];
  newsItems: NewsItem[];
  watchlistItems: WatchlistItem[];
  events: PortfolioEvent[];
  limits: PortfolioLimit[];
  systemAlerts: SystemAlert[];
  notificationPreferences: NotificationPreference[];
  notificationDeliveries: NotificationDelivery[];
};

type FamilyMemberRow = {
  family_id: string;
  role: ActiveFamily["role"];
  families?: { id?: string; name?: string; base_currency?: string } | Array<{ id?: string; name?: string; base_currency?: string }> | null;
};

function rows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

function sanitizeNotificationSettings(settings: Record<string, unknown>) {
  const safeSettings = { ...settings };
  delete safeSettings.bot_token;
  delete safeSettings.token;
  return safeSettings;
}

export async function getActiveFamily(supabase: SupabaseClient, userId: string): Promise<ActiveFamily | null> {
  const { data } = await supabase
    .from("family_members")
    .select("family_id, role, families(id, name, base_currency)")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  const membership = data as FamilyMemberRow | null;
  if (!membership) return null;

  const family = Array.isArray(membership.families)
    ? membership.families[0]
    : membership.families;

  return {
    id: membership.family_id,
    name: family?.name ?? "Семья не назначена",
    baseCurrency: family?.base_currency ?? "RUB",
    role: membership.role,
  };
}

export async function getPortfolioData(supabase: SupabaseClient, family: ActiveFamily | null): Promise<PortfolioData> {
  if (!family) {
    return {
      family,
      portfolios: [],
      accounts: [],
      assets: [],
      operations: [],
      operationCount: 0,
      positionSnapshots: [],
      positions: [],
      cashBalances: [],
      analytics: buildPortfolioAnalytics({
        operations: [],
        positions: [],
        cashBalances: [],
        baseCurrency: "RUB",
      }),
      imports: [],
      importRows: [],
      auditLog: [],
      recommendations: [],
      recommendationReads: [],
      recommendationLinks: [],
      newsItems: [],
      watchlistItems: [],
      events: [],
      limits: [],
      systemAlerts: [],
      notificationPreferences: [],
      notificationDeliveries: [],
    };
  }

  const [
    portfolios,
    accounts,
    assets,
    operations,
    positionSnapshots,
    imports,
    importRows,
    auditLog,
    recommendations,
    recommendationReads,
    recommendationLinks,
    newsItems,
    watchlistItems,
    events,
    limits,
    systemAlerts,
    notificationPreferences,
    notificationDeliveries,
  ] = await Promise.all([
    supabase
      .from("portfolios")
      .select("id, family_id, name, base_currency, status, description, created_at")
      .eq("family_id", family.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("accounts")
      .select("id, family_id, portfolio_id, account_type_code, name, institution_name, currency_code, status")
      .eq("family_id", family.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("assets")
      .select("id, family_id, asset_type_code, name, ticker, isin, market, currency_code, status")
      .eq("family_id", family.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("operations")
      .select("id, family_id, account_id, asset_id, trade_date, operation_type_code, quantity, price, gross_amount, fee_amount, tax_amount, net_amount, currency_code, source, operation_group_id, metadata, notes, cancelled_at, cancellation_reason")
      .eq("family_id", family.id)
      .is("cancelled_at", null)
      .order("trade_date", { ascending: false })
      .limit(500),
    supabase
      .from("position_snapshots")
      .select("id, family_id, portfolio_id, account_id, asset_id, snapshot_date, quantity, book_value_amount, market_value_amount, currency_code, source")
      .eq("family_id", family.id)
      .order("snapshot_date", { ascending: false })
      .limit(500),
    supabase
      .from("imports")
      .select("id, family_id, account_id, original_file_name, storage_object_key, file_size_bytes, sha256, status, error_message, created_at")
      .eq("family_id", family.id)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("import_rows")
      .select("id, family_id, import_id, row_number, raw_data, normalized_data, status, error_message, created_at")
      .eq("family_id", family.id)
      .order("row_number", { ascending: true })
      .limit(500),
    supabase
      .from("audit_log")
      .select("id, family_id, actor_user_id, action, entity_table, entity_id, before_data, after_data, created_at")
      .eq("family_id", family.id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("recommendations")
      .select("id, family_id, portfolio_id, title, body, status, priority, due_on, recommendation_type, reason, source, confidence, metrics, fingerprint, last_generated_at, accepted_at, rejected_at, archived_at, created_at, updated_at")
      .eq("family_id", family.id)
      .neq("status", "archived")
      .order("updated_at", { ascending: false })
      .limit(50),
    supabase
      .from("recommendation_reads")
      .select("id, family_id, recommendation_id, user_id, read_at")
      .eq("family_id", family.id)
      .limit(200),
    supabase
      .from("recommendation_links")
      .select("id, family_id, recommendation_id, entity_table, entity_id, relation_type, created_at")
      .eq("family_id", family.id)
      .limit(300),
    supabase
      .from("news_items")
      .select("id, family_id, asset_id, source, external_id, kind, title, summary, url, published_at, payload, created_at")
      .eq("family_id", family.id)
      .order("published_at", { ascending: false })
      .limit(50),
    supabase
      .from("watchlist_items")
      .select("id, family_id, item_type, asset_id, news_item_id, recommendation_id, title, notes, status, created_by, updated_by, created_at, updated_at")
      .eq("family_id", family.id)
      .neq("status", "archived")
      .order("updated_at", { ascending: false })
      .limit(100),
    supabase
      .from("events")
      .select("id, family_id, portfolio_id, asset_id, event_type, title, event_date, payload, status, amount, currency_code, source, external_id, created_at, updated_at")
      .eq("family_id", family.id)
      .order("event_date", { ascending: true })
      .limit(100),
    supabase
      .from("limits")
      .select("id, family_id, limit_type, scope_key, threshold_value, direction, severity, status, created_at, updated_at")
      .eq("family_id", family.id)
      .eq("status", "active")
      .order("created_at", { ascending: true }),
    supabase
      .from("alerts")
      .select("id, family_id, portfolio_id, asset_id, title, condition_type, status, payload, triggered_at, severity, fingerprint, resolved_at, last_checked_at, source, created_at, updated_at")
      .eq("family_id", family.id)
      .in("status", ["active", "triggered"])
      .order("triggered_at", { ascending: false, nullsFirst: false })
      .limit(50),
    supabase
      .from("notification_preferences")
      .select("id, family_id, channel, status, settings, created_at, updated_at")
      .eq("family_id", family.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("notification_deliveries")
      .select("id, family_id, alert_id, channel, status, error_message, payload, sent_at, created_at")
      .eq("family_id", family.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const operationRows = rows<Operation>(operations.data);
  const accountRows = rows<Account>(accounts.data);
  const assetRows = rows<Asset>(assets.data);
  const snapshotRows = rows<PositionSnapshot>(positionSnapshots.data);
  const positions = calculatePositions(operationRows, accountRows, assetRows, snapshotRows, family.id);
  const cashBalances = calculateCashBalances(operationRows, accountRows, assetRows, snapshotRows, family.id);
  const analytics = buildPortfolioAnalytics({
    operations: operationRows,
    positions,
    cashBalances,
    baseCurrency: family.baseCurrency,
  });
  const storedRecommendations = rows<Recommendation>(recommendations.data);
  const eventRows = rows<PortfolioEvent>(events.data);
  const generatedRecommendations = buildRuleBasedRecommendations({
    analytics,
    positions,
    cashBalances,
    events: eventRows,
  }).map((item: RuleBasedRecommendation): Recommendation => ({
    id: item.id,
    family_id: family.id,
    portfolio_id: null,
    title: item.title,
    body: item.body,
    status: item.status,
    priority: item.priority,
    due_on: null,
    recommendation_type: item.recommendation_type,
    reason: item.reason,
    source: item.source,
    confidence: item.confidence,
    metrics: item.metrics,
    fingerprint: item.fingerprint,
    last_generated_at: item.updated_at,
    accepted_at: null,
    rejected_at: null,
    archived_at: null,
    created_at: item.created_at,
    updated_at: item.updated_at,
    href: item.href,
    isGenerated: true,
    linkedAssetId: item.linkedAssetId,
  }));
  const storedFingerprints = new Set(storedRecommendations.map((recommendation) => recommendation.fingerprint).filter(Boolean));

  return {
    family,
    portfolios: rows<Portfolio>(portfolios.data),
    accounts: accountRows,
    assets: assetRows,
    operations: operationRows,
    operationCount: operationRows.length,
    positionSnapshots: snapshotRows,
    positions,
    cashBalances,
    analytics,
    imports: rows<ImportJob>(imports.data),
    importRows: rows<ImportRow>(importRows.data),
    auditLog: rows<AuditLogEntry>(auditLog.data),
    recommendations: [
      ...storedRecommendations,
      ...generatedRecommendations.filter((recommendation) => !storedFingerprints.has(recommendation.fingerprint)),
    ],
    recommendationReads: rows<RecommendationRead>(recommendationReads.data),
    recommendationLinks: rows<RecommendationLink>(recommendationLinks.data),
    newsItems: rows<NewsItem>(newsItems.data),
    watchlistItems: rows<WatchlistItem>(watchlistItems.data),
    events: eventRows,
    limits: rows<PortfolioLimit>(limits.data),
    systemAlerts: rows<SystemAlert>(systemAlerts.data),
    notificationPreferences: rows<NotificationPreference>(notificationPreferences.data).map((preference) => ({
      ...preference,
      settings: sanitizeNotificationSettings(preference.settings),
    })),
    notificationDeliveries: rows<NotificationDelivery>(notificationDeliveries.data),
  };
}

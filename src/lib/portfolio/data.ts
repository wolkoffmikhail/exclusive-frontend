import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPortfolioAnalytics, type PortfolioAnalytics } from "./analytics";
import { calculateCashBalances, calculatePositions, type CalculatedCashBalance } from "./calculations";

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

export type PortfolioData = {
  family: ActiveFamily | null;
  portfolios: Portfolio[];
  accounts: Account[];
  assets: Asset[];
  operations: Operation[];
  operationCount: number;
  positions: Position[];
  cashBalances: CalculatedCashBalance[];
  analytics: PortfolioAnalytics;
  imports: ImportJob[];
  importRows: ImportRow[];
  auditLog: AuditLogEntry[];
};

type FamilyMemberRow = {
  family_id: string;
  role: ActiveFamily["role"];
  families?: { id?: string; name?: string; base_currency?: string } | Array<{ id?: string; name?: string; base_currency?: string }> | null;
};

function rows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
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
    };
  }

  const [portfolios, accounts, assets, operations, positionSnapshots, imports, importRows, auditLog] = await Promise.all([
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
  ]);

  const operationRows = rows<Operation>(operations.data);
  const accountRows = rows<Account>(accounts.data);
  const assetRows = rows<Asset>(assets.data);
  const snapshotRows = rows<PositionSnapshot>(positionSnapshots.data);
  const positions = calculatePositions(operationRows, accountRows, assetRows, snapshotRows, family.id);
  const cashBalances = calculateCashBalances(operationRows, accountRows, assetRows, snapshotRows, family.id);

  return {
    family,
    portfolios: rows<Portfolio>(portfolios.data),
    accounts: accountRows,
    assets: assetRows,
    operations: operationRows.slice(0, 5),
    operationCount: operationRows.length,
    positions,
    cashBalances,
    analytics: buildPortfolioAnalytics({
      operations: operationRows,
      positions,
      cashBalances,
      baseCurrency: family.baseCurrency,
    }),
    imports: rows<ImportJob>(imports.data),
    importRows: rows<ImportRow>(importRows.data),
    auditLog: rows<AuditLogEntry>(auditLog.data),
  };
}

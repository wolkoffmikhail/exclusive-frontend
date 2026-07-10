import type { SupabaseClient } from "@supabase/supabase-js";

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
  market: string | null;
  currency_code: string | null;
  status: string;
};

export type Operation = {
  id: string;
  family_id: string;
  trade_date: string;
  operation_type_code: string;
  net_amount: number | string;
  currency_code: string;
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

export type PortfolioData = {
  family: ActiveFamily | null;
  portfolios: Portfolio[];
  accounts: Account[];
  assets: Asset[];
  operations: Operation[];
  imports: ImportJob[];
  importRows: ImportRow[];
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
      imports: [],
      importRows: [],
    };
  }

  const [portfolios, accounts, assets, operations, imports, importRows] = await Promise.all([
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
      .select("id, family_id, asset_type_code, name, ticker, market, currency_code, status")
      .eq("family_id", family.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("operations")
      .select("id, family_id, trade_date, operation_type_code, net_amount, currency_code")
      .eq("family_id", family.id)
      .order("trade_date", { ascending: false })
      .limit(5),
    supabase
      .from("imports")
      .select("id, family_id, account_id, original_file_name, storage_object_key, file_size_bytes, sha256, status, created_at")
      .eq("family_id", family.id)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("import_rows")
      .select("id, family_id, import_id, row_number, raw_data, normalized_data, status, error_message, created_at")
      .eq("family_id", family.id)
      .order("row_number", { ascending: true })
      .limit(20),
  ]);

  return {
    family,
    portfolios: rows<Portfolio>(portfolios.data),
    accounts: rows<Account>(accounts.data),
    assets: rows<Asset>(assets.data),
    operations: rows<Operation>(operations.data),
    imports: rows<ImportJob>(imports.data),
    importRows: rows<ImportRow>(importRows.data),
  };
}

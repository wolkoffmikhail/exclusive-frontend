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
  operationCount: number;
  positions: Position[];
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
      operationCount: 0,
      positions: [],
      imports: [],
      importRows: [],
    };
  }

  const [portfolios, accounts, assets, operations, positionSnapshots, imports, importRows] = await Promise.all([
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
      .select("id, family_id, account_id, asset_id, trade_date, operation_type_code, quantity, price, gross_amount, fee_amount, tax_amount, net_amount, currency_code")
      .eq("family_id", family.id)
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

  const operationRows = rows<Operation>(operations.data);
  const accountRows = rows<Account>(accounts.data);
  const assetRows = rows<Asset>(assets.data);
  const snapshotRows = rows<PositionSnapshot>(positionSnapshots.data);

  return {
    family,
    portfolios: rows<Portfolio>(portfolios.data),
    accounts: accountRows,
    assets: assetRows,
    operations: operationRows.slice(0, 5),
    operationCount: operationRows.length,
    positions: calculatePositions(operationRows, accountRows, assetRows, snapshotRows, family.id),
    imports: rows<ImportJob>(imports.data),
    importRows: rows<ImportRow>(importRows.data),
  };
}

function toNumber(value: number | string | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function positionQuantitySign(operationType: string) {
  if (["buy", "transfer_in"].includes(operationType)) return 1;
  if (["sell", "transfer_out"].includes(operationType)) return -1;
  return 0;
}

function snapshotKey(portfolioId: string, accountId: string, assetId: string, currencyCode: string) {
  return `${portfolioId}:${accountId}:${assetId}:${currencyCode}`;
}

function latestSnapshotsByPosition(snapshots: PositionSnapshot[]) {
  const snapshotsByKey = new Map<string, PositionSnapshot>();

  for (const snapshot of snapshots) {
    if (!snapshot.account_id) continue;
    const key = snapshotKey(snapshot.portfolio_id, snapshot.account_id, snapshot.asset_id, snapshot.currency_code);
    const existing = snapshotsByKey.get(key);
    if (!existing || snapshot.snapshot_date > existing.snapshot_date) {
      snapshotsByKey.set(key, snapshot);
    }
  }

  return snapshotsByKey;
}

function calculatePositions(operations: Operation[], accounts: Account[], assets: Asset[], snapshots: PositionSnapshot[], familyId: string): Position[] {
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const snapshotByKey = latestSnapshotsByPosition(snapshots);
  const grouped = new Map<string, Position & { boughtQuantity: number; buyCost: number }>();

  for (const operation of operations) {
    const sign = positionQuantitySign(operation.operation_type_code);
    const quantity = toNumber(operation.quantity);
    const hasAssetPosition = Boolean(operation.asset_id) && sign !== 0 && quantity !== 0;
    if (!hasAssetPosition) continue;

    const asset = operation.asset_id ? assetById.get(operation.asset_id) : null;
    const account = accountById.get(operation.account_id);
    const portfolioId = account?.portfolio_id ?? "";
    const key = snapshotKey(portfolioId, operation.account_id, operation.asset_id ?? "", operation.currency_code);
    const existing = grouped.get(key) ?? {
      id: key,
      family_id: familyId,
      portfolio_id: portfolioId,
      account_id: operation.account_id,
      account_name: account?.name ?? "Счёт не найден",
      asset_id: operation.asset_id,
      asset_name: asset?.name ?? "Актив не найден",
      ticker: asset?.ticker ?? null,
      asset_type_code: asset?.asset_type_code ?? null,
      quantity: 0,
      average_price: null,
      book_value: 0,
      market_price: null,
      market_value: null,
      unrealized_pnl: null,
      valuation_date: null,
      net_cash_flow: 0,
      currency_code: operation.currency_code,
      boughtQuantity: 0,
      buyCost: 0,
    };

    const signedQuantity = sign * Math.abs(quantity);
    const grossAmount = Math.abs(toNumber(operation.gross_amount));
    const feeAmount = Math.abs(toNumber(operation.fee_amount));
    const taxAmount = Math.abs(toNumber(operation.tax_amount));

    existing.quantity += signedQuantity;
    existing.net_cash_flow += toNumber(operation.net_amount);

    if (operation.operation_type_code === "buy" || operation.operation_type_code === "transfer_in") {
      const effectiveCost = grossAmount + feeAmount + taxAmount;
      existing.boughtQuantity += Math.abs(quantity);
      existing.buyCost += effectiveCost;
    }

    if (existing.boughtQuantity > 0) {
      existing.average_price = existing.buyCost / existing.boughtQuantity;
      existing.book_value = Math.max(existing.quantity, 0) * existing.average_price;
    }

    grouped.set(key, existing);
  }

  return Array.from(grouped.values())
    .filter((position) => Math.abs(position.quantity) > 0.0000001)
    .sort((left, right) => left.asset_name.localeCompare(right.asset_name, "ru"))
    .map((position) => ({
      ...position,
      ...marketValuation(position, snapshotByKey.get(snapshotKey(position.portfolio_id, position.account_id, position.asset_id ?? "", position.currency_code))),
    }))
    .map((position) => ({
      id: position.id,
      family_id: position.family_id,
      portfolio_id: position.portfolio_id,
      account_id: position.account_id,
      account_name: position.account_name,
      asset_id: position.asset_id,
      asset_name: position.asset_name,
      ticker: position.ticker,
      asset_type_code: position.asset_type_code,
      quantity: position.quantity,
      average_price: position.average_price,
      book_value: position.book_value,
      market_price: position.market_price,
      market_value: position.market_value,
      unrealized_pnl: position.unrealized_pnl,
      valuation_date: position.valuation_date,
      net_cash_flow: position.net_cash_flow,
      currency_code: position.currency_code,
    }));
}

function marketValuation(position: Position, snapshot: PositionSnapshot | undefined) {
  const marketValue = snapshot?.market_value_amount == null ? null : toNumber(snapshot.market_value_amount);
  const quantity = Math.abs(position.quantity);
  const marketPrice = marketValue !== null && quantity > 0 ? marketValue / quantity : null;

  return {
    market_price: marketPrice,
    market_value: marketValue,
    unrealized_pnl: marketValue === null ? null : marketValue - position.book_value,
    valuation_date: snapshot?.snapshot_date ?? null,
  };
}

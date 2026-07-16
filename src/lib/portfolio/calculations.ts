export type CalculationAccount = {
  id: string;
  family_id: string;
  portfolio_id: string;
  name: string;
  currency_code: string;
};

export type CalculationAsset = {
  id: string;
  family_id: string;
  asset_type_code: string;
  name: string;
  ticker: string | null;
  currency_code: string | null;
};

export type CalculationOperation = {
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
  source?: string | null;
  cancelled_at?: string | null;
};

export type CalculationPositionSnapshot = {
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

export type CalculatedPosition = {
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

export type CalculatedCashBalance = {
  id: string;
  family_id: string;
  portfolio_id: string;
  account_id: string;
  account_name: string;
  currency_code: string;
  balance: number;
  snapshot_date: string | null;
  net_cash_flow: number;
};

type PositionAccumulator = CalculatedPosition & {
  averageCost: number | null;
  baselineDate: string | null;
  marketPriceFromSnapshot: number | null;
};

type CashAccumulator = CalculatedCashBalance & {
  baselineDate: string | null;
};

export function toNumber(value: number | string | null | undefined) {
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

function cashKey(portfolioId: string, accountId: string, currencyCode: string) {
  return `${portfolioId}:${accountId}:${currencyCode}`;
}

function isCashAsset(asset: CalculationAsset | undefined) {
  return asset?.asset_type_code === "cash";
}

function latestSnapshotsByPosition(snapshots: CalculationPositionSnapshot[], assetsById: Map<string, CalculationAsset>) {
  const snapshotsByKey = new Map<string, CalculationPositionSnapshot>();

  for (const snapshot of snapshots) {
    if (!snapshot.account_id || isCashAsset(assetsById.get(snapshot.asset_id))) continue;

    const key = snapshotKey(snapshot.portfolio_id, snapshot.account_id, snapshot.asset_id, snapshot.currency_code);
    const existing = snapshotsByKey.get(key);
    if (!existing || snapshot.snapshot_date > existing.snapshot_date) {
      snapshotsByKey.set(key, snapshot);
    }
  }

  return snapshotsByKey;
}

function latestCashSnapshots(snapshots: CalculationPositionSnapshot[], assetsById: Map<string, CalculationAsset>) {
  const snapshotsByKey = new Map<string, CalculationPositionSnapshot>();

  for (const snapshot of snapshots) {
    if (!snapshot.account_id || !isCashAsset(assetsById.get(snapshot.asset_id))) continue;

    const key = cashKey(snapshot.portfolio_id, snapshot.account_id, snapshot.currency_code);
    const existing = snapshotsByKey.get(key);
    if (!existing || snapshot.snapshot_date > existing.snapshot_date) {
      snapshotsByKey.set(key, snapshot);
    }
  }

  return snapshotsByKey;
}

function grossAmount(operation: CalculationOperation) {
  const explicitGross = Math.abs(toNumber(operation.gross_amount));
  if (explicitGross > 0) return explicitGross;

  const quantity = Math.abs(toNumber(operation.quantity));
  const price = Math.abs(toNumber(operation.price));
  return quantity * price;
}

function positionFromSnapshot(
  snapshot: CalculationPositionSnapshot,
  account: CalculationAccount | undefined,
  asset: CalculationAsset | undefined,
  familyId: string,
): PositionAccumulator {
  const quantity = toNumber(snapshot.quantity);
  const bookValue = toNumber(snapshot.book_value_amount);
  const marketValue = snapshot.market_value_amount == null ? null : toNumber(snapshot.market_value_amount);
  const absoluteQuantity = Math.abs(quantity);
  const averagePrice = absoluteQuantity > 0 ? bookValue / absoluteQuantity : null;
  const marketPrice = marketValue !== null && absoluteQuantity > 0 ? marketValue / absoluteQuantity : null;

  return {
    id: snapshotKey(snapshot.portfolio_id, snapshot.account_id ?? "", snapshot.asset_id, snapshot.currency_code),
    family_id: familyId,
    portfolio_id: snapshot.portfolio_id,
    account_id: snapshot.account_id ?? "",
    account_name: account?.name ?? "Счёт не найден",
    asset_id: snapshot.asset_id,
    asset_name: asset?.name ?? "Актив не найден",
    ticker: asset?.ticker ?? null,
    asset_type_code: asset?.asset_type_code ?? null,
    quantity,
    average_price: averagePrice,
    book_value: bookValue,
    market_price: marketPrice,
    market_value: marketValue,
    unrealized_pnl: marketValue === null ? null : marketValue - bookValue,
    valuation_date: snapshot.snapshot_date,
    net_cash_flow: 0,
    currency_code: snapshot.currency_code,
    averageCost: averagePrice,
    baselineDate: snapshot.snapshot_date,
    marketPriceFromSnapshot: marketPrice,
  };
}

function emptyPosition(
  operation: CalculationOperation,
  account: CalculationAccount | undefined,
  asset: CalculationAsset | undefined,
  familyId: string,
): PositionAccumulator {
  const portfolioId = account?.portfolio_id ?? "";

  return {
    id: snapshotKey(portfolioId, operation.account_id, operation.asset_id ?? "", operation.currency_code),
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
    averageCost: null,
    baselineDate: null,
    marketPriceFromSnapshot: null,
  };
}

function applyPositionOperation(position: PositionAccumulator, operation: CalculationOperation) {
  const sign = positionQuantitySign(operation.operation_type_code);
  const quantity = Math.abs(toNumber(operation.quantity));
  if (sign === 0 || quantity === 0) return;

  const signedQuantity = sign * quantity;
  const feeAmount = Math.abs(toNumber(operation.fee_amount));
  const taxAmount = Math.abs(toNumber(operation.tax_amount));

  if (sign > 0) {
    const cost = grossAmount(operation) + feeAmount + taxAmount;
    const previousQuantity = Math.max(position.quantity, 0);
    const previousCost = position.averageCost === null ? position.book_value : previousQuantity * position.averageCost;
    const nextQuantity = position.quantity + signedQuantity;

    position.quantity = nextQuantity;
    position.book_value = previousCost + cost;
    position.averageCost = nextQuantity > 0 ? position.book_value / nextQuantity : null;
    position.average_price = position.averageCost;
    return;
  }

  const sellQuantity = Math.min(quantity, Math.max(position.quantity, 0));
  const averageCost = position.averageCost ?? position.average_price ?? 0;

  position.quantity += signedQuantity;
  position.book_value = Math.max(position.quantity, 0) * averageCost;
  if (position.quantity <= 0.0000001) {
    position.quantity = 0;
    position.book_value = 0;
    position.averageCost = null;
    position.average_price = null;
    return;
  }

  position.averageCost = averageCost;
  position.average_price = averageCost;
  void sellQuantity;
}

function finalizePosition(position: PositionAccumulator): CalculatedPosition {
  const marketPrice = position.marketPriceFromSnapshot;
  const marketValue = marketPrice === null ? position.market_value : position.quantity * marketPrice;
  const unrealizedPnl = marketValue === null ? null : marketValue - position.book_value;

  return {
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
    market_price: marketPrice,
    market_value: marketValue,
    unrealized_pnl: unrealizedPnl,
    valuation_date: position.valuation_date,
    net_cash_flow: position.net_cash_flow,
    currency_code: position.currency_code,
  };
}

export function calculateSecurityPositions(
  operations: CalculationOperation[],
  accounts: CalculationAccount[],
  assets: CalculationAsset[],
  snapshots: CalculationPositionSnapshot[],
  familyId: string,
): CalculatedPosition[] {
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const snapshotByKey = latestSnapshotsByPosition(snapshots, assetById);
  const grouped = new Map<string, PositionAccumulator>();

  for (const snapshot of snapshotByKey.values()) {
    if (!snapshot.account_id) continue;

    const account = accountById.get(snapshot.account_id);
    const asset = assetById.get(snapshot.asset_id);
    const position = positionFromSnapshot(snapshot, account, asset, familyId);
    grouped.set(position.id, position);
  }

  const sortedOperations = [...operations].sort((left, right) => left.trade_date.localeCompare(right.trade_date));

  for (const operation of sortedOperations) {
    if (operation.cancelled_at) continue;
    if (!operation.asset_id) continue;

    const asset = assetById.get(operation.asset_id);
    if (isCashAsset(asset)) continue;

    const account = accountById.get(operation.account_id);
    const portfolioId = account?.portfolio_id ?? "";
    const key = snapshotKey(portfolioId, operation.account_id, operation.asset_id, operation.currency_code);
    const existing = grouped.get(key) ?? emptyPosition(operation, account, asset, familyId);

    if (existing.baselineDate && operation.trade_date <= existing.baselineDate) {
      grouped.set(key, existing);
      continue;
    }

    existing.net_cash_flow += toNumber(operation.net_amount);
    applyPositionOperation(existing, operation);
    grouped.set(key, existing);
  }

  return Array.from(grouped.values())
    .filter((position) => Math.abs(position.quantity) > 0.0000001)
    .map(finalizePosition)
    .sort((left, right) => left.asset_name.localeCompare(right.asset_name, "ru"));
}

export function calculateCashBalances(
  operations: CalculationOperation[],
  accounts: CalculationAccount[],
  assets: CalculationAsset[],
  snapshots: CalculationPositionSnapshot[],
  familyId: string,
): CalculatedCashBalance[] {
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const snapshotByKey = latestCashSnapshots(snapshots, assetById);
  const grouped = new Map<string, CashAccumulator>();

  for (const snapshot of snapshotByKey.values()) {
    if (!snapshot.account_id) continue;

    const account = accountById.get(snapshot.account_id);
    const balance = toNumber(snapshot.quantity);
    const key = cashKey(snapshot.portfolio_id, snapshot.account_id, snapshot.currency_code);

    grouped.set(key, {
      id: key,
      family_id: familyId,
      portfolio_id: snapshot.portfolio_id,
      account_id: snapshot.account_id,
      account_name: account?.name ?? "Счёт не найден",
      currency_code: snapshot.currency_code,
      balance,
      snapshot_date: snapshot.snapshot_date,
      net_cash_flow: 0,
      baselineDate: snapshot.snapshot_date,
    });
  }

  const sortedOperations = [...operations].sort((left, right) => left.trade_date.localeCompare(right.trade_date));

  for (const operation of sortedOperations) {
    if (operation.cancelled_at) continue;
    const account = accountById.get(operation.account_id);
    const portfolioId = account?.portfolio_id ?? "";
    const key = cashKey(portfolioId, operation.account_id, operation.currency_code);
    const existing = grouped.get(key) ?? {
      id: key,
      family_id: familyId,
      portfolio_id: portfolioId,
      account_id: operation.account_id,
      account_name: account?.name ?? "Счёт не найден",
      currency_code: operation.currency_code,
      balance: 0,
      snapshot_date: null,
      net_cash_flow: 0,
      baselineDate: null,
    };

    if (existing.baselineDate && operation.trade_date <= existing.baselineDate) {
      grouped.set(key, existing);
      continue;
    }

    const cashFlow = toNumber(operation.net_amount);
    existing.balance += cashFlow;
    existing.net_cash_flow += cashFlow;
    grouped.set(key, existing);
  }

  return Array.from(grouped.values())
    .filter((balance) => Math.abs(balance.balance) > 0.0000001)
    .sort((left, right) => `${left.account_name}:${left.currency_code}`.localeCompare(`${right.account_name}:${right.currency_code}`, "ru"))
    .map((balance) => ({
      id: balance.id,
      family_id: balance.family_id,
      portfolio_id: balance.portfolio_id,
      account_id: balance.account_id,
      account_name: balance.account_name,
      currency_code: balance.currency_code,
      balance: balance.balance,
      snapshot_date: balance.snapshot_date,
      net_cash_flow: balance.net_cash_flow,
    }));
}

export function calculatePositions(
  operations: CalculationOperation[],
  accounts: CalculationAccount[],
  assets: CalculationAsset[],
  snapshots: CalculationPositionSnapshot[],
  familyId: string,
) {
  return calculateSecurityPositions(operations, accounts, assets, snapshots, familyId);
}

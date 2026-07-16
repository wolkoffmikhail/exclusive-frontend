import type { CalculatedPosition } from "./calculations";

export type PositionSortKey =
  | "asset"
  | "asset_type"
  | "currency"
  | "last_operation"
  | "pnl"
  | "quantity"
  | "value";

export type PositionFilterInput = {
  accountId?: string | null;
  assetType?: string | null;
  currencyCode?: string | null;
  onlyProblematic?: boolean;
  query?: string | null;
  sortBy?: PositionSortKey | string | null;
};

export function positionValue(position: CalculatedPosition) {
  return position.market_value ?? position.book_value;
}

export function isProblematicPosition(position: CalculatedPosition) {
  return position.market_value === null || position.market_price === null || position.asset_id === null;
}

function normalize(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function matchesQuery(position: CalculatedPosition, query: string) {
  if (!query) return true;
  const haystack = [
    position.asset_name,
    position.ticker,
    position.account_name,
    position.currency_code,
    position.asset_type_code,
  ].map((value) => normalize(value));

  return haystack.some((value) => value.includes(query));
}

function compareNumbers(left: number, right: number) {
  return right - left;
}

function compareText(left: string | null | undefined, right: string | null | undefined) {
  return normalize(left).localeCompare(normalize(right), "ru");
}

export function filterAndSortPositions(positions: CalculatedPosition[], filters: PositionFilterInput) {
  const query = normalize(filters.query);
  const accountId = filters.accountId || "";
  const assetType = filters.assetType || "";
  const currencyCode = filters.currencyCode || "";
  const sortBy = filters.sortBy || "asset";

  return positions
    .filter((position) => !accountId || position.account_id === accountId)
    .filter((position) => !assetType || position.asset_type_code === assetType)
    .filter((position) => !currencyCode || position.currency_code === currencyCode)
    .filter((position) => !filters.onlyProblematic || isProblematicPosition(position))
    .filter((position) => matchesQuery(position, query))
    .sort((left, right) => {
      if (sortBy === "value") return compareNumbers(positionValue(left), positionValue(right));
      if (sortBy === "pnl") return compareNumbers(left.unrealized_pnl ?? Number.NEGATIVE_INFINITY, right.unrealized_pnl ?? Number.NEGATIVE_INFINITY);
      if (sortBy === "quantity") return compareNumbers(left.quantity, right.quantity);
      if (sortBy === "currency") return compareText(left.currency_code, right.currency_code) || compareText(left.asset_name, right.asset_name);
      if (sortBy === "asset_type") return compareText(left.asset_type_code, right.asset_type_code) || compareText(left.asset_name, right.asset_name);
      if (sortBy === "last_operation") return compareText(right.valuation_date, left.valuation_date) || compareText(left.asset_name, right.asset_name);
      return compareText(left.asset_name, right.asset_name) || compareText(left.account_name, right.account_name);
    });
}

export function groupPositionsByAssetType(positions: CalculatedPosition[]) {
  const groups = new Map<string, CalculatedPosition[]>();

  for (const position of positions) {
    const key = position.asset_type_code || "other";
    groups.set(key, [...(groups.get(key) ?? []), position]);
  }

  return Array.from(groups.entries()).map(([assetType, groupPositions]) => ({
    assetType,
    positions: groupPositions,
    totalValue: groupPositions.reduce((total, position) => total + positionValue(position), 0),
    totalPnl: groupPositions.reduce((total, position) => total + (position.unrealized_pnl ?? 0), 0),
  }));
}

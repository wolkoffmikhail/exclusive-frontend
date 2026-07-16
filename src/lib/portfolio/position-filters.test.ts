import { describe, expect, it } from "vitest";
import { filterAndSortPositions, groupPositionsByAssetType, isProblematicPosition } from "./position-filters";
import type { CalculatedPosition } from "./calculations";

function position(overrides: Partial<CalculatedPosition>): CalculatedPosition {
  return {
    id: "position-1",
    family_id: "family-1",
    portfolio_id: "portfolio-1",
    account_id: "account-1",
    account_name: "Брокерский счёт",
    asset_id: "asset-1",
    asset_name: "Демо-акция",
    ticker: "DEMO",
    asset_type_code: "stock",
    quantity: 10,
    average_price: 100,
    book_value: 1000,
    market_price: 120,
    market_value: 1200,
    unrealized_pnl: 200,
    valuation_date: "2026-07-15",
    net_cash_flow: -1000,
    currency_code: "RUB",
    ...overrides,
  };
}

describe("position filters", () => {
  const positions = [
    position({ id: "stock-rub", asset_name: "Демо-акция", ticker: "DEMO", asset_type_code: "stock", market_value: 1200, unrealized_pnl: 200 }),
    position({ id: "bond-usd", asset_name: "Демо-облигация", ticker: "BOND", asset_type_code: "bond", currency_code: "USD", market_value: 900, unrealized_pnl: -100 }),
    position({ id: "fund-rub", asset_name: "Фонд без цены", ticker: "FUND", asset_type_code: "fund", market_price: null, market_value: null, unrealized_pnl: null }),
  ];

  it("filters by query, asset type and currency", () => {
    const result = filterAndSortPositions(positions, {
      assetType: "bond",
      currencyCode: "USD",
      query: "облигация",
    });

    expect(result.map((item) => item.id)).toEqual(["bond-usd"]);
  });

  it("detects positions without market valuation as problematic", () => {
    expect(isProblematicPosition(positions[0])).toBe(false);
    expect(isProblematicPosition(positions[2])).toBe(true);
    expect(filterAndSortPositions(positions, { onlyProblematic: true }).map((item) => item.id)).toEqual(["fund-rub"]);
  });

  it("sorts by current value descending", () => {
    expect(filterAndSortPositions(positions, { sortBy: "value" }).map((item) => item.id)).toEqual(["stock-rub", "fund-rub", "bond-usd"]);
  });

  it("groups by asset type with totals", () => {
    const groups = groupPositionsByAssetType(positions);

    expect(groups.map((group) => group.assetType)).toEqual(["stock", "bond", "fund"]);
    expect(groups.find((group) => group.assetType === "stock")?.totalValue).toBe(1200);
    expect(groups.find((group) => group.assetType === "bond")?.totalPnl).toBe(-100);
  });
});

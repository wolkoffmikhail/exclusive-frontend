import { describe, expect, it } from "vitest";
import { buildPortfolioAnalytics, type AnalyticsOperation } from "./analytics";
import type { CalculatedCashBalance, CalculatedPosition } from "./calculations";
import { buildRuleBasedRecommendations, type UpcomingEventForRecommendation } from "./recommendations";

const familyId = "family-1";

function operation(overrides: Partial<AnalyticsOperation> = {}): AnalyticsOperation {
  return {
    id: "operation-1",
    family_id: familyId,
    account_id: "account-1",
    asset_id: null,
    trade_date: "2026-01-01",
    operation_type_code: "deposit",
    quantity: null,
    price: null,
    gross_amount: 1000,
    fee_amount: 0,
    tax_amount: 0,
    net_amount: 1000,
    currency_code: "RUB",
    source: "manual",
    operation_group_id: null,
    cancelled_at: null,
    ...overrides,
  };
}

function position(overrides: Partial<CalculatedPosition> = {}): CalculatedPosition {
  return {
    id: "position-1",
    family_id: familyId,
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
    market_price: 100,
    market_value: 1000,
    unrealized_pnl: 0,
    valuation_date: "2026-12-31",
    net_cash_flow: -1000,
    currency_code: "RUB",
    ...overrides,
  };
}

function cashBalance(overrides: Partial<CalculatedCashBalance> = {}): CalculatedCashBalance {
  return {
    id: "cash-1",
    family_id: familyId,
    portfolio_id: "portfolio-1",
    account_id: "account-1",
    account_name: "Брокерский счёт",
    currency_code: "RUB",
    balance: 100,
    snapshot_date: "2026-12-31",
    net_cash_flow: 0,
    ...overrides,
  };
}

function recommendations({
  cashBalances = [cashBalance()],
  events = [],
  operations = [operation()],
  positions = [position()],
}: {
  positions?: CalculatedPosition[];
  cashBalances?: CalculatedCashBalance[];
  events?: UpcomingEventForRecommendation[];
  operations?: AnalyticsOperation[];
} = {}) {
  const analytics = buildPortfolioAnalytics({
    operations,
    positions,
    cashBalances,
    baseCurrency: "RUB",
    asOf: "2026-12-31",
  });

  return buildRuleBasedRecommendations({ analytics, positions, cashBalances, events });
}

describe("buildRuleBasedRecommendations", () => {
  it("creates a concentration recommendation for a dominant asset class", () => {
    const result = recommendations({
      positions: [position({ market_value: 900 }), position({ id: "position-2", asset_id: "asset-2", asset_type_code: "bond", market_value: 100, book_value: 100 })],
      cashBalances: [cashBalance({ balance: 100 })],
    });

    expect(result.some((item) => item.recommendation_type === "asset_class_concentration")).toBe(true);
  });

  it("creates a missing market price recommendation", () => {
    const result = recommendations({
      positions: [position({ market_price: null, market_value: null, book_value: 1000 })],
    });

    const missingPrice = result.find((item) => item.recommendation_type === "missing_market_price");
    expect(missingPrice?.fingerprint).toBe("missing_market_price:asset-1");
    expect(missingPrice?.priority).toBe("high");
    expect(missingPrice?.metrics.quality_alert_code).toBe("missing_market_price");
  });

  it("creates a single asset concentration recommendation", () => {
    const result = recommendations({
      positions: [
        position({ market_value: 900, book_value: 900 }),
        position({ id: "position-2", asset_id: "asset-2", asset_name: "Демо-облигация", asset_type_code: "bond", market_value: 100, book_value: 100 }),
      ],
      cashBalances: [cashBalance({ balance: 100 })],
    });

    const concentration = result.find((item) => item.recommendation_type === "single_asset_concentration");
    expect(concentration?.fingerprint).toBe("single_asset_concentration:asset-1");
    expect(concentration?.linkedAssetId).toBe("asset-1");
    expect(concentration?.metrics.share_percent).toBeGreaterThan(35);
  });

  it("creates a cash threshold recommendation when cash is low", () => {
    const result = recommendations({
      positions: [position({ market_value: 1000 })],
      cashBalances: [cashBalance({ balance: 10 })],
    });

    expect(result.some((item) => item.recommendation_type === "cash_below_threshold")).toBe(true);
  });

  it("creates stable fingerprints for generated recommendations", () => {
    const firstRun = recommendations();
    const secondRun = recommendations();

    expect(firstRun.map((item) => item.fingerprint)).toEqual(secondRun.map((item) => item.fingerprint));
  });

  it("explains recommendations that duplicate data-quality warnings", () => {
    const result = recommendations({
      operations: [],
      positions: [position()],
      cashBalances: [cashBalance()],
    });

    const xirr = result.find((item) => item.recommendation_type === "xirr_unavailable");
    expect(xirr?.metrics.quality_alert_code).toBe("xirr_unavailable");
  });

  it("creates an upcoming event recommendation for a held asset", () => {
    const result = recommendations({
      events: [{
        id: "event-1",
        asset_id: "asset-1",
        event_date: "2027-01-10",
        event_type: "coupon",
        title: "Купон по облигации",
        amount: 50,
        currency_code: "RUB",
        status: "scheduled",
      }],
    });

    const upcomingEvent = result.find((item) => item.recommendation_type === "upcoming_position_event");
    expect(upcomingEvent?.fingerprint).toBe("upcoming_position_event:event-1");
    expect(upcomingEvent?.linkedAssetId).toBe("asset-1");
    expect(upcomingEvent?.metrics.event_type).toBe("coupon");
  });
});

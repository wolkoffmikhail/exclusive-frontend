import { describe, expect, it } from "vitest";
import { buildPortfolioAnalytics } from "./analytics";
import type { CalculatedCashBalance, CalculatedPosition } from "./calculations";
import { evaluatePortfolioLimitCheck, evaluatePortfolioLimits, type PortfolioLimitRule } from "./limits";

const familyId = "family-1";

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

function limit(overrides: Partial<PortfolioLimitRule>): PortfolioLimitRule {
  return {
    id: "limit-1",
    limit_type: "asset_class_share",
    scope_key: "stock",
    threshold_value: 0.5,
    direction: "max",
    severity: "warning",
    status: "active",
    ...overrides,
  };
}

function evaluate(limits: PortfolioLimitRule[], positions = [position()], cashBalances = [cashBalance()]) {
  const analytics = buildPortfolioAnalytics({
    operations: [],
    positions,
    cashBalances,
    baseCurrency: "RUB",
    asOf: "2026-12-31",
  });

  return evaluatePortfolioLimits({ analytics, positions, limits });
}

function evaluateCheck(limits: PortfolioLimitRule[], positions = [position()], cashBalances = [cashBalance()]) {
  const analytics = buildPortfolioAnalytics({
    operations: [],
    positions,
    cashBalances,
    baseCurrency: "RUB",
    asOf: "2026-12-31",
  });

  return evaluatePortfolioLimitCheck({ analytics, positions, limits });
}

describe("evaluatePortfolioLimits", () => {
  it("reports max asset class share violations", () => {
    const violations = evaluate([limit({ threshold_value: 0.5 })]);

    expect(violations).toHaveLength(1);
    expect(violations[0].limitType).toBe("asset_class_share");
    expect(violations[0].payload.current_percent).toBeGreaterThan(50);
  });

  it("reports min cash share violations", () => {
    const violations = evaluate([
      limit({
        id: "limit-cash",
        limit_type: "cash_min_share",
        scope_key: null,
        threshold_value: 0.2,
        direction: "min",
      }),
    ]);

    expect(violations).toHaveLength(1);
    expect(violations[0].limitType).toBe("cash_min_share");
  });

  it("does not report resolved limits", () => {
    const violations = evaluate([limit({ threshold_value: 0.95 })]);

    expect(violations).toHaveLength(0);
  });

  it("uses stable fingerprints per limit", () => {
    const firstRun = evaluate([limit({ id: "limit-stable" })]);
    const secondRun = evaluate([limit({ id: "limit-stable" })]);

    expect(firstRun[0].fingerprint).toBe(secondRun[0].fingerprint);
  });

  it("reports partial issues when analytics slice is incomplete", () => {
    const result = evaluateCheck([
      limit({ id: "limit-partial", limit_type: "asset_class_share", scope_key: "stock" }),
    ], [
      position({ currency_code: "USD" }),
    ]);

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      limitId: "limit-partial",
      status: "partial",
      reason: "metric_partial",
    });
  });

  it("reports skipped issues when limit scope cannot be evaluated", () => {
    const result = evaluateCheck([
      limit({ id: "limit-missing-scope", limit_type: "currency_share", scope_key: "USD" }),
    ]);

    expect(result.violations).toHaveLength(0);
    expect(result.issues[0]).toMatchObject({
      limitId: "limit-missing-scope",
      status: "skipped",
      reason: "metric_unavailable",
    });
  });
});

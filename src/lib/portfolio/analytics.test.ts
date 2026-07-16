import { describe, expect, it } from "vitest";
import {
  buildCashFlowPeriods,
  buildCashFlowBuckets,
  buildPortfolioAnalytics,
  buildPortfolioXirrDetail,
  buildPortfolioXirr,
  calculateXirr,
  getDashboardCashFlows,
  type AnalyticsOperation,
} from "./analytics";
import type { CalculatedCashBalance, CalculatedPosition } from "./calculations";

const familyId = "family-1";
const baseOperation: AnalyticsOperation = {
  id: "operation-1",
  family_id: familyId,
  account_id: "account-1",
  asset_id: null,
  trade_date: "2026-01-01",
  operation_type_code: "deposit",
  quantity: null,
  price: null,
  gross_amount: 0,
  fee_amount: 0,
  tax_amount: 0,
  net_amount: 0,
  currency_code: "RUB",
  source: "manual",
  operation_group_id: null,
  cancelled_at: null,
};

function operation(overrides: Partial<AnalyticsOperation>): AnalyticsOperation {
  return {
    ...baseOperation,
    id: overrides.id ?? baseOperation.id,
    ...overrides,
  };
}

function position(overrides: Partial<CalculatedPosition>): CalculatedPosition {
  return {
    id: overrides.id ?? "position-1",
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
    market_price: 120,
    market_value: 1200,
    unrealized_pnl: 200,
    valuation_date: "2026-12-31",
    net_cash_flow: -1000,
    currency_code: "RUB",
    ...overrides,
  };
}

function cashBalance(overrides: Partial<CalculatedCashBalance>): CalculatedCashBalance {
  return {
    id: overrides.id ?? "cash-1",
    family_id: familyId,
    portfolio_id: "portfolio-1",
    account_id: "account-1",
    account_name: "Брокерский счёт",
    currency_code: "RUB",
    balance: 300,
    snapshot_date: "2026-12-31",
    net_cash_flow: 0,
    ...overrides,
  };
}

describe("portfolio analytics", () => {
  it("calculates XIRR for a single contribution and terminal value", () => {
    const result = calculateXirr([
      { date: "2026-01-01", amount: -1000, currencyCode: "RUB" },
      { date: "2027-01-01", amount: 1100, currencyCode: "RUB" },
    ]);

    expect(result.status).toBe("ready");
    expect(result.value).toBeCloseTo(0.0997, 3);
  });

  it("returns a diagnostic status when XIRR has no sign change", () => {
    const result = calculateXirr([
      { date: "2026-01-01", amount: 1000, currencyCode: "RUB" },
      { date: "2027-01-01", amount: 1100, currencyCode: "RUB" },
    ]);

    expect(result).toMatchObject({ status: "no_sign_change", value: null });
  });

  it("keeps transfers, FX, buys and sells out of external dashboard flows", () => {
    const flows = getDashboardCashFlows(
      [
        operation({ id: "deposit-1", trade_date: "2026-01-01", operation_type_code: "deposit", net_amount: 1000 }),
        operation({ id: "withdrawal-1", trade_date: "2026-01-02", operation_type_code: "withdrawal", net_amount: -250 }),
        operation({ id: "buy-1", operation_type_code: "buy", asset_id: "asset-1", net_amount: -500 }),
        operation({ id: "sell-1", operation_type_code: "sell", asset_id: "asset-1", net_amount: 550 }),
        operation({ id: "fx-1", operation_type_code: "fx", net_amount: -100 }),
        operation({ id: "transfer-1", operation_type_code: "transfer_out", net_amount: -100 }),
        operation({ id: "cancelled-1", operation_type_code: "deposit", net_amount: 999, cancelled_at: "2026-01-02T00:00:00.000Z" }),
      ],
      "RUB",
    );

    expect(flows.map((flow) => flow.operationId)).toEqual(["withdrawal-1", "deposit-1"]);
    expect(flows[0]).toMatchObject({ direction: "outflow", amount: 250 });
    expect(flows[1]).toMatchObject({ direction: "inflow", amount: 1000 });
  });

  it("builds period summaries for external cash flows", () => {
    const summaries = buildCashFlowPeriods(
      [
        { operationId: "old", accountId: "account-1", date: "2025-12-31", operationType: "deposit", source: "manual", amount: 500, currencyCode: "RUB", direction: "inflow" },
        { operationId: "recent-in", accountId: "account-1", date: "2026-06-20", operationType: "deposit", source: "manual", amount: 1000, currencyCode: "RUB", direction: "inflow" },
        { operationId: "recent-out", accountId: "account-1", date: "2026-07-01", operationType: "withdrawal", source: "manual", amount: 250, currencyCode: "RUB", direction: "outflow" },
      ],
      "2026-07-15",
    );

    expect(summaries.find((summary) => summary.period === "1M")).toMatchObject({
      inflows: 1000,
      outflows: 250,
      net: 750,
    });
    expect(summaries.find((summary) => summary.period === "YTD")).toMatchObject({
      inflows: 1000,
      outflows: 250,
      net: 750,
    });
    expect(summaries.find((summary) => summary.period === "All")).toMatchObject({
      inflows: 1500,
      outflows: 250,
      net: 1250,
    });
    expect(summaries.find((summary) => summary.period === "All")?.buckets).toEqual([
      expect.objectContaining({ key: "2025-12", inflows: 500, outflows: 0, net: 500 }),
      expect.objectContaining({ key: "2026-06", inflows: 1000, outflows: 0, net: 1000 }),
      expect.objectContaining({ key: "2026-07", inflows: 0, outflows: 250, net: -250 }),
    ]);
  });

  it("groups dashboard cash flows by month buckets", () => {
    const buckets = buildCashFlowBuckets([
      { operationId: "in-1", accountId: "account-1", date: "2026-07-01", operationType: "deposit", source: "manual", amount: 1000, currencyCode: "RUB", direction: "inflow" },
      { operationId: "out-1", accountId: "account-1", date: "2026-07-02", operationType: "withdrawal", source: "manual", amount: 250, currencyCode: "RUB", direction: "outflow" },
      { operationId: "in-2", accountId: "account-1", date: "2026-08-01", operationType: "deposit", source: "manual", amount: 500, currencyCode: "RUB", direction: "inflow" },
    ]);

    expect(buckets).toEqual([
      { key: "2026-07", label: "07.26", inflows: 1000, outflows: 250, net: 750 },
      { key: "2026-08", label: "08.26", inflows: 500, outflows: 0, net: 500 },
    ]);
  });

  it("builds portfolio XIRR from external flows and terminal value", () => {
    const result = buildPortfolioXirr(
      [operation({ id: "deposit-1", trade_date: "2026-01-01", operation_type_code: "deposit", net_amount: 1000 })],
      1100,
      "RUB",
      "2027-01-01",
    );

    expect(result.status).toBe("ready");
    expect(result.value).toBeCloseTo(0.0997, 3);
  });

  it("builds XIRR detail with signed cash-flow lines and terminal valuation", () => {
    const detail = buildPortfolioXirrDetail(
      [
        operation({ id: "deposit-1", trade_date: "2026-01-01", operation_type_code: "deposit", net_amount: 1000 }),
        operation({ id: "withdrawal-1", trade_date: "2026-06-01", operation_type_code: "withdrawal", net_amount: -100 }),
        operation({ id: "buy-1", trade_date: "2026-02-01", operation_type_code: "buy", asset_id: "asset-1", net_amount: -500 }),
        operation({ id: "deposit-usd", trade_date: "2026-03-01", operation_type_code: "deposit", net_amount: 100, currency_code: "USD" }),
      ],
      1100,
      "RUB",
      "2027-01-01",
    );

    expect(detail.result.status).toBe("ready");
    expect(detail.terminalValue).toBe(1100);
    expect(detail.externalInflowTotal).toBe(1000);
    expect(detail.externalOutflowTotal).toBe(100);
    expect(detail.skippedNonBaseCurrencyCount).toBe(1);
    expect(detail.cashFlows).toEqual([
      expect.objectContaining({ kind: "terminal_value", amount: 1100, date: "2027-01-01" }),
      expect.objectContaining({ kind: "external_outflow", amount: 100, operationId: "withdrawal-1" }),
      expect.objectContaining({ kind: "external_inflow", amount: -1000, operationId: "deposit-1" }),
    ]);
  });

  it("builds a dashboard analytics view model", () => {
    const analytics = buildPortfolioAnalytics({
      operations: [
        operation({ id: "deposit-1", trade_date: "2026-01-01", operation_type_code: "deposit", net_amount: 1000 }),
        operation({ id: "buy-1", trade_date: "2026-01-02", operation_type_code: "buy", asset_id: "asset-1", net_amount: -1000 }),
      ],
      positions: [position({ market_value: 1200, unrealized_pnl: 200 })],
      cashBalances: [cashBalance({ balance: 100 })],
      baseCurrency: "RUB",
      asOf: "2027-01-01",
    });

    expect(analytics.totalValue).toBe(1300);
    expect(analytics.investedValue).toBe(1200);
    expect(analytics.cashValue).toBe(100);
    expect(analytics.unrealizedPnl).toBe(200);
    expect(analytics.structureByAssetType[0]).toMatchObject({
      key: "stock",
      value: 1200,
      count: 1,
    });
    expect(analytics.structureByAssetType[1]).toMatchObject({
      key: "cash",
      value: 100,
      count: 1,
    });
    expect(analytics.structureByCurrency[0]).toMatchObject({
      key: "RUB",
      value: 1300,
      count: 2,
    });
    expect(analytics.structureByAccount[0]).toMatchObject({
      key: "account-1",
      value: 1300,
      count: 2,
    });
    expect(analytics.xirr.status).toBe("ready");
    expect(analytics.xirrDetail.cashFlows.at(0)).toMatchObject({ kind: "terminal_value", amount: 1300 });
  });

  it("marks non-base-currency values as partial instead of silently converting them", () => {
    const analytics = buildPortfolioAnalytics({
      operations: [operation({ id: "deposit-usd", operation_type_code: "deposit", net_amount: 100, currency_code: "USD" })],
      positions: [position({ id: "usd-position", currency_code: "USD", market_value: 100, book_value: 90 })],
      cashBalances: [cashBalance({ id: "usd-cash", currency_code: "USD", balance: 10 })],
      baseCurrency: "RUB",
      asOf: "2026-07-15",
    });

    expect(analytics.totalValue).toBe(0);
    expect(analytics.structureByCurrency[0]).toMatchObject({ key: "USD", status: "partial" });
    expect(analytics.alerts.some((alert) => alert.code === "missing_fx_rate")).toBe(true);
  });
});

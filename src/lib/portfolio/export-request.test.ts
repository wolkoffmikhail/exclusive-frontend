import { describe, expect, it } from "vitest";
import type { PortfolioData } from "./data";
import { buildPortfolioExportAuditPayload, parsePortfolioExportRequest, validatePortfolioExportScope } from "./export-request";
import type { WhatIfScenarioResult } from "./scenarios";

const familyId = "family-1";

function data(): PortfolioData {
  return {
    family: { id: familyId, name: "Семья", baseCurrency: "RUB", role: "admin" },
    portfolios: [
      { id: "portfolio-1", family_id: familyId, name: "Основной", base_currency: "RUB", status: "active", description: null, created_at: "2026-07-01" },
      { id: "portfolio-2", family_id: familyId, name: "Дополнительный", base_currency: "RUB", status: "active", description: null, created_at: "2026-07-01" },
    ],
    accounts: [
      { id: "account-1", family_id: familyId, portfolio_id: "portfolio-1", account_type_code: "brokerage", name: "Брокерский", institution_name: null, currency_code: "RUB", status: "active" },
      { id: "account-2", family_id: familyId, portfolio_id: "portfolio-2", account_type_code: "brokerage", name: "Второй", institution_name: null, currency_code: "RUB", status: "active" },
    ],
    assets: [],
    operations: [],
    operationCount: 0,
    positionSnapshots: [],
    positions: [],
    cashBalances: [],
    analytics: {
      baseCurrency: "RUB",
      asOf: "2026-07-22",
      totalValue: 0,
      investedValue: 0,
      cashValue: 0,
      unrealizedPnl: 0,
      positionCount: 0,
      xirr: { status: "missing_valuation", value: null, iterations: 0 },
      xirrDetail: {
        result: { status: "missing_valuation", value: null, iterations: 0 },
        asOf: "2026-07-22",
        terminalValue: 0,
        cashFlows: [],
        externalInflowTotal: 0,
        externalOutflowTotal: 0,
        skippedNonBaseCurrencyCount: 0,
        reason: "Нет положительной текущей оценки портфеля.",
      },
      cashFlowPeriods: [],
      structureByAssetType: [],
      structureByCurrency: [],
      structureByAccount: [],
      alerts: [],
    },
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

function scenario(): WhatIfScenarioResult {
  return {
    ok: true,
    input: {
      scenarioType: "sell",
      familyId,
      accountId: "account-1",
      assetId: "asset-1",
      tradeDate: "2026-07-22",
      quantity: 1,
      price: 100,
      currencyCode: "RUB",
      commission: 0,
      sourceRecommendationId: null,
    },
    virtualOperation: {
      id: "what-if",
      family_id: familyId,
      account_id: "account-1",
      asset_id: "asset-1",
      trade_date: "2026-07-22",
      operation_type_code: "sell",
      quantity: 1,
      price: 100,
      gross_amount: 100,
      fee_amount: 0,
      tax_amount: 0,
      net_amount: 100,
      currency_code: "RUB",
      source: "what-if",
    },
    before: { analytics: data().analytics, positions: [], cashBalances: [], limitCheck: { violations: [], issues: [] } },
    after: { analytics: data().analytics, positions: [], cashBalances: [], limitCheck: { violations: [], issues: [] } },
    metrics: [],
    diagnostics: [],
  };
}

describe("portfolio export request helpers", () => {
  it("parses format and scope from query params", () => {
    const request = parsePortfolioExportRequest(new URLSearchParams({
      format: "pdf-html",
      period: "YTD",
      portfolio_id: "portfolio-1",
      account_id: "account-1",
      include_scenario: "1",
    }));

    expect(request).toEqual({
      format: "pdf-html",
      scope: {
        period: "YTD",
        portfolioId: "portfolio-1",
        accountId: "account-1",
        includeScenario: true,
      },
    });
  });

  it("defaults unsafe period and format", () => {
    const request = parsePortfolioExportRequest(new URLSearchParams({
      format: "unknown",
      period: "quarter",
    }));

    expect(request.format).toBe("excel");
    expect(request.scope.period).toBe("1M");
  });

  it("accepts account and portfolio when they match", () => {
    expect(validatePortfolioExportScope(data(), { portfolioId: "portfolio-1", accountId: "account-1" })).toBeNull();
  });

  it("rejects missing portfolio and account scopes", () => {
    expect(validatePortfolioExportScope(data(), { portfolioId: "missing" })).toBe("portfolio-not-found");
    expect(validatePortfolioExportScope(data(), { accountId: "missing" })).toBe("account-not-found");
  });

  it("rejects account and portfolio mismatch", () => {
    expect(validatePortfolioExportScope(data(), { portfolioId: "portfolio-1", accountId: "account-2" })).toBe("account-portfolio-mismatch");
  });

  it("builds audit payload without raw scenario data or secrets", () => {
    const payload = buildPortfolioExportAuditPayload({
      format: "excel",
      generatedAt: "2026-07-22T09:00:00.000Z",
      scenario: scenario(),
      scope: { period: "All", accountId: "account-1", portfolioId: "portfolio-1", includeScenario: true },
      sheets: ["Summary", "Scenario"],
      warningsCount: 2,
    });

    expect(payload).toEqual({
      format: "excel",
      period: "All",
      portfolio_id: "portfolio-1",
      account_id: "account-1",
      include_scenario: true,
      scenario_ok: true,
      scenario_type: "sell",
      generated_at: "2026-07-22T09:00:00.000Z",
      sheets: ["Summary", "Scenario"],
      warnings_count: 2,
    });
    expect(JSON.stringify(payload)).not.toContain("virtualOperation");
  });
});


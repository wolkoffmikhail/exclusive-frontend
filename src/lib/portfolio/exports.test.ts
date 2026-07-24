import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildPortfolioAnalytics } from "./analytics";
import type { CalculatedCashBalance } from "./calculations";
import type { PortfolioData } from "./data";
import { buildPortfolioExcelBuffer, buildPortfolioExportViewModel, buildPortfolioReportHtml } from "./exports";
import type { WhatIfScenarioResult } from "./scenarios";

const familyId = "family-1";

function data(overrides: Partial<PortfolioData> = {}): PortfolioData {
  const operations: PortfolioData["operations"] = [
    {
      id: "deposit-1",
      family_id: familyId,
      account_id: "account-1",
      asset_id: null,
      trade_date: "2026-07-10",
      operation_type_code: "deposit",
      quantity: null,
      price: null,
      gross_amount: 5000,
      fee_amount: 0,
      tax_amount: 0,
      net_amount: 5000,
      currency_code: "RUB",
      source: "manual",
      operation_group_id: null,
      metadata: {},
      notes: null,
      cancelled_at: null,
      cancellation_reason: null,
    },
  ];
  const positions: PortfolioData["positions"] = [
    {
      id: "position-1",
      family_id: familyId,
      portfolio_id: "portfolio-1",
      account_id: "account-1",
      account_name: "Брокерский счет",
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
      valuation_date: "2026-07-10",
      net_cash_flow: -1000,
      currency_code: "RUB",
    },
  ];
  const cashBalances: CalculatedCashBalance[] = [
    {
      id: "cash-1",
      family_id: familyId,
      portfolio_id: "portfolio-1",
      account_id: "account-1",
      account_name: "Брокерский счет",
      currency_code: "RUB",
      balance: 4000,
      snapshot_date: "2026-07-10",
      net_cash_flow: 0,
    },
  ];
  const analytics = buildPortfolioAnalytics({
    operations,
    positions,
    cashBalances,
    baseCurrency: "RUB",
    asOf: "2026-07-10",
  });

  return {
    family: { id: familyId, name: "Семья", baseCurrency: "RUB", role: "admin" },
    portfolios: [{ id: "portfolio-1", family_id: familyId, name: "Основной портфель", base_currency: "RUB", status: "active", description: null, created_at: "2026-07-01" }],
    accounts: [{ id: "account-1", family_id: familyId, portfolio_id: "portfolio-1", account_type_code: "brokerage", name: "Брокерский счет", institution_name: null, currency_code: "RUB", status: "active" }],
    assets: [{ id: "asset-1", family_id: familyId, asset_type_code: "stock", name: "Демо-акция", ticker: "DEMO", isin: null, market: "TEST", currency_code: "RUB", status: "active" }],
    operations,
    operationCount: operations.length,
    positionSnapshots: [],
    positions,
    cashBalances,
    analytics,
    imports: [],
    importRows: [],
    auditLog: [],
    recommendations: [{
      id: "recommendation-1",
      family_id: familyId,
      portfolio_id: null,
      title: "Проверьте концентрацию",
      body: null,
      status: "open",
      priority: "high",
      due_on: null,
      recommendation_type: "single_asset_concentration",
      reason: "Высокая доля актива",
      source: "rule_based",
      confidence: 0.9,
      metrics: {},
      fingerprint: "rec-1",
      last_generated_at: "2026-07-10",
      accepted_at: null,
      rejected_at: null,
      archived_at: null,
      created_at: "2026-07-10",
      updated_at: "2026-07-10",
    }],
    recommendationReads: [],
    recommendationLinks: [],
    newsItems: [],
    watchlistItems: [],
    events: [],
    limits: [],
    systemAlerts: [],
    notificationPreferences: [],
    notificationDeliveries: [],
    newsSources: [],
    sourceDocuments: [],
    sourceDocumentLinks: [],
    llmAnalyses: [],
    advisorThreads: [],
    advisorMessages: [],
    issuerAliases: [],
    ...overrides,
  };
}

function scenario(): WhatIfScenarioResult {
  return {
    ok: true,
    input: {
      scenarioType: "buy",
      familyId,
      accountId: "account-1",
      assetId: "asset-1",
      tradeDate: "2026-07-20",
      quantity: 1,
      price: 100,
      currencyCode: "RUB",
      commission: 1,
      sourceRecommendationId: null,
    },
    virtualOperation: {
      id: "what-if",
      family_id: familyId,
      account_id: "account-1",
      asset_id: "asset-1",
      trade_date: "2026-07-20",
      operation_type_code: "buy",
      quantity: 1,
      price: 100,
      gross_amount: 100,
      fee_amount: 1,
      tax_amount: 0,
      net_amount: -101,
      currency_code: "RUB",
      source: "what-if",
    },
    before: {
      analytics: data().analytics,
      positions: data().positions,
      cashBalances: data().cashBalances,
      limitCheck: { violations: [], issues: [] },
    },
    after: {
      analytics: data().analytics,
      positions: data().positions,
      cashBalances: data().cashBalances,
      limitCheck: { violations: [], issues: [] },
    },
    metrics: [{ label: "Кэш", before: 4000, after: 3899, delta: -101, format: "money", currencyCode: "RUB" }],
    diagnostics: [],
  };
}

describe("portfolio exports", () => {
  it("builds the required export sheets", () => {
    const viewModel = buildPortfolioExportViewModel({
      data: data(),
      generatedAt: "2026-07-22T09:00:00.000Z",
    });

    expect(viewModel.sheets.map((sheet) => sheet.name)).toEqual([
      "Summary",
      "Positions",
      "Cashflows",
      "Operations",
      "Recommendations",
      "Warnings",
      "Metadata",
    ]);
    expect(viewModel.fileBaseName).toContain("Семья-20260722");
  });

  it("includes scenario rows when requested", () => {
    const viewModel = buildPortfolioExportViewModel({
      data: data(),
      generatedAt: "2026-07-22T09:00:00.000Z",
      scope: { includeScenario: true },
      scenario: scenario(),
    });

    const scenarioSheet = viewModel.sheets.find((sheet) => sheet.name === "Scenario");
    expect(scenarioSheet?.rows).toContainEqual(expect.objectContaining({ "Параметр": "Кэш", "Дельта": -101 }));
  });

  it("creates a readable xlsx workbook", () => {
    const buffer = buildPortfolioExcelBuffer(buildPortfolioExportViewModel({ data: data() }));
    const workbook = XLSX.read(buffer, { type: "buffer" });

    expect(workbook.SheetNames).toContain("Summary");
    expect(workbook.SheetNames).toContain("Positions");
  });

  it("includes a marked LLM summary with citations and limitations when requested", () => {
    const viewModel = buildPortfolioExportViewModel({
      data: data({
        sourceDocuments: [{
          id: "document-1",
          family_id: familyId,
          source_id: "source-1",
          external_id: "press-1",
          title: "Issuer disclosure",
          url: "https://example.test/disclosure",
          published_at: "2026-07-20T10:00:00.000Z",
          issuer_name: "Demo issuer",
          ticker: "DEMO",
          isin: null,
          document_type: "disclosure",
          trust_level: "manual",
          raw_excerpt: "Disclosure text",
          content_hash: "hash-1",
          language: "en",
          payload: {},
          created_at: "2026-07-20T10:01:00.000Z",
          updated_at: "2026-07-20T10:01:00.000Z",
        }],
        llmAnalyses: [{
          id: "analysis-1",
          family_id: familyId,
          source_document_id: "document-1",
          analysis_type: "report_summary",
          model: "test-model",
          prompt_version: "report-summary-v1",
          status: "ready",
          summary: "Portfolio has one high-priority concentration note.",
          facts: [],
          portfolio_links: [],
          impact_level: "medium",
          confidence: 0.72,
          limitations: ["Only saved source documents were included."],
          citations: [{ title: "Issuer disclosure", url: "https://example.test/disclosure" }],
          suggested_actions: [],
          what_if_prefill: null,
          safety_flags: ["service_role_secret_should_not_export"],
          created_at: "2026-07-20T10:02:00.000Z",
          updated_at: "2026-07-20T10:02:00.000Z",
        }],
      }),
      scope: { includeLlmSummary: true },
    });
    const llmSummary = viewModel.sheets.find((sheet) => sheet.name === "LLM Summary");
    const html = buildPortfolioReportHtml(viewModel);

    expect(llmSummary?.rows).toContainEqual(expect.objectContaining({
      "Generated marker": "LLM-generated section; verify citations",
      "Citations": "Issuer disclosure (https://example.test/disclosure)",
      "Limitations": "Only saved source documents were included.",
    }));
    expect(html).toContain("LLM-generated");
    expect(html).toContain("Only saved source documents were included.");
    expect(html).not.toContain("service_role_secret_should_not_export");
  });

  it("recalculates summary for account-scoped exports", () => {
    const base = data();
    const scopedData = data({
      accounts: [
        ...base.accounts,
        { id: "account-2", family_id: familyId, portfolio_id: "portfolio-1", account_type_code: "brokerage", name: "Второй счет", institution_name: null, currency_code: "RUB", status: "active" },
      ],
      operations: [
        ...base.operations,
        {
          ...base.operations[0],
          id: "deposit-2",
          account_id: "account-2",
          net_amount: 10000,
        },
      ],
      positions: [
        ...base.positions,
        {
          ...base.positions[0],
          id: "position-2",
          account_id: "account-2",
          account_name: "Второй счет",
          quantity: 100,
          book_value: 10000,
          market_value: 10000,
          unrealized_pnl: 0,
        },
      ],
      cashBalances: [
        ...base.cashBalances,
        {
          ...base.cashBalances[0],
          id: "cash-2",
          account_id: "account-2",
          account_name: "Второй счет",
          balance: 10000,
        },
      ],
    });
    const viewModel = buildPortfolioExportViewModel({
      data: scopedData,
      scope: { accountId: "account-1" },
    });
    const summary = viewModel.sheets.find((sheet) => sheet.name === "Summary");

    expect(summary?.rows).toContainEqual({ "Показатель": "Стоимость портфеля", "Значение": 5200, "Валюта": "RUB" });
    expect(viewModel.sheets.find((sheet) => sheet.name === "Positions")?.rows).toHaveLength(1);
  });

  it("renders a print-friendly html report", () => {
    const html = buildPortfolioReportHtml(buildPortfolioExportViewModel({ data: data(), scope: { includeScenario: true }, scenario: scenario() }));

    expect(html).toContain("Управленческий отчет");
    expect(html).toContain("Демо-акция");
    expect(html).toContain("What-if");
  });
});

import { describe, expect, it } from "vitest";
import type { Account, Asset, LlmAnalysis, PortfolioData, Position, Recommendation } from "./data";
import { buildAdvisorWhatIfHref } from "./advisor-what-if";

const familyId = "family-1";

const account: Account = {
  id: "account-1",
  family_id: familyId,
  portfolio_id: "portfolio-1",
  account_type_code: "brokerage",
  name: "Broker",
  institution_name: null,
  currency_code: "RUB",
  status: "active",
};

const asset: Asset = {
  id: "asset-1",
  family_id: familyId,
  asset_type_code: "stock",
  name: "Sberbank",
  ticker: "SBER",
  isin: "RU0009029540",
  market: "MOEX",
  currency_code: "RUB",
  status: "active",
};

const position: Position = {
  id: "position-1",
  family_id: familyId,
  portfolio_id: "portfolio-1",
  account_id: "account-1",
  account_name: "Broker",
  asset_id: "asset-1",
  asset_name: "Sberbank",
  ticker: "SBER",
  asset_type_code: "stock",
  quantity: 10,
  average_price: 250,
  book_value: 2500,
  market_price: 270,
  market_value: 2700,
  unrealized_pnl: 200,
  valuation_date: "2026-07-23",
  net_cash_flow: -2500,
  currency_code: "RUB",
};

const recommendation: Recommendation = {
  id: "recommendation-1",
  family_id: familyId,
  portfolio_id: null,
  title: "Review SBER",
  body: null,
  status: "open",
  priority: "high",
  due_on: null,
  recommendation_type: "single_asset_concentration",
  reason: "Concentration is high.",
  source: "rule_based",
  confidence: 0.7,
  metrics: {},
  fingerprint: "single_asset_concentration:asset-1",
  last_generated_at: null,
  accepted_at: null,
  rejected_at: null,
  archived_at: null,
  created_at: "2026-07-23T10:00:00.000Z",
  updated_at: "2026-07-23T10:00:00.000Z",
};

function analysis(overrides: Partial<LlmAnalysis> = {}): LlmAnalysis {
  return {
    id: "analysis-1",
    family_id: familyId,
    source_document_id: null,
    analysis_type: "recommendation_explanation",
    model: "local-fallback",
    prompt_version: "stage7-test",
    status: "ready",
    summary: "Explanation",
    facts: [],
    portfolio_links: [
      { entity_type: "recommendation", entity_id: "recommendation-1", label: "Review SBER" },
      { entity_type: "asset", entity_id: "asset-1", label: "Sberbank" },
    ],
    impact_level: "low",
    confidence: 0.7,
    limitations: [],
    citations: [],
    suggested_actions: [],
    what_if_prefill: { asset_id: "asset-1", quantity: "5", scenario_type: "sell", commission: "1.5" },
    safety_flags: [],
    created_at: "2026-07-23T11:00:00.000Z",
    updated_at: "2026-07-23T11:00:00.000Z",
    ...overrides,
  };
}

function data(overrides: Partial<Pick<PortfolioData, "accounts" | "assets" | "family" | "positions" | "recommendations">> = {}) {
  return {
    accounts: [account],
    assets: [asset],
    family: {
      id: familyId,
      name: "Family",
      baseCurrency: "RUB",
      role: "admin" as const,
    },
    positions: [position],
    recommendations: [recommendation],
    ...overrides,
  } as Pick<PortfolioData, "accounts" | "assets" | "family" | "positions" | "recommendations">;
}

describe("buildAdvisorWhatIfHref", () => {
  it("builds a validated what-if href from stored prefill", () => {
    const href = buildAdvisorWhatIfHref({ analysis: analysis(), data: data() });

    expect(href).toContain("/what-if?");
    expect(href).toContain("scenario_type=sell");
    expect(href).toContain("asset_id=asset-1");
    expect(href).toContain("account_id=account-1");
    expect(href).toContain("currency_code=RUB");
    expect(href).toContain("quantity=5");
    expect(href).toContain("price=270");
    expect(href).toContain("commission=1.5");
    expect(href).toContain("source_recommendation_id=recommendation-1");
  });

  it("rejects prefill that points outside active portfolio assets", () => {
    const href = buildAdvisorWhatIfHref({
      analysis: analysis({ what_if_prefill: { asset_id: "missing-asset" }, portfolio_links: [] }),
      data: data(),
    });

    expect(href).toBeNull();
  });
});

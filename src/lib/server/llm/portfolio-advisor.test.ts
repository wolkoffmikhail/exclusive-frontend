import { describe, expect, it } from "vitest";
import { buildPortfolioAnalytics } from "../../portfolio/analytics";
import type { PortfolioData } from "../../portfolio/data";
import { advisorMessageContextLimit, buildAdvisorPortfolioAnswer } from "./portfolio-advisor";

const familyId = "family-1";

function data(): PortfolioData {
  const positions: PortfolioData["positions"] = [{
    id: "position-1",
    family_id: familyId,
    portfolio_id: "portfolio-1",
    account_id: "account-1",
    account_name: "Brokerage",
    asset_id: "asset-1",
    asset_name: "Demo asset",
    ticker: "DEMO",
    asset_type_code: "stock",
    quantity: 10,
    average_price: 100,
    book_value: 1000,
    market_price: 120,
    market_value: 1200,
    unrealized_pnl: 200,
    valuation_date: "2026-07-24",
    net_cash_flow: -1000,
    currency_code: "RUB",
  }];
  const cashBalances: PortfolioData["cashBalances"] = [{
    id: "cash-1",
    family_id: familyId,
    portfolio_id: "portfolio-1",
    account_id: "account-1",
    account_name: "Brokerage",
    currency_code: "RUB",
    balance: 400,
    snapshot_date: "2026-07-24",
    net_cash_flow: 0,
  }];
  const operations: PortfolioData["operations"] = [];

  return {
    family: { id: familyId, name: "Family", baseCurrency: "RUB", role: "viewer" },
    portfolios: [{ id: "portfolio-1", family_id: familyId, name: "Main", base_currency: "RUB", status: "active", description: null, created_at: "2026-07-01" }],
    accounts: [{ id: "account-1", family_id: familyId, portfolio_id: "portfolio-1", account_type_code: "brokerage", name: "Brokerage", institution_name: null, currency_code: "RUB", status: "active" }],
    assets: [{ id: "asset-1", family_id: familyId, asset_type_code: "stock", name: "Demo asset", ticker: "DEMO", isin: null, market: "MOEX", currency_code: "RUB", status: "active" }],
    operations,
    operationCount: 0,
    positionSnapshots: [],
    positions,
    cashBalances,
    analytics: buildPortfolioAnalytics({ operations, positions, cashBalances, baseCurrency: "RUB", asOf: "2026-07-24" }),
    imports: [],
    importRows: [],
    auditLog: [],
    recommendations: [{
      id: "recommendation-1",
      family_id: familyId,
      portfolio_id: null,
      title: "Review concentration",
      body: null,
      status: "open",
      priority: "high",
      due_on: null,
      recommendation_type: "single_asset_concentration",
      reason: "Asset share is above threshold.",
      source: "rule_based",
      confidence: 0.8,
      metrics: {},
      fingerprint: "rec-1",
      last_generated_at: "2026-07-24",
      accepted_at: null,
      rejected_at: null,
      archived_at: null,
      created_at: "2026-07-24",
      updated_at: "2026-07-24",
      linkedAssetId: "asset-1",
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
    sourceDocuments: [{
      id: "document-1",
      family_id: familyId,
      source_id: "source-1",
      external_id: "doc-1",
      url: "https://example.test/doc",
      title: "Issuer disclosure",
      published_at: "2026-07-24T10:00:00.000Z",
      issuer_name: "Demo issuer",
      ticker: "DEMO",
      isin: null,
      language: "en",
      document_type: "issuer_disclosure",
      trust_level: "manual",
      raw_excerpt: "Issuer disclosed an operational update.",
      content_hash: "hash-1",
      payload: {},
      created_at: "2026-07-24T10:00:00.000Z",
      updated_at: "2026-07-24T10:00:00.000Z",
    }],
    sourceDocumentLinks: [],
    llmAnalyses: [],
    scenarioDrafts: [],
    advisorThreads: [],
    advisorMessages: [],
    issuerAliases: [],
  };
}

describe("buildAdvisorPortfolioAnswer", () => {
  it("builds a safe fallback answer with citations and app entity links", async () => {
    const previousDisabled = process.env.LLM_DISABLED;
    process.env.LLM_DISABLED = "1";

    const answer = await buildAdvisorPortfolioAnswer({
      data: data(),
      question: "What should I check after this disclosure?",
      sourceDocumentId: "document-1",
    });

    process.env.LLM_DISABLED = previousDisabled;

    expect(answer.model).toBe("local-fallback");
    expect(answer.prompt_version).toBe("stage7-advisor-portfolio-question-v1");
    expect(answer.content).toContain("не является персональной инвестиционной рекомендацией");
    expect(answer.citations.map((citation) => citation.id)).toEqual(expect.arrayContaining(["portfolio:snapshot", "source-document:document-1"]));
    expect(answer.linked_entities).toEqual(expect.arrayContaining([
      expect.objectContaining({ entity_type: "asset", entity_id: "asset-1" }),
      expect.objectContaining({ entity_type: "source_document", entity_id: "document-1" }),
    ]));
    expect(answer.safety_flags).toContain("llm_provider_fallback");
  });

  it("keeps the message context limit explicit", () => {
    expect(advisorMessageContextLimit).toBe(8);
  });
});

import { describe, expect, it } from "vitest";
import { buildPortfolioAnalytics } from "./analytics";
import { buildScenarioDraftInsert, scenarioDraftHref } from "./scenario-drafts";
import type { WhatIfScenarioResult } from "./scenarios";

const beforeAnalytics = buildPortfolioAnalytics({
  operations: [],
  positions: [],
  cashBalances: [],
  baseCurrency: "RUB",
  asOf: "2026-07-27",
});
const afterAnalytics = {
  ...beforeAnalytics,
  totalValue: 110,
  cashValue: 29,
  investedValue: 81,
};

const okResult: WhatIfScenarioResult = {
  ok: true,
  input: {
    scenarioType: "buy",
    familyId: "family-1",
    accountId: "account-1",
    assetId: "asset-1",
    tradeDate: "2026-07-27",
    quantity: 2,
    price: 10,
    currencyCode: "RUB",
    commission: 1,
    sourceRecommendationId: null,
  },
  virtualOperation: {
    id: "virtual",
    family_id: "family-1",
    account_id: "account-1",
    asset_id: "asset-1",
    trade_date: "2026-07-27",
    operation_type_code: "buy",
    quantity: 2,
    price: 10,
    gross_amount: 20,
    fee_amount: 1,
    tax_amount: 0,
    net_amount: -21,
    currency_code: "RUB",
    source: "what-if",
  },
  before: {
    analytics: beforeAnalytics,
    positions: [],
    cashBalances: [],
    limitCheck: { violations: [], issues: [] },
  },
  after: {
    analytics: afterAnalytics,
    positions: [],
    cashBalances: [],
    limitCheck: { violations: [], issues: [] },
  },
  metrics: [{ label: "Total", before: 100, after: 110, delta: 10, format: "money", currencyCode: "RUB" }],
  diagnostics: [],
};

describe("scenario draft helpers", () => {
  it("builds a normalized draft insert payload", () => {
    const result = buildScenarioDraftInsert({
      title: " Buy idea ",
      scenarioType: "buy",
      familyId: "family-1",
      accountId: "account-1",
      assetId: "asset-1",
      tradeDate: "2026-07-27",
      quantity: "2,5",
      price: "100",
      currencyCode: "rub",
      commission: "",
    }, "user-1", okResult);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.title).toBe("Buy idea");
    expect(result.draft.quantity).toBe(2.5);
    expect(result.draft.currency_code).toBe("RUB");
    expect(result.draft.input_payload).toMatchObject({ scenarioType: "buy", commission: 0 });
    expect(result.draft.result_snapshot).toMatchObject({ ok: true, after: { totalValue: 110 } });
  });

  it("rejects incomplete drafts", () => {
    const result = buildScenarioDraftInsert({
      title: "",
      scenarioType: "sell",
      familyId: "family-1",
      accountId: "account-1",
      assetId: "asset-1",
      tradeDate: "2026-07-27",
      quantity: "1",
      price: "10",
      currencyCode: "RUB",
    }, "user-1", okResult);

    expect(result).toEqual({ ok: false, error: "title-required" });
  });

  it("creates reopen hrefs from stored draft fields", () => {
    expect(scenarioDraftHref({
      id: "draft-1",
      scenario_type: "sell",
      account_id: "account-1",
      asset_id: "asset-1",
      trade_date: "2026-07-27",
      quantity: "1",
      price: "20",
      currency_code: "RUB",
      commission: "0",
      source_recommendation_id: "recommendation-1",
    })).toBe("/what-if?scenario_draft_id=draft-1&scenario_type=sell&account_id=account-1&asset_id=asset-1&trade_date=2026-07-27&quantity=1&price=20&currency_code=RUB&commission=0&source_recommendation_id=recommendation-1");
  });
});

import type { WhatIfScenarioResult } from "./scenarios";

export type ScenarioDraftStatus = "draft" | "archived";

export type ScenarioDraftInput = {
  title?: string | null;
  scenarioType?: string | null;
  familyId: string;
  accountId?: string | null;
  assetId?: string | null;
  tradeDate?: string | null;
  quantity?: string | number | null;
  price?: string | number | null;
  currencyCode?: string | null;
  commission?: string | number | null;
  sourceRecommendationId?: string | null;
};

export type ScenarioDraftInsert = {
  family_id: string;
  owner_user_id: string;
  title: string;
  status: ScenarioDraftStatus;
  scenario_type: "buy" | "sell";
  account_id: string;
  asset_id: string;
  trade_date: string;
  quantity: number;
  price: number;
  currency_code: string;
  commission: number;
  source_recommendation_id: string | null;
  input_payload: Record<string, unknown>;
  result_snapshot: Record<string, unknown>;
  created_by: string;
  updated_by: string;
};

export type ScenarioDraftBuildResult =
  | { ok: true; draft: ScenarioDraftInsert }
  | { ok: false; error: "title-required" | "account-required" | "asset-required" | "date-required" | "quantity-required" | "price-required" | "currency-invalid" };

function parsePositive(value: string | number | null | undefined) {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseNonNegative(value: string | number | null | undefined) {
  if (value == null || value === "") return 0;
  const parsed = typeof value === "number" ? value : Number(String(value).trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeCurrencyCode(value: string | null | undefined) {
  return String(value ?? "").trim().toUpperCase();
}

function isIsoDate(value: string | null | undefined) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));
}

export function scenarioDraftHref(input: {
  id?: string | null;
  scenario_type: string;
  account_id: string;
  asset_id: string;
  trade_date: string;
  quantity: string | number;
  price: string | number;
  currency_code: string;
  commission?: string | number | null;
  source_recommendation_id?: string | null;
}) {
  const params = new URLSearchParams();
  if (input.id) params.set("scenario_draft_id", input.id);
  params.set("scenario_type", input.scenario_type);
  params.set("account_id", input.account_id);
  params.set("asset_id", input.asset_id);
  params.set("trade_date", input.trade_date);
  params.set("quantity", String(input.quantity));
  params.set("price", String(input.price));
  params.set("currency_code", input.currency_code);
  params.set("commission", String(input.commission ?? 0));
  if (input.source_recommendation_id) params.set("source_recommendation_id", input.source_recommendation_id);
  return `/what-if?${params.toString()}`;
}

export function scenarioResultSnapshot(result: WhatIfScenarioResult) {
  if (!result.ok) {
    return {
      ok: false,
      diagnostics: result.diagnostics,
    };
  }

  return {
    ok: true,
    metrics: result.metrics,
    diagnostics: result.diagnostics,
    before: {
      totalValue: result.before.analytics.totalValue,
      cashValue: result.before.analytics.cashValue,
      limitViolations: result.before.limitCheck.violations.length,
    },
    after: {
      totalValue: result.after.analytics.totalValue,
      cashValue: result.after.analytics.cashValue,
      limitViolations: result.after.limitCheck.violations.length,
    },
  };
}

export function buildScenarioDraftInsert(input: ScenarioDraftInput, userId: string, result: WhatIfScenarioResult): ScenarioDraftBuildResult {
  const title = String(input.title ?? "").trim();
  const scenarioType = input.scenarioType === "sell" ? "sell" : "buy";
  const accountId = String(input.accountId ?? "").trim();
  const assetId = String(input.assetId ?? "").trim();
  const tradeDate = String(input.tradeDate ?? "").trim();
  const quantity = parsePositive(input.quantity);
  const price = parsePositive(input.price);
  const commission = parseNonNegative(input.commission);
  const currencyCode = normalizeCurrencyCode(input.currencyCode);
  const sourceRecommendationId = String(input.sourceRecommendationId ?? "").trim() || null;

  if (!title) return { ok: false, error: "title-required" };
  if (!accountId) return { ok: false, error: "account-required" };
  if (!assetId) return { ok: false, error: "asset-required" };
  if (!isIsoDate(tradeDate)) return { ok: false, error: "date-required" };
  if (quantity === null) return { ok: false, error: "quantity-required" };
  if (price === null || commission === null) return { ok: false, error: "price-required" };
  if (!/^[A-Z]{3}$/.test(currencyCode)) return { ok: false, error: "currency-invalid" };

  const payload = {
    scenarioType,
    familyId: input.familyId,
    accountId,
    assetId,
    tradeDate,
    quantity,
    price,
    currencyCode,
    commission,
    sourceRecommendationId,
  };

  return {
    ok: true,
    draft: {
      family_id: input.familyId,
      owner_user_id: userId,
      title: title.slice(0, 200),
      status: "draft",
      scenario_type: scenarioType,
      account_id: accountId,
      asset_id: assetId,
      trade_date: tradeDate,
      quantity,
      price,
      currency_code: currencyCode,
      commission,
      source_recommendation_id: sourceRecommendationId,
      input_payload: payload,
      result_snapshot: scenarioResultSnapshot(result),
      created_by: userId,
      updated_by: userId,
    },
  };
}

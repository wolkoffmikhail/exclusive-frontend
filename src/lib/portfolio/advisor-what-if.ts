import type { LlmAnalysis, PortfolioData } from "./data";

type AdvisorWhatIfData = Pick<PortfolioData, "accounts" | "assets" | "family" | "positions" | "recommendations">;

type PortfolioLink = {
  entity_type?: unknown;
  entity_id?: unknown;
};

type AdvisorWhatIfPrefill = Record<string, unknown>;

function textValue(input: AdvisorWhatIfPrefill, ...keys: string[]) {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }

  return null;
}

function positiveNumberText(value: string | null) {
  if (!value) return null;
  const parsed = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : null;
}

function nonNegativeNumberText(value: string | null) {
  if (!value) return null;
  const parsed = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? String(parsed) : null;
}

function isoDateText(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function currencyText(value: string | null) {
  const normalized = value?.trim().toUpperCase();
  return normalized && /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

function portfolioAssetId(links: unknown[]) {
  for (const link of links) {
    const portfolioLink = link as PortfolioLink;
    if (portfolioLink.entity_type === "asset" && typeof portfolioLink.entity_id === "string") return portfolioLink.entity_id;
  }

  return null;
}

function recommendationId(analysis: LlmAnalysis) {
  for (const link of analysis.portfolio_links) {
    const portfolioLink = link as PortfolioLink;
    if (portfolioLink.entity_type === "recommendation" && typeof portfolioLink.entity_id === "string") return portfolioLink.entity_id;
  }

  return null;
}

export function buildAdvisorWhatIfHref({
  analysis,
  data,
  sourceRecommendationId,
}: {
  analysis: LlmAnalysis;
  data: AdvisorWhatIfData;
  sourceRecommendationId?: string | null;
}) {
  const prefill = analysis.what_if_prefill ?? {};
  const requestedAssetId = textValue(prefill, "asset_id", "assetId") ?? portfolioAssetId(analysis.portfolio_links);
  const asset = data.assets.find((item) => item.id === requestedAssetId && item.status === "active" && item.asset_type_code !== "cash");
  if (!asset) return null;

  const requestedAccountId = textValue(prefill, "account_id", "accountId");
  const preferredPosition = data.positions.find((position) => position.asset_id === asset.id && (!requestedAccountId || position.account_id === requestedAccountId));
  const account = data.accounts.find((item) => item.id === requestedAccountId && item.status === "active")
    ?? (preferredPosition ? data.accounts.find((item) => item.id === preferredPosition.account_id && item.status === "active") : null)
    ?? data.accounts.find((item) => item.status === "active");
  if (!account) return null;

  const scenarioType = textValue(prefill, "scenario_type", "scenarioType") === "sell" ? "sell" : "buy";
  const currencyCode = currencyText(textValue(prefill, "currency_code", "currencyCode"))
    ?? preferredPosition?.currency_code
    ?? asset.currency_code
    ?? account.currency_code
    ?? data.family?.baseCurrency
    ?? "RUB";
  const sourceId = sourceRecommendationId
    ?? textValue(prefill, "source_recommendation_id", "sourceRecommendationId")
    ?? recommendationId(analysis);
  const validSourceId = sourceId && data.recommendations.some((recommendation) => recommendation.id === sourceId) ? sourceId : null;
  const price = positiveNumberText(textValue(prefill, "price"))
    ?? (preferredPosition?.market_price == null ? null : String(preferredPosition.market_price))
    ?? (preferredPosition?.average_price == null ? null : String(preferredPosition.average_price));
  const quantity = positiveNumberText(textValue(prefill, "quantity"));
  const commission = nonNegativeNumberText(textValue(prefill, "commission"));
  const tradeDate = isoDateText(textValue(prefill, "trade_date", "tradeDate"));
  const params = new URLSearchParams();

  params.set("scenario_type", scenarioType);
  params.set("asset_id", asset.id);
  params.set("account_id", account.id);
  params.set("currency_code", currencyCode);
  if (tradeDate) params.set("trade_date", tradeDate);
  if (quantity) params.set("quantity", quantity);
  if (price) params.set("price", price);
  if (commission) params.set("commission", commission);
  if (validSourceId) params.set("source_recommendation_id", validSourceId);

  return `/what-if?${params.toString()}`;
}

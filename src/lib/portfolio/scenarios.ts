import { buildPortfolioAnalytics, type PortfolioAnalytics } from "./analytics";
import {
  calculateCashBalances,
  calculatePositions,
  toNumber,
  type CalculatedCashBalance,
  type CalculatedPosition,
  type CalculationAccount,
  type CalculationAsset,
  type CalculationOperation,
  type CalculationPositionSnapshot,
} from "./calculations";
import { availableCash, availablePositionQuantity, normalizeCurrencyCode } from "./manual-operations";
import { evaluatePortfolioLimitCheck, type LimitEvaluationResult, type PortfolioLimitRule } from "./limits";

export type ScenarioType = "buy" | "sell";

export type WhatIfScenarioInput = {
  scenarioType: ScenarioType;
  familyId: string;
  accountId: string;
  assetId: string;
  tradeDate: string;
  quantity: number | string | null;
  price: number | string | null;
  currencyCode: string;
  commission?: number | string | null;
  sourceRecommendationId?: string | null;
};

export type WhatIfScenarioContext = {
  familyId: string;
  accounts: CalculationAccount[];
  assets: CalculationAsset[];
  operations: CalculationOperation[];
  positionSnapshots: CalculationPositionSnapshot[];
  positions: CalculatedPosition[];
  cashBalances: CalculatedCashBalance[];
  limits: PortfolioLimitRule[];
  baseCurrency: string;
};

export type ScenarioDiagnostic = {
  code:
    | "asset-required"
    | "account-required"
    | "date-required"
    | "quantity-required"
    | "price-required"
    | "currency-invalid"
    | "commission-invalid"
    | "account-not-found"
    | "asset-not-found"
    | "cash-insufficient"
    | "position-insufficient"
    | "missing-fx-rate"
    | "missing-market-price"
    | "xirr-unavailable";
  severity: "error" | "warning" | "info";
  message: string;
};

export type ScenarioMetricDelta = {
  label: string;
  before: number | null;
  after: number | null;
  delta: number | null;
  format: "money" | "quantity" | "percent";
  currencyCode?: string;
};

export type ScenarioPortfolioState = {
  analytics: PortfolioAnalytics;
  positions: CalculatedPosition[];
  cashBalances: CalculatedCashBalance[];
  limitCheck: LimitEvaluationResult;
};

export type WhatIfScenarioResult =
  | {
      ok: true;
      input: NormalizedScenarioInput;
      virtualOperation: CalculationOperation;
      before: ScenarioPortfolioState;
      after: ScenarioPortfolioState;
      metrics: ScenarioMetricDelta[];
      diagnostics: ScenarioDiagnostic[];
    }
  | {
      ok: false;
      diagnostics: ScenarioDiagnostic[];
    };

type NormalizedScenarioInput = {
  scenarioType: ScenarioType;
  familyId: string;
  accountId: string;
  assetId: string;
  tradeDate: string;
  quantity: number;
  price: number;
  currencyCode: string;
  commission: number;
  sourceRecommendationId: string | null;
};

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parsePositive(value: number | string | null | undefined) {
  const parsed = toNumber(typeof value === "string" ? value.replace(/\s/g, "").replace(",", ".") : value);
  return parsed > 0 ? parsed : null;
}

function parseNonNegative(value: number | string | null | undefined) {
  if (value == null || value === "") return 0;
  const parsed = toNumber(typeof value === "string" ? value.replace(/\s/g, "").replace(",", ".") : value);
  return parsed >= 0 ? parsed : null;
}

function normalizeScenarioInput(input: WhatIfScenarioInput): { ok: true; input: NormalizedScenarioInput } | { ok: false; diagnostics: ScenarioDiagnostic[] } {
  const diagnostics: ScenarioDiagnostic[] = [];
  const quantity = parsePositive(input.quantity);
  const price = parsePositive(input.price);
  const commission = parseNonNegative(input.commission);
  const currencyCode = normalizeCurrencyCode(input.currencyCode);

  if (!input.accountId) diagnostics.push({ code: "account-required", severity: "error", message: "Выберите счет для сценария." });
  if (!input.assetId) diagnostics.push({ code: "asset-required", severity: "error", message: "Выберите актив для сценария." });
  if (!isIsoDate(input.tradeDate)) diagnostics.push({ code: "date-required", severity: "error", message: "Укажите дату сценария в формате YYYY-MM-DD." });
  if (quantity === null) diagnostics.push({ code: "quantity-required", severity: "error", message: "Количество должно быть больше нуля." });
  if (price === null) diagnostics.push({ code: "price-required", severity: "error", message: "Цена должна быть больше нуля." });
  if (!/^[A-Z]{3}$/.test(currencyCode)) diagnostics.push({ code: "currency-invalid", severity: "error", message: "Валюта должна состоять из трех латинских букв." });
  if (commission === null) diagnostics.push({ code: "commission-invalid", severity: "error", message: "Комиссия не может быть отрицательной." });

  if (diagnostics.length > 0 || quantity === null || price === null || commission === null) return { ok: false, diagnostics };

  return {
    ok: true,
    input: {
      scenarioType: input.scenarioType,
      familyId: input.familyId,
      accountId: input.accountId,
      assetId: input.assetId,
      tradeDate: input.tradeDate,
      quantity,
      price,
      currencyCode,
      commission,
      sourceRecommendationId: input.sourceRecommendationId ?? null,
    },
  };
}

function virtualOperation(input: NormalizedScenarioInput): CalculationOperation {
  const gross = input.quantity * input.price;
  const net = input.scenarioType === "buy" ? -Math.abs(gross + input.commission) : Math.abs(gross - input.commission);

  return {
    id: "what-if-virtual-operation",
    family_id: input.familyId,
    account_id: input.accountId,
    asset_id: input.assetId,
    trade_date: input.tradeDate,
    operation_type_code: input.scenarioType,
    quantity: input.quantity,
    price: input.price,
    gross_amount: gross,
    fee_amount: input.commission,
    tax_amount: 0,
    net_amount: net,
    currency_code: input.currencyCode,
    source: "what-if",
  };
}

function portfolioState({
  baseCurrency,
  context,
  operations,
}: {
  context: WhatIfScenarioContext;
  operations: CalculationOperation[];
  baseCurrency: string;
}): ScenarioPortfolioState {
  const positions = calculatePositions(operations, context.accounts, context.assets, context.positionSnapshots, context.familyId);
  const cashBalances = calculateCashBalances(operations, context.accounts, context.assets, context.positionSnapshots, context.familyId);
  const analytics = buildPortfolioAnalytics({
    operations,
    positions,
    cashBalances,
    baseCurrency,
  });
  const limitCheck = evaluatePortfolioLimitCheck({ analytics, positions, limits: context.limits });

  return { analytics, positions, cashBalances, limitCheck };
}

function positionValue(position: CalculatedPosition) {
  return position.market_value ?? position.book_value;
}

function selectedAssetStats(positions: CalculatedPosition[], assetId: string, totalValue: number) {
  const assetPositions = positions.filter((position) => position.asset_id === assetId);
  const quantity = assetPositions.reduce((sum, position) => sum + position.quantity, 0);
  const value = assetPositions.reduce((sum, position) => sum + positionValue(position), 0);
  return {
    quantity,
    value,
    share: totalValue > 0 ? value / totalValue : null,
  };
}

function delta(label: string, before: number | null, after: number | null, format: ScenarioMetricDelta["format"], currencyCode?: string): ScenarioMetricDelta {
  return {
    label,
    before,
    after,
    delta: before === null || after === null ? null : after - before,
    format,
    currencyCode,
  };
}

function buildMetrics(before: ScenarioPortfolioState, after: ScenarioPortfolioState, input: NormalizedScenarioInput, baseCurrency: string): ScenarioMetricDelta[] {
  const beforeAsset = selectedAssetStats(before.positions, input.assetId, before.analytics.totalValue);
  const afterAsset = selectedAssetStats(after.positions, input.assetId, after.analytics.totalValue);

  return [
    delta("Стоимость портфеля", before.analytics.totalValue, after.analytics.totalValue, "money", baseCurrency),
    delta("Кэш", before.analytics.cashValue, after.analytics.cashValue, "money", baseCurrency),
    delta("Доля кэша", before.analytics.totalValue > 0 ? before.analytics.cashValue / before.analytics.totalValue : null, after.analytics.totalValue > 0 ? after.analytics.cashValue / after.analytics.totalValue : null, "percent"),
    delta("Количество актива", beforeAsset.quantity, afterAsset.quantity, "quantity"),
    delta("Стоимость актива", beforeAsset.value, afterAsset.value, "money", input.currencyCode),
    delta("Доля актива", beforeAsset.share, afterAsset.share, "percent"),
    delta("P&L", before.analytics.unrealizedPnl, after.analytics.unrealizedPnl, "money", baseCurrency),
  ];
}

function validationDiagnostics(input: NormalizedScenarioInput, context: WhatIfScenarioContext) {
  const diagnostics: ScenarioDiagnostic[] = [];
  const account = context.accounts.find((item) => item.id === input.accountId);
  const asset = context.assets.find((item) => item.id === input.assetId);

  if (!account) diagnostics.push({ code: "account-not-found", severity: "error", message: "Счет не найден в активной семье." });
  if (!asset) diagnostics.push({ code: "asset-not-found", severity: "error", message: "Актив не найден в активной семье." });

  const grossWithCommission = input.quantity * input.price + input.commission;
  if (input.scenarioType === "buy" && availableCash(context.cashBalances, input.accountId, input.currencyCode) < grossWithCommission) {
    diagnostics.push({ code: "cash-insufficient", severity: "error", message: "Недостаточно кэша для покупки с учетом комиссии." });
  }

  if (input.scenarioType === "sell" && availablePositionQuantity(context.positions, input.accountId, input.assetId, input.currencyCode) < input.quantity) {
    diagnostics.push({ code: "position-insufficient", severity: "error", message: "Недостаточно позиции для продажи выбранного количества." });
  }

  if (input.currencyCode !== context.baseCurrency) {
    diagnostics.push({ code: "missing-fx-rate", severity: "warning", message: `Сценарий в ${input.currencyCode} будет частичным: отдельная FX-модель для пересчета в ${context.baseCurrency} еще не подключена.` });
  }

  if (asset && asset.currency_code && asset.currency_code !== input.currencyCode) {
    diagnostics.push({ code: "missing-fx-rate", severity: "warning", message: `Валюта актива ${asset.currency_code} отличается от валюты сценария ${input.currencyCode}; результат может быть частичным.` });
  }

  return diagnostics;
}

function resultDiagnostics(before: ScenarioPortfolioState, after: ScenarioPortfolioState) {
  const diagnostics: ScenarioDiagnostic[] = [];
  const analyticsAlerts = [...before.analytics.alerts, ...after.analytics.alerts];

  if (analyticsAlerts.some((alert) => alert.code === "missing_market_price")) {
    diagnostics.push({ code: "missing-market-price", severity: "warning", message: "Для части позиций нет рыночной цены, поэтому сценарий использует балансовую стоимость." });
  }

  if (analyticsAlerts.some((alert) => alert.code === "xirr_unavailable")) {
    diagnostics.push({ code: "xirr-unavailable", severity: "info", message: "XIRR в сценарии может быть недоступен из-за недостатка потоков или оценки." });
  }

  return diagnostics;
}

export function runWhatIfScenario(input: WhatIfScenarioInput, context: WhatIfScenarioContext): WhatIfScenarioResult {
  const normalized = normalizeScenarioInput(input);
  if (!normalized.ok) return { ok: false, diagnostics: normalized.diagnostics };

  const validation = validationDiagnostics(normalized.input, context);
  if (validation.some((diagnostic) => diagnostic.severity === "error")) return { ok: false, diagnostics: validation };

  const operation = virtualOperation(normalized.input);
  const before = portfolioState({ context, operations: context.operations, baseCurrency: context.baseCurrency });
  const after = portfolioState({ context, operations: [...context.operations, operation], baseCurrency: context.baseCurrency });

  return {
    ok: true,
    input: normalized.input,
    virtualOperation: operation,
    before,
    after,
    metrics: buildMetrics(before, after, normalized.input, context.baseCurrency),
    diagnostics: [...validation, ...resultDiagnostics(before, after)],
  };
}

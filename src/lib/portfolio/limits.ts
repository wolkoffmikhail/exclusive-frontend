import type { PortfolioAnalytics, StructureSlice } from "./analytics";
import type { CalculatedPosition } from "./calculations";

export type LimitType = "asset_share" | "asset_class_share" | "currency_share" | "cash_min_share" | "cash_max_share";
export type LimitDirection = "min" | "max";
export type LimitSeverity = "info" | "warning" | "critical";

export type PortfolioLimitRule = {
  id: string;
  limit_type: LimitType | string;
  scope_key: string | null;
  threshold_value: number | string;
  direction: LimitDirection | string;
  severity: LimitSeverity | string;
  status: string;
};

export type LimitViolation = {
  limitId: string;
  limitType: LimitType;
  scopeKey: string | null;
  direction: LimitDirection;
  severity: LimitSeverity;
  fingerprint: string;
  title: string;
  currentValue: number;
  thresholdValue: number;
  href: string;
  payload: {
    limit_id: string;
    limit_type: LimitType;
    scope_key: string | null;
    direction: LimitDirection;
    severity: LimitSeverity;
    current_value: number;
    threshold_value: number;
    current_percent: number;
    threshold_percent: number;
    source: "portfolio_analytics";
  };
};

export type LimitEvaluationIssue = {
  limitId: string;
  limitType: LimitType;
  scopeKey: string | null;
  status: "partial" | "skipped";
  reason: string;
  message: string;
  currentValue: number | null;
  thresholdValue: number | null;
  payload: {
    limit_id: string;
    limit_type: LimitType;
    scope_key: string | null;
    status: "partial" | "skipped";
    reason: string;
    current_value: number | null;
    threshold_value: number | null;
    source: "portfolio_analytics";
  };
};

export type LimitEvaluationResult = {
  violations: LimitViolation[];
  issues: LimitEvaluationIssue[];
};

type EvaluatePortfolioLimitsInput = {
  analytics: PortfolioAnalytics;
  positions: CalculatedPosition[];
  limits: PortfolioLimitRule[];
};

const validLimitTypes = new Set<LimitType>(["asset_share", "asset_class_share", "currency_share", "cash_min_share", "cash_max_share"]);
const validDirections = new Set<LimitDirection>(["min", "max"]);
const validSeverities = new Set<LimitSeverity>(["info", "warning", "critical"]);

function toNumber(value: number | string | null | undefined) {
  const number = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function isLimitType(value: string): value is LimitType {
  return validLimitTypes.has(value as LimitType);
}

function isDirection(value: string): value is LimitDirection {
  return validDirections.has(value as LimitDirection);
}

function severity(value: string): LimitSeverity {
  return validSeverities.has(value as LimitSeverity) ? (value as LimitSeverity) : "warning";
}

function percent(value: number) {
  return Math.round(value * 10000) / 100;
}

function violates(currentValue: number, thresholdValue: number, direction: LimitDirection) {
  if (direction === "min") return currentValue < thresholdValue;
  return currentValue > thresholdValue;
}

function findSlice(slices: StructureSlice[], key: string | null) {
  if (!key) return null;
  return slices.find((slice) => slice.key === key) ?? null;
}

function positionValue(position: CalculatedPosition) {
  return position.market_value ?? position.book_value;
}

function assetShare(positions: CalculatedPosition[], totalValue: number, assetId: string | null) {
  if (!assetId || totalValue <= 0) return null;
  const value = positions
    .filter((position) => position.asset_id === assetId)
    .reduce((sum, position) => sum + positionValue(position), 0);
  return value / totalValue;
}

function limitLabel(limitType: LimitType, scopeKey: string | null) {
  if (limitType === "asset_share") return `актив ${scopeKey ?? "не указан"}`;
  if (limitType === "asset_class_share") return `класс ${scopeKey ?? "не указан"}`;
  if (limitType === "currency_share") return `валюта ${scopeKey ?? "не указана"}`;
  if (limitType === "cash_min_share") return "минимальная доля кэша";
  return "максимальная доля кэша";
}

function hrefFor(limitType: LimitType, scopeKey: string | null) {
  if (limitType === "asset_share" && scopeKey) return `/assets?asset_id=${scopeKey}`;
  if (limitType === "asset_class_share" && scopeKey) return `/assets?position_asset_type=${scopeKey}`;
  if (limitType === "currency_share" && scopeKey) return `/assets?position_currency=${scopeKey}`;
  return "/dashboard";
}

function buildViolation({
  currentValue,
  direction,
  limit,
  limitType,
  scopeKey,
  thresholdValue,
}: {
  limit: PortfolioLimitRule;
  limitType: LimitType;
  scopeKey: string | null;
  direction: LimitDirection;
  currentValue: number;
  thresholdValue: number;
}): LimitViolation {
  const limitSeverity = severity(limit.severity);
  const label = limitLabel(limitType, scopeKey);
  const comparator = direction === "min" ? "ниже" : "выше";

  return {
    limitId: limit.id,
    limitType,
    scopeKey,
    direction,
    severity: limitSeverity,
    fingerprint: `limit:${limit.id}:${limitType}:${scopeKey ?? "portfolio"}:${direction}`,
    title: `Лимит нарушен: ${label} ${comparator} ${percent(thresholdValue)}%`,
    currentValue,
    thresholdValue,
    href: hrefFor(limitType, scopeKey),
    payload: {
      limit_id: limit.id,
      limit_type: limitType,
      scope_key: scopeKey,
      direction,
      severity: limitSeverity,
      current_value: currentValue,
      threshold_value: thresholdValue,
      current_percent: percent(currentValue),
      threshold_percent: percent(thresholdValue),
      source: "portfolio_analytics",
    },
  };
}

function buildIssue({
  currentValue,
  limit,
  limitType,
  message,
  reason,
  scopeKey,
  status,
  thresholdValue,
}: {
  limit: PortfolioLimitRule;
  limitType: LimitType;
  scopeKey: string | null;
  status: "partial" | "skipped";
  reason: string;
  message: string;
  currentValue: number | null;
  thresholdValue: number | null;
}): LimitEvaluationIssue {
  return {
    limitId: limit.id,
    limitType,
    scopeKey,
    status,
    reason,
    message,
    currentValue,
    thresholdValue,
    payload: {
      limit_id: limit.id,
      limit_type: limitType,
      scope_key: scopeKey,
      status,
      reason,
      current_value: currentValue,
      threshold_value: thresholdValue,
      source: "portfolio_analytics",
    },
  };
}

export function evaluatePortfolioLimitCheck(input: EvaluatePortfolioLimitsInput): LimitEvaluationResult {
  const totalValue = input.analytics.totalValue;
  const violations: LimitViolation[] = [];
  const issues: LimitEvaluationIssue[] = [];

  for (const limit of input.limits) {
    if (limit.status !== "active") continue;
    if (!isLimitType(limit.limit_type)) continue;
    if (!isDirection(limit.direction)) continue;

    const thresholdValue = toNumber(limit.threshold_value);
    if (thresholdValue < 0) continue;

    let currentValue: number | null = null;
    let isPartial = false;
    const scopeKey = limit.scope_key;

    if (totalValue <= 0) {
      issues.push(buildIssue({
        limit,
        limitType: limit.limit_type,
        scopeKey,
        status: "skipped",
        reason: "portfolio_value_unavailable",
        message: "Portfolio value is zero or unavailable, so the limit cannot be evaluated.",
        currentValue: null,
        thresholdValue,
      }));
      continue;
    }

    if (limit.limit_type === "asset_share") {
      currentValue = assetShare(input.positions, totalValue, scopeKey);
    }

    if (limit.limit_type === "asset_class_share") {
      const slice = findSlice(input.analytics.structureByAssetType, scopeKey);
      currentValue = slice?.percent ?? null;
      isPartial = slice?.status === "partial";
    }

    if (limit.limit_type === "currency_share") {
      const slice = findSlice(input.analytics.structureByCurrency, scopeKey);
      currentValue = slice?.percent ?? null;
      isPartial = slice?.status === "partial";
    }

    if (limit.limit_type === "cash_min_share" || limit.limit_type === "cash_max_share") {
      currentValue = input.analytics.cashValue / totalValue;
    }

    if (currentValue === null) {
      issues.push(buildIssue({
        limit,
        limitType: limit.limit_type,
        scopeKey,
        status: "skipped",
        reason: "metric_unavailable",
        message: "Required metric is unavailable for this limit scope.",
        currentValue,
        thresholdValue,
      }));
      continue;
    }

    if (isPartial) {
      issues.push(buildIssue({
        limit,
        limitType: limit.limit_type,
        scopeKey,
        status: "partial",
        reason: "metric_partial",
        message: "Limit was evaluated on partial analytics data.",
        currentValue,
        thresholdValue,
      }));
    }

    if (!violates(currentValue, thresholdValue, limit.direction)) continue;

    violations.push(buildViolation({
      limit,
      limitType: limit.limit_type,
      scopeKey,
      direction: limit.direction,
      currentValue,
      thresholdValue,
    }));
  }

  return { violations, issues };
}

export function evaluatePortfolioLimits(input: EvaluatePortfolioLimitsInput): LimitViolation[] {
  return evaluatePortfolioLimitCheck(input).violations;
}

import type { PortfolioAnalytics, StructureSlice } from "./analytics";
import type { CalculatedCashBalance, CalculatedPosition } from "./calculations";

export type RuleBasedRecommendationPriority = "low" | "normal" | "high" | "critical";

export type RuleBasedRecommendation = {
  id: string;
  recommendation_type: string;
  title: string;
  body: string;
  reason: string;
  priority: RuleBasedRecommendationPriority;
  source: "rule_based";
  status: "open";
  confidence: number;
  metrics: Record<string, string | number | null>;
  fingerprint: string;
  created_at: string;
  updated_at: string;
  linkedAssetId: string | null;
  href: string;
  isGenerated: true;
};

export type UpcomingEventForRecommendation = {
  id: string;
  asset_id: string | null;
  event_date: string;
  event_type: string;
  title: string;
  amount?: number | string | null;
  currency_code?: string | null;
  status: string;
};

type BuildRuleBasedRecommendationsInput = {
  analytics: PortfolioAnalytics;
  positions: CalculatedPosition[];
  cashBalances: CalculatedCashBalance[];
  events?: UpcomingEventForRecommendation[];
};

const highShareThreshold = 0.35;
const cashLowThreshold = 0.05;
const cashHighThreshold = 0.30;
const upcomingEventHorizonDays = 45;

function generatedId(fingerprint: string) {
  return `generated:${fingerprint}`;
}

function percent(value: number) {
  return Math.round(value * 10000) / 100;
}

function topReadySlice(slices: StructureSlice[]) {
  return slices.find((slice) => slice.status === "ready" && slice.percent > 0);
}

function positionValue(position: CalculatedPosition) {
  return position.market_value ?? position.book_value;
}

function daysBetween(left: string, right: string) {
  const leftDate = new Date(`${left}T00:00:00.000Z`);
  const rightDate = new Date(`${right}T00:00:00.000Z`);
  if (Number.isNaN(leftDate.getTime()) || Number.isNaN(rightDate.getTime())) return Number.POSITIVE_INFINITY;
  return Math.round((rightDate.getTime() - leftDate.getTime()) / 86_400_000);
}

function recommendation({
  asOf,
  body,
  confidence,
  fingerprint,
  href,
  linkedAssetId = null,
  metrics,
  priority,
  reason,
  title,
  type,
}: {
  asOf: string;
  type: string;
  title: string;
  body: string;
  reason: string;
  priority: RuleBasedRecommendationPriority;
  confidence: number;
  metrics: RuleBasedRecommendation["metrics"];
  fingerprint: string;
  href: string;
  linkedAssetId?: string | null;
}): RuleBasedRecommendation {
  return {
    id: generatedId(fingerprint),
    recommendation_type: type,
    title,
    body,
    reason,
    priority,
    source: "rule_based",
    status: "open",
    confidence,
    metrics,
    fingerprint,
    created_at: `${asOf}T00:00:00.000Z`,
    updated_at: `${asOf}T00:00:00.000Z`,
    linkedAssetId,
    href,
    isGenerated: true,
  };
}

export function buildRuleBasedRecommendations(input: BuildRuleBasedRecommendationsInput): RuleBasedRecommendation[] {
  const { analytics, positions } = input;
  const recommendations: RuleBasedRecommendation[] = [];
  const asOf = analytics.asOf;
  const baseCurrency = analytics.baseCurrency;
  const totalValue = analytics.totalValue;

  const topAssetClass = topReadySlice(analytics.structureByAssetType);
  if (topAssetClass && topAssetClass.percent >= highShareThreshold) {
    recommendations.push(recommendation({
      asOf,
      type: "asset_class_concentration",
      title: `Высокая доля класса: ${topAssetClass.label}`,
      body: `Класс активов занимает ${percent(topAssetClass.percent)}% портфеля. Проверьте, соответствует ли такая концентрация целевой структуре.`,
      reason: "Доля класса активов выше базового порога концентрации.",
      priority: topAssetClass.percent >= 0.5 ? "high" : "normal",
      confidence: 0.78,
      metrics: {
        share_percent: percent(topAssetClass.percent),
        value: topAssetClass.value,
        base_currency: baseCurrency,
        threshold_percent: percent(highShareThreshold),
      },
      fingerprint: `asset_class_concentration:${topAssetClass.key}`,
      href: topAssetClass.href,
    }));
  }

  const topCurrency = topReadySlice(analytics.structureByCurrency);
  if (topCurrency && topCurrency.percent >= highShareThreshold && topCurrency.key !== baseCurrency) {
    recommendations.push(recommendation({
      asOf,
      type: "currency_concentration",
      title: `Высокая доля валюты: ${topCurrency.label}`,
      body: `Валюта занимает ${percent(topCurrency.percent)}% портфеля. Проверьте валютный риск и необходимость ребалансировки.`,
      reason: "Доля отдельной валюты выше базового порога концентрации.",
      priority: topCurrency.percent >= 0.5 ? "high" : "normal",
      confidence: 0.72,
      metrics: {
        share_percent: percent(topCurrency.percent),
        value: topCurrency.value,
        base_currency: baseCurrency,
        threshold_percent: percent(highShareThreshold),
      },
      fingerprint: `currency_concentration:${topCurrency.key}`,
      href: topCurrency.href,
    }));
  }

  const topAsset = Array.from(
    positions
      .filter((position) => position.asset_id)
      .reduce((groups, position) => {
        const assetId = position.asset_id as string;
        const existing = groups.get(assetId) ?? {
          assetId,
          assetName: position.asset_name,
          ticker: position.ticker,
          value: 0,
          accountCount: 0,
          accounts: new Set<string>(),
        };
        existing.value += positionValue(position);
        existing.accounts.add(position.account_id);
        existing.accountCount = existing.accounts.size;
        groups.set(assetId, existing);
        return groups;
      }, new Map<string, { assetId: string; assetName: string; ticker: string | null; value: number; accountCount: number; accounts: Set<string> }>())
      .values(),
  )
    .map((asset) => ({
      assetId: asset.assetId,
      assetName: asset.assetName,
      ticker: asset.ticker,
      value: asset.value,
      accountCount: asset.accountCount,
      share: totalValue > 0 ? asset.value / totalValue : 0,
    }))
    .sort((left, right) => right.share - left.share)
    .at(0);

  if (topAsset && topAsset.share >= highShareThreshold) {
    recommendations.push(recommendation({
      asOf,
      type: "single_asset_concentration",
      title: `Высокая доля актива: ${topAsset.assetName}`,
      body: `Один актив занимает ${percent(topAsset.share)}% портфеля. Проверьте, соответствует ли такая концентрация вашему риск-профилю и целевой структуре.`,
      reason: "Доля одного актива выше базового порога концентрации.",
      priority: topAsset.share >= 0.5 ? "high" : "normal",
      confidence: 0.8,
      metrics: {
        share_percent: percent(topAsset.share),
        value: topAsset.value,
        base_currency: baseCurrency,
        threshold_percent: percent(highShareThreshold),
        account_count: topAsset.accountCount,
        ticker: topAsset.ticker,
      },
      fingerprint: `single_asset_concentration:${topAsset.assetId}`,
      href: `/assets?asset_id=${topAsset.assetId}`,
      linkedAssetId: topAsset.assetId,
    }));
  }

  const positionWithMissingPrice = positions
    .filter((position) => position.market_value === null)
    .sort((left, right) => right.book_value - left.book_value)
    .at(0);
  if (positionWithMissingPrice) {
    recommendations.push(recommendation({
      asOf,
      type: "missing_market_price",
      title: `Нет рыночной цены: ${positionWithMissingPrice.asset_name}`,
      body: "Для значимой позиции используется балансовая стоимость. Обновите цену, чтобы аналитика и рекомендации стали точнее.",
      reason: "Рыночная оценка позиции отсутствует.",
      priority: positionWithMissingPrice.book_value / Math.max(totalValue, 1) > 0.15 ? "high" : "normal",
      confidence: 0.9,
      metrics: {
        book_value: positionWithMissingPrice.book_value,
        currency: positionWithMissingPrice.currency_code,
        quality_alert_code: "missing_market_price",
      },
      fingerprint: `missing_market_price:${positionWithMissingPrice.asset_id ?? positionWithMissingPrice.id}`,
      href: `/assets?asset_id=${positionWithMissingPrice.asset_id ?? ""}`,
      linkedAssetId: positionWithMissingPrice.asset_id,
    }));
  }

  const cashShare = totalValue > 0 ? analytics.cashValue / totalValue : 0;
  if (totalValue > 0 && cashShare < cashLowThreshold) {
    recommendations.push(recommendation({
      asOf,
      type: "cash_below_threshold",
      title: "Низкая доля кэша",
      body: `Кэш занимает ${percent(cashShare)}% портфеля. Проверьте, достаточно ли ликвидности для комиссий, налогов и ближайших покупок.`,
      reason: "Доля кэша ниже базового порога.",
      priority: "normal",
      confidence: 0.7,
      metrics: {
        cash_share_percent: percent(cashShare),
        threshold_percent: percent(cashLowThreshold),
        cash_value: analytics.cashValue,
        base_currency: baseCurrency,
      },
      fingerprint: "cash_below_threshold",
      href: "/dashboard",
    }));
  }

  if (totalValue > 0 && cashShare > cashHighThreshold) {
    recommendations.push(recommendation({
      asOf,
      type: "cash_above_threshold",
      title: "Высокая доля кэша",
      body: `Кэш занимает ${percent(cashShare)}% портфеля. Если это не временная парковка средств, стоит проверить план размещения.`,
      reason: "Доля кэша выше базового порога.",
      priority: "normal",
      confidence: 0.68,
      metrics: {
        cash_share_percent: percent(cashShare),
        threshold_percent: percent(cashHighThreshold),
        cash_value: analytics.cashValue,
        base_currency: baseCurrency,
      },
      fingerprint: "cash_above_threshold",
      href: "/dashboard",
    }));
  }

  if (analytics.xirr.status !== "ready" && totalValue > 0) {
    recommendations.push(recommendation({
      asOf,
      type: "xirr_unavailable",
      title: "Доходность XIRR пока не считается",
      body: "Проверьте внешние пополнения, выводы и текущую оценку портфеля. Без них доходность может быть неполной.",
      reason: analytics.xirrDetail.reason ?? "Недостаточно данных для устойчивого расчета XIRR.",
      priority: "normal",
      confidence: 0.82,
      metrics: {
        xirr_status: analytics.xirr.status,
        terminal_value: analytics.xirrDetail.terminalValue,
        skipped_non_base_currency_count: analytics.xirrDetail.skippedNonBaseCurrencyCount,
        quality_alert_code: "xirr_unavailable",
      },
      fingerprint: `xirr_unavailable:${analytics.xirr.status}`,
      href: "/dashboard",
    }));
  }

  const currentPeriod = analytics.cashFlowPeriods.find((period) => period.period === "1M");
  if (currentPeriod && totalValue > 0 && Math.abs(currentPeriod.net) / totalValue >= 0.1) {
    recommendations.push(recommendation({
      asOf,
      type: "large_external_flow",
      title: "Крупный внешний денежный поток",
      body: `Net flow за месяц составляет ${percent(Math.abs(currentPeriod.net) / totalValue)}% от текущей стоимости портфеля. Проверьте, не изменилась ли целевая структура.`,
      reason: "Внешний поток за период значим относительно размера портфеля.",
      priority: "normal",
      confidence: 0.66,
      metrics: {
        period: currentPeriod.period,
        net_flow: currentPeriod.net,
        total_value: totalValue,
        net_flow_share_percent: percent(Math.abs(currentPeriod.net) / totalValue),
      },
      fingerprint: `large_external_flow:${currentPeriod.period}`,
      href: `/dashboard?dashboard_period=${currentPeriod.period}`,
    }));
  }

  const heldAssetIds = new Set(positions.filter((position) => position.asset_id && (position.market_value ?? position.book_value) > 0).map((position) => position.asset_id as string));
  const nearestEvent = (input.events ?? [])
    .filter((event) => event.asset_id && heldAssetIds.has(event.asset_id))
    .filter((event) => event.status !== "cancelled" && event.status !== "done")
    .map((event) => ({ event, daysUntil: daysBetween(asOf, event.event_date) }))
    .filter(({ daysUntil }) => daysUntil >= 0 && daysUntil <= upcomingEventHorizonDays)
    .sort((left, right) => left.daysUntil - right.daysUntil || left.event.title.localeCompare(right.event.title, "ru"))
    .at(0);

  if (nearestEvent?.event.asset_id) {
    recommendations.push(recommendation({
      asOf,
      type: "upcoming_position_event",
      title: `Ближайшее событие: ${nearestEvent.event.title}`,
      body: `По активу в портфеле есть событие через ${nearestEvent.daysUntil} дн. Проверьте дату, сумму и ожидания по денежному потоку.`,
      reason: "Для удерживаемого актива есть ближайшее событие.",
      priority: nearestEvent.daysUntil <= 7 ? "high" : "normal",
      confidence: 0.74,
      metrics: {
        event_type: nearestEvent.event.event_type,
        event_date: nearestEvent.event.event_date,
        days_until: nearestEvent.daysUntil,
        amount: nearestEvent.event.amount ?? null,
        currency: nearestEvent.event.currency_code ?? null,
      },
      fingerprint: `upcoming_position_event:${nearestEvent.event.id}`,
      href: `/events?event_type_filter=${nearestEvent.event.event_type}`,
      linkedAssetId: nearestEvent.event.asset_id,
    }));
  }

  return recommendations.sort((left, right) => {
    const priorityRank: Record<RuleBasedRecommendationPriority, number> = {
      critical: 4,
      high: 3,
      normal: 2,
      low: 1,
    };
    return priorityRank[right.priority] - priorityRank[left.priority] || right.confidence - left.confidence;
  });
}

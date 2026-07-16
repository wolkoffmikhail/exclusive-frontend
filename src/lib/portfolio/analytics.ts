import type { CalculatedCashBalance, CalculatedPosition, CalculationOperation } from "./calculations";
import { toNumber } from "./calculations";

export type PeriodKey = "1M" | "3M" | "YTD" | "1Y" | "All";

export type AnalyticsOperation = CalculationOperation & {
  operation_group_id?: string | null;
};

export type XirrStatus =
  | "ready"
  | "insufficient_cash_flows"
  | "missing_valuation"
  | "no_sign_change"
  | "not_converged";

export type XirrResult = {
  status: XirrStatus;
  value: number | null;
  iterations: number;
};

export type XirrCashFlowLine = {
  date: string;
  amount: number;
  currencyCode: string;
  kind: "external_inflow" | "external_outflow" | "terminal_value";
  operationId?: string;
  operationType?: string;
  accountId?: string;
  source?: string | null;
};

export type XirrDetail = {
  result: XirrResult;
  asOf: string;
  terminalValue: number;
  cashFlows: XirrCashFlowLine[];
  externalInflowTotal: number;
  externalOutflowTotal: number;
  skippedNonBaseCurrencyCount: number;
  reason: string | null;
};

export type CashFlow = {
  date: string;
  amount: number;
  currencyCode: string;
  operationId?: string;
  operationType?: string;
};

export type DashboardCashFlow = {
  operationId: string;
  date: string;
  operationType: string;
  accountId: string;
  source: string | null;
  amount: number;
  currencyCode: string;
  direction: "inflow" | "outflow";
};

export type CashFlowBucket = {
  key: string;
  label: string;
  inflows: number;
  outflows: number;
  net: number;
};

export type PeriodCashFlowSummary = {
  period: PeriodKey;
  from: string | null;
  to: string;
  inflows: number;
  outflows: number;
  net: number;
  flows: DashboardCashFlow[];
  buckets: CashFlowBucket[];
};

export type StructureSlice = {
  key: string;
  label: string;
  value: number;
  percent: number;
  count: number;
  href: string;
  status: "ready" | "partial";
};

export type AnalyticsAlert = {
  code: "missing_market_price" | "missing_fx_rate" | "xirr_unavailable" | "empty_portfolio";
  message: string;
  href?: string;
};

export type PortfolioAnalytics = {
  baseCurrency: string;
  asOf: string;
  totalValue: number;
  investedValue: number;
  cashValue: number;
  unrealizedPnl: number;
  positionCount: number;
  xirr: XirrResult;
  xirrDetail: XirrDetail;
  cashFlowPeriods: PeriodCashFlowSummary[];
  structureByAssetType: StructureSlice[];
  structureByCurrency: StructureSlice[];
  structureByAccount: StructureSlice[];
  alerts: AnalyticsAlert[];
};

type BuildPortfolioAnalyticsInput = {
  operations: AnalyticsOperation[];
  positions: CalculatedPosition[];
  cashBalances: CalculatedCashBalance[];
  baseCurrency: string;
  asOf?: string;
};

const periods: PeriodKey[] = ["1M", "3M", "YTD", "1Y", "All"];

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function parseIsoDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addMonths(value: Date, months: number) {
  const next = new Date(value);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function periodStart(period: PeriodKey, asOf: string) {
  const date = parseIsoDate(asOf);
  if (!date || period === "All") return null;

  if (period === "1M") return isoDate(addMonths(date, -1));
  if (period === "3M") return isoDate(addMonths(date, -3));
  if (period === "1Y") return isoDate(addMonths(date, -12));
  return `${date.getUTCFullYear()}-01-01`;
}

function latestDate(values: string[], fallback: string) {
  const dates = values.filter(Boolean).sort();
  return dates.at(-1) ?? fallback;
}

function isExternalInflow(operation: AnalyticsOperation) {
  return operation.operation_type_code === "deposit";
}

function isExternalOutflow(operation: AnalyticsOperation) {
  return operation.operation_type_code === "withdrawal";
}

function inPeriod(date: string, from: string | null, to: string) {
  return date <= to && (!from || date >= from);
}

function monthKey(date: string) {
  return date.slice(0, 7);
}

function monthLabel(key: string) {
  const [year, month] = key.split("-");
  return `${month}.${year.slice(2)}`;
}

function amountInBaseCurrency(amount: number, currencyCode: string, baseCurrency: string) {
  return currencyCode === baseCurrency ? amount : null;
}

function positionValue(position: CalculatedPosition) {
  return position.market_value ?? position.book_value;
}

function roundTiny(value: number) {
  return Math.abs(value) < 0.0000001 ? 0 : value;
}

export function calculateXirr(cashFlows: CashFlow[], options: { maxIterations?: number; tolerance?: number } = {}): XirrResult {
  const maxIterations = options.maxIterations ?? 100;
  const tolerance = options.tolerance ?? 0.0000001;
  const normalized = cashFlows
    .map((flow) => ({
      ...flow,
      amount: toNumber(flow.amount),
      date: parseIsoDate(flow.date),
    }))
    .filter((flow): flow is Omit<typeof flow, "date"> & { date: Date } => flow.date !== null && Number.isFinite(flow.amount) && flow.amount !== 0)
    .sort((left, right) => left.date.getTime() - right.date.getTime());

  if (normalized.length < 2) return { status: "insufficient_cash_flows", value: null, iterations: 0 };
  if (!normalized.some((flow) => flow.amount < 0) || !normalized.some((flow) => flow.amount > 0)) {
    return { status: "no_sign_change", value: null, iterations: 0 };
  }

  const firstDate = normalized[0].date.getTime();
  const years = normalized.map((flow) => (flow.date.getTime() - firstDate) / (1000 * 60 * 60 * 24 * 365));

  const npv = (rate: number) => {
    if (rate <= -0.999999999) return Number.POSITIVE_INFINITY;
    return normalized.reduce((total, flow, index) => total + flow.amount / Math.pow(1 + rate, years[index]), 0);
  };

  const derivative = (rate: number) => {
    if (rate <= -0.999999999) return Number.NEGATIVE_INFINITY;
    return normalized.reduce((total, flow, index) => {
      const year = years[index];
      if (year === 0) return total;
      return total - (year * flow.amount) / Math.pow(1 + rate, year + 1);
    }, 0);
  };

  const guesses = [0.1, 0, -0.1, 0.25, -0.25, 0.5, -0.5];
  for (const guess of guesses) {
    let rate = guess;
    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
      const value = npv(rate);
      if (Math.abs(value) < tolerance) return { status: "ready", value: roundTiny(rate), iterations: iteration };

      const slope = derivative(rate);
      if (!Number.isFinite(slope) || Math.abs(slope) < tolerance) break;

      const nextRate = rate - value / slope;
      if (!Number.isFinite(nextRate) || nextRate <= -0.999999999 || nextRate > 1000) break;
      rate = nextRate;
    }
  }

  let low = -0.9999;
  let high = 10;
  let lowValue = npv(low);
  let highValue = npv(high);

  while (Math.sign(lowValue) === Math.sign(highValue) && high < 1000) {
    high *= 2;
    highValue = npv(high);
  }

  if (Math.sign(lowValue) === Math.sign(highValue)) return { status: "not_converged", value: null, iterations: maxIterations };

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const mid = (low + high) / 2;
    const midValue = npv(mid);

    if (Math.abs(midValue) < tolerance || Math.abs(high - low) < tolerance) {
      return { status: "ready", value: roundTiny(mid), iterations: iteration };
    }

    if (Math.sign(midValue) === Math.sign(lowValue)) {
      low = mid;
      lowValue = midValue;
    } else {
      high = mid;
    }
  }

  return { status: "not_converged", value: null, iterations: maxIterations };
}

export function getDashboardCashFlows(operations: AnalyticsOperation[], baseCurrency: string): DashboardCashFlow[] {
  return operations
    .filter((operation) => !operation.cancelled_at)
    .reduce<DashboardCashFlow[]>((flows, operation) => {
      const amount = amountInBaseCurrency(Math.abs(toNumber(operation.net_amount)), operation.currency_code, baseCurrency);
      if (amount === null || amount === 0) return flows;

      if (isExternalInflow(operation)) {
        flows.push({
          operationId: operation.id,
          date: operation.trade_date,
          operationType: operation.operation_type_code,
          accountId: operation.account_id,
          source: operation.source ?? null,
          amount,
          currencyCode: operation.currency_code,
          direction: "inflow",
        });
      }

      if (isExternalOutflow(operation)) {
        flows.push({
          operationId: operation.id,
          date: operation.trade_date,
          operationType: operation.operation_type_code,
          accountId: operation.account_id,
          source: operation.source ?? null,
          amount,
          currencyCode: operation.currency_code,
          direction: "outflow",
        });
      }

      return flows;
    }, [])
    .sort((left, right) => right.date.localeCompare(left.date));
}

export function buildCashFlowPeriods(flows: DashboardCashFlow[], asOf: string): PeriodCashFlowSummary[] {
  return periods.map((period) => {
    const from = periodStart(period, asOf);
    const periodFlows = flows.filter((flow) => inPeriod(flow.date, from, asOf));
    const inflows = periodFlows.filter((flow) => flow.direction === "inflow").reduce((total, flow) => total + flow.amount, 0);
    const outflows = periodFlows.filter((flow) => flow.direction === "outflow").reduce((total, flow) => total + flow.amount, 0);

    return {
      period,
      from,
      to: asOf,
      inflows,
      outflows,
      net: inflows - outflows,
      flows: periodFlows,
      buckets: buildCashFlowBuckets(periodFlows),
    };
  });
}

export function buildCashFlowBuckets(flows: DashboardCashFlow[]): CashFlowBucket[] {
  const grouped = new Map<string, CashFlowBucket>();

  for (const flow of flows) {
    const key = monthKey(flow.date);
    const existing = grouped.get(key) ?? {
      key,
      label: monthLabel(key),
      inflows: 0,
      outflows: 0,
      net: 0,
    };

    if (flow.direction === "inflow") {
      existing.inflows += flow.amount;
    } else {
      existing.outflows += flow.amount;
    }

    existing.net = existing.inflows - existing.outflows;
    grouped.set(key, existing);
  }

  return Array.from(grouped.values()).sort((left, right) => left.key.localeCompare(right.key));
}

export function buildPortfolioXirr(operations: AnalyticsOperation[], totalValue: number, baseCurrency: string, asOf: string): XirrResult {
  return buildPortfolioXirrDetail(operations, totalValue, baseCurrency, asOf).result;
}

function xirrReason(status: XirrStatus) {
  const reasons: Record<XirrStatus, string | null> = {
    ready: null,
    insufficient_cash_flows: "Недостаточно внешних денежных потоков для расчёта.",
    missing_valuation: "Нет положительной текущей оценки портфеля.",
    no_sign_change: "Для расчёта нужны потоки с разными знаками: вложение и возврат стоимости.",
    not_converged: "Численный метод не смог устойчиво найти ставку.",
  };
  return reasons[status];
}

export function buildPortfolioXirrDetail(operations: AnalyticsOperation[], totalValue: number, baseCurrency: string, asOf: string): XirrDetail {
  let skippedNonBaseCurrencyCount = 0;
  const cashFlows = operations
    .filter((operation) => !operation.cancelled_at)
    .reduce<XirrCashFlowLine[]>((flows, operation) => {
      if (!isExternalInflow(operation) && !isExternalOutflow(operation)) return flows;

      const amount = amountInBaseCurrency(Math.abs(toNumber(operation.net_amount)), operation.currency_code, baseCurrency);
      if (amount === null) {
        skippedNonBaseCurrencyCount += 1;
        return flows;
      }
      if (amount === 0) return flows;

      flows.push({
        date: operation.trade_date,
        amount: isExternalInflow(operation) ? -amount : amount,
        currencyCode: baseCurrency,
        kind: isExternalInflow(operation) ? "external_inflow" : "external_outflow",
        operationId: operation.id,
        operationType: operation.operation_type_code,
        accountId: operation.account_id,
        source: operation.source ?? null,
      });

      return flows;
    }, []);

  const terminalFlow: XirrCashFlowLine = {
    date: asOf,
    amount: totalValue,
    currencyCode: baseCurrency,
    kind: "terminal_value",
  };
  const result = totalValue <= 0
    ? { status: "missing_valuation" as const, value: null, iterations: 0 }
    : calculateXirr([...cashFlows, terminalFlow]);

  return {
    result,
    asOf,
    terminalValue: totalValue,
    cashFlows: [...cashFlows, terminalFlow].sort((left, right) => right.date.localeCompare(left.date)),
    externalInflowTotal: cashFlows.filter((flow) => flow.kind === "external_inflow").reduce((total, flow) => total + Math.abs(flow.amount), 0),
    externalOutflowTotal: cashFlows.filter((flow) => flow.kind === "external_outflow").reduce((total, flow) => total + flow.amount, 0),
    skippedNonBaseCurrencyCount,
    reason: xirrReason(result.status),
  };
}

function buildStructure(
  positions: CalculatedPosition[],
  baseCurrency: string,
  getKey: (position: CalculatedPosition) => string,
  getLabel: (position: CalculatedPosition) => string,
  getHref: (key: string) => string,
): StructureSlice[] {
  const grouped = new Map<string, { label: string; value: number; count: number; partial: boolean }>();

  for (const position of positions) {
    const key = getKey(position);
    const value = amountInBaseCurrency(positionValue(position), position.currency_code, baseCurrency);
    const existing = grouped.get(key) ?? { label: getLabel(position), value: 0, count: 0, partial: false };

    existing.count += 1;
    if (value === null) {
      existing.partial = true;
    } else {
      existing.value += value;
    }

    grouped.set(key, existing);
  }

  const total = Array.from(grouped.values()).reduce<number>((sum, item) => sum + item.value, 0);
  return Array.from(grouped.entries())
    .map(([key, item]) => ({
      key,
      label: item.label,
      value: item.value,
      percent: total > 0 ? item.value / total : 0,
      count: item.count,
      href: getHref(key),
      status: item.partial ? "partial" as const : "ready" as const,
    }))
    .sort((left, right) => right.value - left.value);
}

function buildAssetTypeStructure(positions: CalculatedPosition[], cashBalances: CalculatedCashBalance[], baseCurrency: string) {
  const positionSlices = buildStructure(
    positions,
    baseCurrency,
    (position) => position.asset_type_code ?? "unknown",
    (position) => position.asset_type_code ?? "Без класса",
    (key) => `/assets?position_asset_type=${encodeURIComponent(key)}`,
  );
  const cashValue = cashBalances.reduce<number>((total, balance) => {
    const value = amountInBaseCurrency(balance.balance, balance.currency_code, baseCurrency);
    return total + (value ?? 0);
  }, 0);
  const hasPartialCash = cashBalances.some((balance) => balance.currency_code !== baseCurrency);
  const cashRows = cashBalances.length;

  if (cashRows === 0) return positionSlices;

  const merged = [
    ...positionSlices,
    {
      key: "cash",
      label: "cash",
      value: cashValue,
      percent: 0,
      count: cashRows,
      href: "/accounts",
      status: hasPartialCash ? "partial" as const : "ready" as const,
    },
  ];
  const total = merged.reduce((sum, slice) => sum + slice.value, 0);

  return merged
    .map((slice) => ({
      ...slice,
      percent: total > 0 ? slice.value / total : 0,
    }))
    .sort((left, right) => right.value - left.value);
}

function buildCurrencyStructure(positions: CalculatedPosition[], cashBalances: CalculatedCashBalance[], baseCurrency: string) {
  const grouped = new Map<string, { value: number; count: number; partial: boolean }>();

  for (const position of positions) {
    const existing = grouped.get(position.currency_code) ?? { value: 0, count: 0, partial: false };
    const value = amountInBaseCurrency(positionValue(position), position.currency_code, baseCurrency);
    existing.count += 1;
    if (value === null) existing.partial = true;
    else existing.value += value;
    grouped.set(position.currency_code, existing);
  }

  for (const balance of cashBalances) {
    const existing = grouped.get(balance.currency_code) ?? { value: 0, count: 0, partial: false };
    const value = amountInBaseCurrency(balance.balance, balance.currency_code, baseCurrency);
    existing.count += 1;
    if (value === null) existing.partial = true;
    else existing.value += value;
    grouped.set(balance.currency_code, existing);
  }

  const total = Array.from(grouped.values()).reduce((sum, slice) => sum + slice.value, 0);
  return Array.from(grouped.entries())
    .map(([key, slice]) => ({
      key,
      label: key,
      value: slice.value,
      percent: total > 0 ? slice.value / total : 0,
      count: slice.count,
      href: `/assets?position_currency=${encodeURIComponent(key)}`,
      status: slice.partial ? "partial" as const : "ready" as const,
    }))
    .sort((left, right) => right.value - left.value);
}

function buildAccountStructure(positions: CalculatedPosition[], cashBalances: CalculatedCashBalance[], baseCurrency: string) {
  const grouped = new Map<string, { label: string; value: number; count: number; partial: boolean }>();

  for (const position of positions) {
    const existing = grouped.get(position.account_id) ?? { label: position.account_name, value: 0, count: 0, partial: false };
    const value = amountInBaseCurrency(positionValue(position), position.currency_code, baseCurrency);
    existing.count += 1;
    if (value === null) existing.partial = true;
    else existing.value += value;
    grouped.set(position.account_id, existing);
  }

  for (const balance of cashBalances) {
    const existing = grouped.get(balance.account_id) ?? { label: balance.account_name, value: 0, count: 0, partial: false };
    const value = amountInBaseCurrency(balance.balance, balance.currency_code, baseCurrency);
    existing.count += 1;
    if (value === null) existing.partial = true;
    else existing.value += value;
    grouped.set(balance.account_id, existing);
  }

  const total = Array.from(grouped.values()).reduce((sum, slice) => sum + slice.value, 0);
  return Array.from(grouped.entries())
    .map(([key, slice]) => ({
      key,
      label: slice.label,
      value: slice.value,
      percent: total > 0 ? slice.value / total : 0,
      count: slice.count,
      href: `/accounts?account_id=${encodeURIComponent(key)}`,
      status: slice.partial ? "partial" as const : "ready" as const,
    }))
    .sort((left, right) => right.value - left.value);
}

export function buildPortfolioAnalytics(input: BuildPortfolioAnalyticsInput): PortfolioAnalytics {
  const baseCurrency = input.baseCurrency || "RUB";
  const asOf = input.asOf ?? latestDate(
    [
      ...input.operations.map((operation) => operation.trade_date),
      ...input.positions.flatMap((position) => position.valuation_date ? [position.valuation_date] : []),
      ...input.cashBalances.flatMap((balance) => balance.snapshot_date ? [balance.snapshot_date] : []),
    ],
    isoDate(new Date()),
  );

  const positionValues = input.positions.map((position) => amountInBaseCurrency(positionValue(position), position.currency_code, baseCurrency));
  const cashValues = input.cashBalances.map((balance) => amountInBaseCurrency(balance.balance, balance.currency_code, baseCurrency));
  const totalValue = [...positionValues, ...cashValues].reduce<number>((total, value) => total + (value ?? 0), 0);
  const investedValue = positionValues.reduce<number>((total, value) => total + (value ?? 0), 0);
  const cashValue = cashValues.reduce<number>((total, value) => total + (value ?? 0), 0);
  const unrealizedPnl = input.positions.reduce<number>((total, position) => {
    const value = amountInBaseCurrency(position.unrealized_pnl ?? 0, position.currency_code, baseCurrency);
    return total + (value ?? 0);
  }, 0);
  const flows = getDashboardCashFlows(input.operations, baseCurrency);
  const alerts: AnalyticsAlert[] = [];

  if (input.positions.length === 0 && input.cashBalances.length === 0) {
    alerts.push({ code: "empty_portfolio", message: "Портфель пока пуст: добавьте счёт, импорт или ручную операцию." });
  }

  if (input.positions.some((position) => position.market_value === null)) {
    alerts.push({ code: "missing_market_price", message: "Для части позиций нет рыночной цены, используется балансовая стоимость.", href: "/assets?position_problematic=1" });
  }

  if (
    input.positions.some((position) => position.currency_code !== baseCurrency)
    || input.cashBalances.some((balance) => balance.currency_code !== baseCurrency)
    || input.operations.some((operation) => operation.currency_code !== baseCurrency)
  ) {
    alerts.push({ code: "missing_fx_rate", message: `Часть данных не пересчитана в ${baseCurrency}: нет отдельной FX-модели для аналитики.`, href: "/settings" });
  }

  const xirrDetail = buildPortfolioXirrDetail(input.operations, totalValue, baseCurrency, asOf);
  const { result: xirr } = xirrDetail;
  if (xirr.status !== "ready") {
    alerts.push({ code: "xirr_unavailable", message: "XIRR пока недоступен: недостаточно внешних потоков или текущей оценки." });
  }

  return {
    baseCurrency,
    asOf,
    totalValue,
    investedValue,
    cashValue,
    unrealizedPnl,
    positionCount: input.positions.length,
    xirr,
    xirrDetail,
    cashFlowPeriods: buildCashFlowPeriods(flows, asOf),
    structureByAssetType: buildAssetTypeStructure(input.positions, input.cashBalances, baseCurrency),
    structureByCurrency: buildCurrencyStructure(input.positions, input.cashBalances, baseCurrency),
    structureByAccount: buildAccountStructure(input.positions, input.cashBalances, baseCurrency),
    alerts,
  };
}

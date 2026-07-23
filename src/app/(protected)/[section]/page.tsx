import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { PeriodKey, StructureSlice } from "@/lib/portfolio/analytics";
import { getActiveFamily, getPortfolioData, type Account, type ImportJob, type Operation, type PortfolioData, type Position } from "@/lib/portfolio/data";
import { filterPortfolioEvents, splitPortfolioEvents, type EventFilterInput } from "@/lib/portfolio/events";
import { filterAndSortPositions, groupPositionsByAssetType, type PositionFilterInput } from "@/lib/portfolio/position-filters";
import { canEditFamilyData, canManageFamily } from "@/lib/portfolio/permissions";
import { runWhatIfScenario, type ScenarioMetricDelta, type WhatIfScenarioResult } from "@/lib/portfolio/scenarios";
import { filterWatchlistItems, type WatchlistFilterInput } from "@/lib/portfolio/watchlist";
import { createClient } from "@/lib/supabase/server";
import { applyBrokerImport, deleteFailedImport, parseBrokerImport, restoreImportRow, skipImportRow, uploadBrokerReport } from "./import-actions";
import { cancelManualOperation, createBuyOperation, createCashTransferOperation, createDepositOperation, createFxOperation, createSellOperation, createWithdrawalOperation } from "./manual-operation-actions";
import { saveManualPositionPrice } from "./position-actions";
import { createAccount, createPortfolio } from "./settings-actions";
import { addAssetToWatchlist, addNewsToWatchlist, archiveLimit, archiveWatchlistItem, checkLimits, createDefaultLimits, createLimit, createNewsItem, createPortfolioEvent, markRecommendationRead, saveMaxSettings, saveRecommendationToWatchlist, saveTelegramSettings, testMaxNotification, testTelegramNotification, updateLimit, updatePortfolioEvent, updateRecommendationStatus, updateWatchlistItem } from "./stage5-actions";

const sections: Record<string, { title: string; description: string }> = {
  dashboard: { title: "Обзор портфеля", description: "Структура семейного портфеля, счета, активы и ближайшие действия." },
  accounts: { title: "Счета", description: "Брокерские, банковские и другие счета семьи." },
  assets: { title: "Активы", description: "Справочник активов, который будет использоваться в операциях и отчётах." },
  import: { title: "Импорт", description: "Загрузка брокерских отчётов и журнал обработки файлов." },
  recommendations: { title: "Рекомендации", description: "Сигналы и предложения по управлению портфелем." },
  "what-if": { title: "What-if", description: "Проверка покупки или продажи одного актива без изменения учётных данных." },
  news: { title: "Новости", description: "Новости, связанные с активами портфеля." },
  watchlist: { title: "Watchlist", description: "Активы и идеи для наблюдения." },
  events: { title: "События", description: "Дивиденды, купоны, погашения и другие события." },
  settings: { title: "Настройки", description: "Семья, пользователи, роли, валюты и правила импорта." },
};

export const dynamic = "force-dynamic";

type RecommendationFilterInput = {
  status?: string;
  priority?: string;
  assetId?: string;
  sort?: string;
};

type NewsFilterInput = {
  view?: string;
};

type WhatIfFormInput = {
  scenarioType?: string;
  accountId?: string;
  assetId?: string;
  tradeDate?: string;
  quantity?: string;
  price?: string;
  currencyCode?: string;
  commission?: string;
  sourceRecommendationId?: string;
};

export function generateStaticParams() {
  return Object.keys(sections).map((section) => ({ section }));
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    active: "активен",
    archived: "архив",
    closed: "закрыт",
    uploaded: "загружен",
    parsing: "разбирается",
    parsed: "распознан",
    applying: "применяется",
    normalized: "нормализован",
    failed: "ошибка",
    applied: "применён",
    cancelled: "отменён",
  };
  return labels[status] ?? status;
}

function importStatusLabel(importJob: ImportJob, rows: PortfolioData["importRows"]) {
  if (importJob.status === "failed" && rows.length > 0) return "нужна сверка";
  return statusLabel(importJob.status);
}

function accountTypeLabel(type: string) {
  const labels: Record<string, string> = {
    brokerage: "Брокерский",
    iis: "ИИС",
    bank: "Банковский",
    cash: "Наличные",
    crypto: "Крипто",
    other: "Другой",
  };
  return labels[type] ?? type;
}

function assetTypeLabel(type: string) {
  const labels: Record<string, string> = {
    cash: "Деньги",
    stock: "Акция",
    bond: "Облигация",
    fund: "Фонд",
    etf: "ETF",
    crypto: "Крипто",
    derivative: "Дериватив",
    real_estate: "Недвижимость",
    other: "Другое",
  };
  return labels[type] ?? type;
}

function formatFileSize(size: number | null) {
  if (!size) return "—";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function queryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseQueryNumber(value: string | undefined) {
  if (!value) return null;
  const parsed = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value: number | string | null | undefined, digits = 2) {
  const number = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(number)) return "—";
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: digits,
    minimumFractionDigits: number % 1 === 0 ? 0 : Math.min(2, digits),
  }).format(number);
}

function formatMoney(value: number | string | null | undefined, currency = "RUB") {
  const number = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(number)) return "—";
  return `${formatNumber(number, 2)} ${currency}`;
}

function formatSignedMoney(value: number | string | null | undefined, currency = "RUB") {
  const number = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(number)) return "—";
  const sign = number > 0 ? "+" : "";
  return `${sign}${formatMoney(number, currency)}`;
}

function formatPercent(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value * 100, 2)}%`;
}

function formatScenarioMetricValue(metric: ScenarioMetricDelta, value: number | null) {
  if (value === null) return "—";
  if (metric.format === "money") return formatMoney(value, metric.currencyCode ?? "RUB");
  if (metric.format === "percent") return formatPercent(value);
  return formatNumber(value, 6);
}

function formatScenarioMetricDelta(metric: ScenarioMetricDelta) {
  if (metric.delta === null) return "—";
  if (metric.format === "money") return formatSignedMoney(metric.delta, metric.currencyCode ?? "RUB");
  if (metric.format === "percent") return formatPercent(metric.delta);
  const sign = metric.delta > 0 ? "+" : "";
  return `${sign}${formatNumber(metric.delta, 6)}`;
}

function whatIfInputHasSubmission(input: WhatIfFormInput) {
  return Boolean(input.quantity || input.price || input.assetId || input.accountId || input.sourceRecommendationId);
}

function whatIfExportHref(input: WhatIfFormInput, format: "excel" | "pdf-html") {
  const params = new URLSearchParams();
  params.set("format", format);
  params.set("include_scenario", "1");
  params.set("period", "1M");
  if (input.scenarioType) params.set("scenario_type", input.scenarioType);
  if (input.accountId) params.set("account_id", input.accountId);
  if (input.assetId) params.set("asset_id", input.assetId);
  if (input.tradeDate) params.set("trade_date", input.tradeDate);
  if (input.quantity) params.set("quantity", input.quantity);
  if (input.price) params.set("price", input.price);
  if (input.currencyCode) params.set("currency_code", input.currencyCode);
  if (input.commission) params.set("commission", input.commission);
  if (input.sourceRecommendationId) params.set("source_recommendation_id", input.sourceRecommendationId);
  return `/api/portfolio/export?${params.toString()}`;
}

function deltaTone(value: number | null) {
  if (value === null || value === 0) return "text-muted";
  return value > 0 ? "text-emerald-700" : "text-red-700";
}

function periodLabel(period: string) {
  const labels: Record<string, string> = {
    "1M": "1 месяц",
    "3M": "3 месяца",
    YTD: "YTD",
    "1Y": "1 год",
    All: "Всё время",
  };
  return labels[period] ?? period;
}

function normalizeDashboardPeriod(value: string | undefined): PeriodKey {
  if (value === "3M" || value === "YTD" || value === "1Y" || value === "All") return value;
  return "1M";
}

function sourceLabel(source: string | null | undefined) {
  if (source === "manual") return "ручной ввод";
  if (source === "import") return "импорт";
  return source ?? "—";
}

function xirrStatusLabel(status: string) {
  const labels: Record<string, string> = {
    ready: "Расчёт готов",
    insufficient_cash_flows: "Недостаточно потоков",
    missing_valuation: "Нет оценки",
    no_sign_change: "Нет смены знака",
    not_converged: "Нет сходимости",
  };
  return labels[status] ?? status;
}

function xirrFlowKindLabel(kind: string) {
  const labels: Record<string, string> = {
    external_inflow: "Внесение",
    external_outflow: "Вывод",
    terminal_value: "Текущая оценка",
  };
  return labels[kind] ?? kind;
}

function recommendationPriorityLabel(priority: string) {
  const labels: Record<string, string> = {
    low: "низкий",
    normal: "обычный",
    high: "важный",
    critical: "критичный",
  };
  return labels[priority] ?? priority;
}

function recommendationStatusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "черновик",
    open: "активна",
    accepted: "принята",
    rejected: "отклонена",
    archived: "архив",
  };
  return labels[status] ?? status;
}

function recommendationTypeLabel(type: string) {
  const labels: Record<string, string> = {
    asset_class_concentration: "концентрация класса",
    single_asset_concentration: "концентрация актива",
    currency_concentration: "валютный риск",
    missing_market_price: "качество данных",
    cash_below_threshold: "низкий кэш",
    cash_above_threshold: "высокий кэш",
    xirr_unavailable: "доходность",
    large_external_flow: "денежный поток",
    upcoming_position_event: "ближайшее событие",
    manual: "ручная рекомендация",
  };
  return labels[type] ?? type;
}

function recommendationMetricLabel(recommendation: PortfolioData["recommendations"][number]) {
  const metrics = recommendation.metrics;
  const currency = typeof metrics.base_currency === "string" ? metrics.base_currency : typeof metrics.currency === "string" ? metrics.currency : "RUB";

  if (typeof metrics.quality_alert_code === "string") return `Качество данных: ${metrics.quality_alert_code.replaceAll("_", " ")}`;
  if (typeof metrics.share_percent === "number") return `Доля: ${formatNumber(metrics.share_percent)}%`;
  if (typeof metrics.cash_share_percent === "number") return `Кэш: ${formatNumber(metrics.cash_share_percent)}%`;
  if (typeof metrics.net_flow_share_percent === "number") return `Net flow: ${formatNumber(metrics.net_flow_share_percent)}%`;
  if (typeof metrics.days_until === "number") return `До события: ${formatNumber(metrics.days_until, 0)} дн.`;
  if (typeof metrics.book_value === "number") return `Баланс: ${formatMoney(metrics.book_value, currency)}`;
  if (typeof metrics.value === "number") return `Оценка: ${formatMoney(metrics.value, currency)}`;
  if (typeof metrics.xirr_status === "string") return `XIRR: ${xirrStatusLabel(metrics.xirr_status)}`;

  return null;
}

function recommendationAssetId(recommendation: PortfolioData["recommendations"][number]) {
  if (recommendation.linkedAssetId) return recommendation.linkedAssetId;
  const query = recommendation.href?.split("?")[1];
  if (!query) return null;
  return new URLSearchParams(query).get("asset_id");
}

function recommendationWhatIfHref(recommendation: PortfolioData["recommendations"][number], data: PortfolioData) {
  const assetId = recommendationAssetId(recommendation);
  if (!assetId) return null;

  const position = data.positions.find((item) => item.asset_id === assetId);
  const account = position ? data.accounts.find((item) => item.id === position.account_id) : data.accounts.find((item) => item.status === "active") ?? data.accounts[0];
  if (!account) return null;

  const asset = data.assets.find((item) => item.id === assetId);
  const params = new URLSearchParams();
  params.set("asset_id", assetId);
  params.set("account_id", account.id);
  params.set("source_recommendation_id", recommendation.id);
  params.set("currency_code", position?.currency_code ?? asset?.currency_code ?? account.currency_code ?? data.family?.baseCurrency ?? "RUB");
  const price = position?.market_price ?? position?.average_price;
  if (price !== null && price !== undefined) params.set("price", String(price));
  return `/what-if?${params.toString()}`;
}

function newsKindLabel(kind: string) {
  const labels: Record<string, string> = {
    portfolio_news: "по портфелю",
    market_news: "рынок",
    idea: "идея",
  };
  return labels[kind] ?? kind;
}

function watchlistStatusLabel(status: string) {
  const labels: Record<string, string> = {
    watching: "наблюдаем",
    considering: "изучаем",
    done: "разобрано",
    archived: "архив",
  };
  return labels[status] ?? status;
}

function eventTypeLabel(type: string) {
  const labels: Record<string, string> = {
    dividend: "дивиденд",
    coupon: "купон",
    redemption: "погашение",
  };
  return labels[type] ?? type;
}

function limitTypeLabel(type: string) {
  const labels: Record<string, string> = {
    asset_share: "Доля актива",
    asset_class_share: "Доля класса",
    currency_share: "Доля валюты",
    cash_min_share: "Кэш минимум",
    cash_max_share: "Кэш максимум",
  };
  return labels[type] ?? type;
}

function limitDirectionLabel(direction: string) {
  if (direction === "min") return "минимум";
  if (direction === "max") return "максимум";
  return direction;
}

function severityLabel(severity: string) {
  const labels: Record<string, string> = {
    info: "info",
    warning: "warning",
    critical: "critical",
  };
  return labels[severity] ?? severity;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function isGeneratedRecommendation(id: string) {
  return id.startsWith("generated:");
}

function DonutChart({ baseCurrency, slices }: { baseCurrency: string; slices: StructureSlice[] }) {
  const colors = ["#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#0891b2", "#4b5563"];
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const segments = slices.reduce<Array<{ length: number; offset: number; slice: StructureSlice }>>((items, slice) => {
    const previousOffset = items.reduce((sum, item) => sum + item.length, 0);
    return [
      ...items,
      {
        length: Math.max(0, slice.percent * circumference),
        offset: previousOffset,
        slice,
      },
    ];
  }, []);

  return (
    <div className="grid gap-5 md:grid-cols-[180px_1fr]">
      <svg aria-label="Структура портфеля" className="h-44 w-44" role="img" viewBox="0 0 100 100">
        <circle cx="50" cy="50" fill="none" r={radius} stroke="var(--border)" strokeWidth="12" />
        {segments.map((segment, index) => (
          <circle
            cx="50"
            cy="50"
            fill="none"
            key={segment.slice.key}
            r={radius}
            stroke={colors[index % colors.length]}
            strokeDasharray={`${segment.length} ${circumference - segment.length}`}
            strokeDashoffset={-segment.offset}
            strokeLinecap="butt"
            strokeWidth="12"
            transform="rotate(-90 50 50)"
          />
        ))}
        <text className="fill-foreground text-[8px] font-semibold" textAnchor="middle" x="50" y="48">
          {formatNumber(total, 0)}
        </text>
        <text className="fill-muted text-[5px]" textAnchor="middle" x="50" y="56">
          {baseCurrency}
        </text>
      </svg>

      <div className="space-y-2">
        {slices.map((slice, index) => (
          <Link className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-background px-4 py-3 text-sm" href={slice.href} key={slice.key}>
            <span className="flex min-w-0 items-center gap-3">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} />
              <span className="min-w-0">
                <span className="block truncate font-medium">{assetTypeLabel(slice.key)}</span>
                <span className="block text-xs text-muted">{slice.count} поз. · {slice.status === "partial" ? "частично" : formatPercent(slice.percent)}</span>
              </span>
            </span>
            <span className="shrink-0 font-medium">{formatMoney(slice.value, baseCurrency)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-3xl border border-dashed border-border bg-surface p-8 text-sm text-muted">{text}</div>;
}

function MetricCard({ hint, label, testId, value }: { label: string; value: string | number; hint: string; testId?: string }) {
  return (
    <article className="rounded-3xl border border-border bg-surface p-6" data-testid={testId}>
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p>
      <p className="mt-2 text-xs text-muted">{hint}</p>
    </article>
  );
}

function DashboardStage6Actions({ data, dashboardPeriod }: { data: PortfolioData; dashboardPeriod: PeriodKey }) {
  return (
    <div className="grid gap-4 rounded-3xl border border-border bg-surface p-4 xl:grid-cols-[minmax(180px,1fr)_minmax(0,3fr)]" data-testid="dashboard-stage-6-actions">
      <div>
        <p className="text-sm font-medium">What-if и экспорт</p>
        <p className="mt-1 text-xs text-muted">Сценарии считаются без записи операций.</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-[auto_1fr]">
        <div className="flex flex-wrap gap-2">
          <Link className="rounded-2xl bg-accent px-4 py-2 text-sm font-medium text-white" href="/what-if">
            What-if
          </Link>
        </div>
        <form action="/api/portfolio/export" className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto_auto]" data-testid="dashboard-export-form" method="get">
          <select aria-label="Период отчета" className="h-10 rounded-2xl border border-border bg-background px-3 text-sm" defaultValue={dashboardPeriod} name="period">
            <option value="1M">1M</option>
            <option value="3M">3M</option>
            <option value="YTD">YTD</option>
            <option value="1Y">1Y</option>
            <option value="All">All</option>
          </select>
          <select aria-label="Портфель отчета" className="h-10 rounded-2xl border border-border bg-background px-3 text-sm" defaultValue="" name="portfolio_id">
            <option value="">Все портфели</option>
            {data.portfolios.map((portfolio) => (
              <option key={portfolio.id} value={portfolio.id}>{portfolio.name}</option>
            ))}
          </select>
          <select aria-label="Счет отчета" className="h-10 rounded-2xl border border-border bg-background px-3 text-sm" defaultValue="" name="account_id">
            <option value="">Все счета</option>
            {data.accounts.map((account) => (
              <option key={account.id} value={account.id}>{account.name}</option>
            ))}
          </select>
          <button className="h-10 rounded-2xl border border-border bg-background px-4 text-sm font-medium" name="format" type="submit" value="excel">
            Excel
          </button>
          <button className="h-10 rounded-2xl border border-border bg-background px-4 text-sm font-medium" name="format" type="submit" value="pdf-html">
            Печать
          </button>
        </form>
      </div>
    </div>
  );
}

function DashboardView({ data, dashboardPeriod }: { data: PortfolioData; dashboardPeriod: PeriodKey }) {
  const activeAccounts = data.accounts.filter((account) => account.status === "active").length;
  const analytics = data.analytics;
  const baseCurrency = analytics.baseCurrency;
  const currentPeriod = analytics.cashFlowPeriods.find((period) => period.period === dashboardPeriod) ?? analytics.cashFlowPeriods[0];
  const accountById = new Map(data.accounts.map((account) => [account.id, account]));
  const assetById = new Map(data.assets.map((asset) => [asset.id, asset]));
  const canEdit = canEditFamilyData(data.family?.role);
  const topRecommendations = data.recommendations
    .filter((recommendation) => recommendation.status === "open")
    .slice(0, 3);
  const latestNews = data.newsItems.slice(0, 5);
  const today = todayIsoDate();
  const upcomingEvents = data.events
    .filter((event) => event.status !== "cancelled" && event.event_date >= today)
    .slice(0, 4);

  return (
    <div className="space-y-8" data-testid="dashboard-view">
      <DashboardStage6Actions dashboardPeriod={dashboardPeriod} data={data} />

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6" data-testid="dashboard-kpi-grid">
        <MetricCard hint={`Оценка на ${analytics.asOf}`} label="Стоимость" testId="dashboard-kpi-total-value" value={formatMoney(analytics.totalValue, baseCurrency)} />
        <MetricCard hint={`Денежные остатки в ${baseCurrency}`} label="Кэш" testId="dashboard-kpi-cash" value={formatMoney(analytics.cashValue, baseCurrency)} />
        <MetricCard hint="Нереализованный результат" label="P&L" testId="dashboard-kpi-pnl" value={formatSignedMoney(analytics.unrealizedPnl, baseCurrency)} />
        <MetricCard hint={analytics.xirr.status === "ready" ? "Годовая доходность" : "Недостаточно данных"} label="XIRR" testId="dashboard-kpi-xirr" value={formatPercent(analytics.xirr.value)} />
        <MetricCard hint={`Выводы: ${formatMoney(currentPeriod?.outflows ?? 0, baseCurrency)}`} label={`Приток ${dashboardPeriod}`} testId="dashboard-kpi-inflow" value={formatMoney(currentPeriod?.inflows ?? 0, baseCurrency)} />
        <MetricCard hint={`Активных счетов: ${activeAccounts}`} label="Позиции" testId="dashboard-kpi-positions" value={analytics.positionCount} />
      </div>

      {analytics.alerts.length > 0 && (
        <section className="grid gap-3 md:grid-cols-2">
          {analytics.alerts.map((alert) => (
            <Link
              className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
              href={alert.href ?? "/dashboard"}
              key={`${alert.code}:${alert.message}`}
            >
              <span className="block font-medium">{alert.code === "xirr_unavailable" ? "Доходность пока не считается" : "Нужно проверить данные"}</span>
              <span className="mt-1 block text-amber-900">{alert.message}</span>
            </Link>
          ))}
        </section>
      )}

      {data.systemAlerts.length > 0 && (
        <section className="grid gap-3 md:grid-cols-2" data-testid="dashboard-system-alerts">
          {data.systemAlerts.slice(0, 4).map((alert) => {
            const href = typeof alert.payload.href === "string" ? alert.payload.href : "/settings";
            return (
              <Link
                className={`rounded-3xl border p-4 text-sm ${alert.severity === "critical" ? "border-red-200 bg-red-50 text-red-950" : "border-amber-200 bg-amber-50 text-amber-950"}`}
                href={href}
                key={alert.id}
              >
                <span className="block font-medium">{alert.title}</span>
                <span className="mt-1 block opacity-80">{severityLabel(alert.severity)} · {alert.condition_type}</span>
              </Link>
            );
          })}
        </section>
      )}

      {(topRecommendations.length > 0 || latestNews.length > 0 || upcomingEvents.length > 0 || data.systemAlerts.length > 0) && (
        <section className="grid gap-6 xl:grid-cols-3" data-testid="dashboard-stage-5-signals">
          <div className="rounded-3xl border border-border bg-surface p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Рекомендации</h2>
                <p className="mt-1 text-sm text-muted">Главные сигналы для проверки.</p>
              </div>
              <Link className="text-sm font-medium text-accent" href="/recommendations">Все</Link>
            </div>
            <div className="mt-5 space-y-3">
              {topRecommendations.map((recommendation) => (
                <Link className="block rounded-2xl border border-border bg-background p-4" data-testid="dashboard-recommendation-link" href="/recommendations" key={recommendation.id}>
                  <span className="text-xs font-medium uppercase text-muted">{recommendationPriorityLabel(recommendation.priority)}</span>
                  <span className="mt-2 block font-medium">{recommendation.title}</span>
                  <span className="mt-1 block text-sm text-muted">{recommendation.reason ?? recommendationTypeLabel(recommendation.recommendation_type)}</span>
                  {recommendationMetricLabel(recommendation) && (
                    <span className="mt-2 block text-xs font-medium text-accent">{recommendationMetricLabel(recommendation)}</span>
                  )}
                </Link>
              ))}
              {topRecommendations.length === 0 && <div className="text-sm text-muted">Активных рекомендаций пока нет.</div>}
            </div>
          </div>

          <div className="rounded-3xl border border-border bg-surface p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Новости</h2>
                <p className="mt-1 text-sm text-muted">Последние новости и идеи.</p>
              </div>
              <Link className="text-sm font-medium text-accent" href="/news">Все</Link>
            </div>
            <div className="mt-5 space-y-3">
              {latestNews.slice(0, 3).map((newsItem) => (
                <Link className="block rounded-2xl border border-border bg-background p-4" href="/news" key={newsItem.id}>
                  <span className="text-xs text-muted">{newsItem.source} · {formatDateTime(newsItem.published_at)}</span>
                  <span className="mt-2 block font-medium">{newsItem.title}</span>
                  <span className="mt-1 block text-sm text-muted">{newsItem.asset_id ? assetById.get(newsItem.asset_id)?.name ?? "Актив" : newsKindLabel(newsItem.kind)}</span>
                </Link>
              ))}
              {latestNews.length === 0 && <div className="text-sm text-muted">Источник новостей пока не заполнен.</div>}
            </div>
          </div>

          <div className="rounded-3xl border border-border bg-surface p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">События</h2>
                <p className="mt-1 text-sm text-muted">Ближайшие дивиденды, купоны и погашения.</p>
              </div>
              <Link className="text-sm font-medium text-accent" href="/events">Все</Link>
            </div>
            <div className="mt-5 space-y-3">
              {upcomingEvents.slice(0, 3).map((event) => (
                <Link className="block rounded-2xl border border-border bg-background p-4" href="/events" key={event.id}>
                  <span className="text-xs text-muted">{formatDate(event.event_date)} · {eventTypeLabel(event.event_type)}</span>
                  <span className="mt-2 block font-medium">{event.title}</span>
                  <span className="mt-1 block text-sm text-muted">
                    {event.asset_id ? assetById.get(event.asset_id)?.name ?? "Актив" : "Без привязки"}
                    {event.amount !== null && event.currency_code ? ` · ${formatMoney(event.amount, event.currency_code)}` : ""}
                  </span>
                </Link>
              ))}
              {upcomingEvents.length === 0 && <div className="text-sm text-muted">Будущих событий пока нет.</div>}
            </div>
          </div>
        </section>
      )}

      <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-3xl border border-border bg-surface p-6" data-testid="dashboard-structure-asset-type">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Структура по классам</h2>
              <p className="mt-1 text-sm text-muted">Доли считаются в {baseCurrency}; неполные оценки помечены отдельно.</p>
            </div>
            <span className="rounded-full bg-background px-3 py-1 text-xs text-muted">{data.portfolios.length} портф.</span>
          </div>

          <div className="mt-5">
            {analytics.structureByAssetType.length > 0 && <DonutChart baseCurrency={baseCurrency} slices={analytics.structureByAssetType} />}
            {analytics.structureByAssetType.length === 0 && <EmptyState text="Структура появится после импорта или ручных операций." />}
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-surface p-6" data-testid="dashboard-cash-flows">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Денежные потоки</h2>
              <p className="mt-1 text-sm text-muted">Внешние пополнения и выводы без сделок, FX и внутренних переводов.</p>
            </div>
            <span className="rounded-full bg-background px-3 py-1 text-xs text-muted">{periodLabel(dashboardPeriod)}</span>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {analytics.cashFlowPeriods.map((period) => (
              <Link
                className={`rounded-2xl border px-4 py-2 text-sm font-medium ${period.period === dashboardPeriod ? "border-accent bg-accent text-white" : "border-border bg-background text-foreground"}`}
                href={`/dashboard?dashboard_period=${period.period}`}
                key={period.period}
              >
                {period.period}
              </Link>
            ))}
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-border bg-background p-4">
              <p className="text-xs text-muted">Притоки</p>
              <p className="mt-2 text-lg font-semibold">{formatMoney(currentPeriod?.inflows ?? 0, baseCurrency)}</p>
            </div>
            <div className="rounded-2xl border border-border bg-background p-4">
              <p className="text-xs text-muted">Выводы</p>
              <p className="mt-2 text-lg font-semibold">{formatMoney(currentPeriod?.outflows ?? 0, baseCurrency)}</p>
            </div>
            <div className="rounded-2xl border border-border bg-background p-4">
              <p className="text-xs text-muted">Net flow</p>
              <p className="mt-2 text-lg font-semibold">{formatSignedMoney(currentPeriod?.net ?? 0, baseCurrency)}</p>
            </div>
          </div>

          {(currentPeriod?.buckets.length ?? 0) > 0 && (
            <div className="mt-5 rounded-2xl border border-border bg-background p-4" data-testid="dashboard-cash-flow-buckets">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">Динамика по месяцам</h3>
                <span className="text-xs text-muted">притоки / выводы</span>
              </div>
              <div className="mt-4 space-y-3">
                {currentPeriod?.buckets.map((bucket) => {
                  const maxAmount = Math.max(1, ...currentPeriod.buckets.map((item) => Math.max(item.inflows, item.outflows)));
                  const inflowWidth = Math.max(2, (bucket.inflows / maxAmount) * 100);
                  const outflowWidth = Math.max(2, (bucket.outflows / maxAmount) * 100);

                  return (
                    <div className="grid gap-2 md:grid-cols-[4rem_1fr_7rem]" key={bucket.key}>
                      <div className="text-xs font-medium text-muted">{bucket.label}</div>
                      <div className="space-y-1">
                        <div className="h-2 overflow-hidden rounded-full bg-border">
                          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${inflowWidth}%` }} />
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-border">
                          <div className="h-full rounded-full bg-rose-500" style={{ width: `${outflowWidth}%` }} />
                        </div>
                      </div>
                      <div className="text-right text-xs font-medium">{formatSignedMoney(bucket.net, baseCurrency)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-5 overflow-hidden rounded-2xl border border-border bg-background" data-testid="dashboard-cash-flow-table">
            {(currentPeriod?.flows.length ?? 0) === 0 ? (
              <div className="p-4 text-sm text-muted">За выбранный период внешних потоков нет.</div>
            ) : (
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="border-b border-border text-muted">
                  <tr>
                    <th className="px-4 py-3 font-medium">Дата</th>
                    <th className="px-4 py-3 font-medium">Тип</th>
                    <th className="px-4 py-3 font-medium">Счёт</th>
                    <th className="px-4 py-3 font-medium">Источник</th>
                    <th className="px-4 py-3 text-right font-medium">Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {currentPeriod?.flows.slice(0, 8).map((flow) => (
                    <tr className="border-b border-border last:border-0" key={flow.operationId}>
                      <td className="px-4 py-3 text-muted">{flow.date}</td>
                      <td className="px-4 py-3 font-medium">{operationTypeLabel(flow.operationType)}</td>
                      <td className="px-4 py-3 text-muted">{accountById.get(flow.accountId)?.name ?? "Счёт не найден"}</td>
                      <td className="px-4 py-3 text-muted">{sourceLabel(flow.source)}</td>
                      <td className="px-4 py-3 text-right font-medium">{flow.direction === "inflow" ? "+" : "-"}{formatMoney(flow.amount, flow.currencyCode)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-3xl border border-border bg-surface p-6" data-testid="dashboard-structure-secondary">
          <h2 className="text-lg font-semibold">Структура по валютам</h2>
          <div className="mt-5 space-y-3">
            {analytics.structureByCurrency.map((slice) => (
              <Link className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-background p-4" href={slice.href} key={slice.key}>
                <div>
                  <p className="font-medium">{slice.label}</p>
                  <p className="mt-1 text-sm text-muted">{slice.count} поз. · {slice.status === "partial" ? "нужен FX" : formatPercent(slice.percent)}</p>
                </div>
                <p className="font-semibold">{formatMoney(slice.value, baseCurrency)}</p>
              </Link>
            ))}
            {analytics.structureByCurrency.length === 0 && <EmptyState text="Валютная структура пока пуста." />}
          </div>

          <h3 className="mt-6 text-sm font-semibold">По счетам</h3>
          <div className="mt-3 space-y-3">
            {analytics.structureByAccount.map((slice) => (
              <Link className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-background p-4" href={slice.href} key={slice.key}>
                <div className="min-w-0">
                  <p className="truncate font-medium">{slice.label}</p>
                  <p className="mt-1 text-sm text-muted">{slice.count} строк · {slice.status === "partial" ? "частично" : formatPercent(slice.percent)}</p>
                </div>
                <p className="shrink-0 font-semibold">{formatMoney(slice.value, baseCurrency)}</p>
              </Link>
            ))}
            {analytics.structureByAccount.length === 0 && <EmptyState text="Структура по счетам пока пуста." />}
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-surface p-6" data-testid="dashboard-xirr-detail">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Проверка XIRR</h2>
              <p className="mt-1 text-sm text-muted">Внешние потоки плюс конечная оценка портфеля на {analytics.xirrDetail.asOf}.</p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${analytics.xirr.status === "ready" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
              {xirrStatusLabel(analytics.xirr.status)}
            </span>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-border bg-background p-4">
              <p className="text-xs text-muted">XIRR</p>
              <p className="mt-2 text-lg font-semibold">{analytics.xirr.status === "ready" ? formatPercent(analytics.xirr.value) : "—"}</p>
            </div>
            <div className="rounded-2xl border border-border bg-background p-4">
              <p className="text-xs text-muted">Внесено</p>
              <p className="mt-2 text-lg font-semibold">{formatMoney(analytics.xirrDetail.externalInflowTotal, baseCurrency)}</p>
            </div>
            <div className="rounded-2xl border border-border bg-background p-4">
              <p className="text-xs text-muted">Конечная оценка</p>
              <p className="mt-2 text-lg font-semibold">{formatMoney(analytics.xirrDetail.terminalValue, baseCurrency)}</p>
            </div>
          </div>

          {(analytics.xirrDetail.reason || analytics.xirrDetail.skippedNonBaseCurrencyCount > 0) && (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              {analytics.xirrDetail.reason ?? "Часть потоков не вошла в XIRR из-за ограничений данных."}
              {analytics.xirrDetail.skippedNonBaseCurrencyCount > 0 && (
                <span className="block pt-1">Пропущено потоков не в {baseCurrency}: {analytics.xirrDetail.skippedNonBaseCurrencyCount}.</span>
              )}
            </div>
          )}

          <details className="mt-5 rounded-2xl border border-border bg-background" data-testid="dashboard-xirr-cash-flows" open>
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Cash-flow строки XIRR</summary>
            <div className="overflow-x-auto border-t border-border">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead className="border-b border-border text-muted">
                  <tr>
                    <th className="px-4 py-3 font-medium">Дата</th>
                    <th className="px-4 py-3 font-medium">Строка</th>
                    <th className="px-4 py-3 font-medium">Счёт</th>
                    <th className="px-4 py-3 font-medium">Источник</th>
                    <th className="px-4 py-3 text-right font-medium">Поток</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.xirrDetail.cashFlows.map((flow) => (
                    <tr className="border-b border-border last:border-0" key={`${flow.kind}:${flow.operationId ?? "terminal"}:${flow.date}`}>
                      <td className="px-4 py-3 text-muted">{flow.date}</td>
                      <td className="px-4 py-3 font-medium">
                        {xirrFlowKindLabel(flow.kind)}
                        {flow.operationType && <span className="block text-[11px] font-normal text-muted">{operationTypeLabel(flow.operationType)}</span>}
                      </td>
                      <td className="px-4 py-3 text-muted">{flow.accountId ? accountById.get(flow.accountId)?.name ?? "Счёт не найден" : "Портфель"}</td>
                      <td className="px-4 py-3 text-muted">{flow.kind === "terminal_value" ? "оценка" : sourceLabel(flow.source)}</td>
                      <td className="px-4 py-3 text-right font-medium">{formatSignedMoney(flow.amount, flow.currencyCode)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      </section>

      <PositionsView canEdit={canEdit} positions={data.positions} />
    </div>
  );
}

function latestImportsByAccount(imports: ImportJob[]) {
  const latestByAccount = new Map<string, ImportJob>();

  for (const importJob of imports) {
    if (!importJob.account_id) continue;
    const existing = latestByAccount.get(importJob.account_id);
    if (!existing || importJob.created_at > existing.created_at) {
      latestByAccount.set(importJob.account_id, importJob);
    }
  }

  return latestByAccount;
}

function AccountDetailView({ account, data }: { account: Account; data: PortfolioData }) {
  const accountCash = data.cashBalances.filter((balance) => balance.account_id === account.id);
  const accountPositions = data.positions.filter((position) => position.account_id === account.id);
  const accountOperations = data.operations.filter((operation) => operation.account_id === account.id);
  const accountImports = data.imports.filter((importJob) => importJob.account_id === account.id);
  const accountImportIds = new Set(accountImports.map((importJob) => importJob.id));
  const accountImportRows = data.importRows.filter((row) => accountImportIds.has(row.import_id));
  const positionValue = accountPositions.reduce((total, position) => total + (position.market_value ?? position.book_value), 0);
  const pnl = accountPositions.reduce((total, position) => total + (position.unrealized_pnl ?? 0), 0);

  return (
    <section className="space-y-6 rounded-3xl border border-border bg-surface p-6" data-testid="account-detail">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted">{accountTypeLabel(account.account_type_code)} · {statusLabel(account.status)}</p>
          <h2 className="mt-2 text-2xl font-semibold">{account.name}</h2>
          <p className="mt-2 text-sm text-muted">{account.institution_name ?? "Организация не указана"}</p>
        </div>
        <Link className="rounded-2xl border border-border px-4 py-2 text-sm font-medium text-muted" href="/accounts">Закрыть карточку</Link>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Валюта счёта" value={account.currency_code} hint="Базовая валюта счёта" />
        <MetricCard label="Позиций" value={accountPositions.length} hint={formatMoney(positionValue, account.currency_code)} />
        <MetricCard label="P&L" value={formatSignedMoney(pnl, account.currency_code)} hint="Нереализованный" />
        <MetricCard label="Импорты" value={accountImports.length} hint={`Строк: ${accountImportRows.length}`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border border-border bg-background">
          <div className="border-b border-border p-4">
            <h3 className="font-semibold">Кэш</h3>
          </div>
          {accountCash.length === 0 ? <div className="p-4 text-sm text-muted">Остатков по счёту пока нет.</div> : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Валюта</th>
                  <th className="px-4 py-3 font-medium">Остаток</th>
                  <th className="px-4 py-3 font-medium">Снимок</th>
                </tr>
              </thead>
              <tbody>
                {accountCash.map((balance) => (
                  <tr className="border-b border-border last:border-0" key={balance.id}>
                    <td className="px-4 py-3 text-muted">{balance.currency_code}</td>
                    <td className="px-4 py-3 font-medium">{formatMoney(balance.balance, balance.currency_code)}</td>
                    <td className="px-4 py-3 text-muted">{balance.snapshot_date ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="overflow-hidden rounded-2xl border border-border bg-background">
          <div className="border-b border-border p-4">
            <h3 className="font-semibold">Импорты</h3>
          </div>
          {accountImports.length === 0 ? <div className="p-4 text-sm text-muted">Импортов по счёту пока нет.</div> : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Файл</th>
                  <th className="px-4 py-3 font-medium">Статус</th>
                  <th className="px-4 py-3 font-medium">Дата</th>
                </tr>
              </thead>
              <tbody>
                {accountImports.map((importJob) => (
                  <tr className="border-b border-border last:border-0" key={importJob.id}>
                    <td className="px-4 py-3 font-medium">{importJob.original_file_name}</td>
                    <td className="px-4 py-3 text-muted">{statusLabel(importJob.status)}</td>
                    <td className="px-4 py-3 text-muted">{formatDateTime(importJob.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <PositionsView canEdit={canEditFamilyData(data.family?.role)} positions={accountPositions} />
      <OperationsView accounts={data.accounts} assets={data.assets} canCancel={data.family?.role === "admin"} operations={accountOperations} returnTo="/accounts" />
      <ReconciliationRows canEdit={canEditFamilyData(data.family?.role)} rows={accountImportRows} />
    </section>
  );
}

function AccountsView({
  data,
  operationCancelled,
  operationError,
  operationSaved,
  selectedAccountId,
}: {
  data: PortfolioData;
  operationCancelled?: string;
  operationError?: string;
  operationSaved?: string;
  selectedAccountId?: string;
}) {
  const { accounts } = data;

  const latestImportByAccount = latestImportsByAccount(data.imports);
  const selectedAccount = selectedAccountId ? accounts.find((account) => account.id === selectedAccountId) : null;

  return (
    <div className="space-y-6">
      <OperationNotice operationCancelled={operationCancelled} operationError={operationError} operationSaved={operationSaved} />
      <ManualOperationsPanel data={data} returnTo="/accounts" />
      <CashBalancesView data={data} />
      {selectedAccount && <AccountDetailView account={selectedAccount} data={data} />}
      <OperationsView accounts={data.accounts} assets={data.assets} canCancel={data.family?.role === "admin"} operations={data.operations} returnTo="/accounts" />

      {accounts.length === 0 ? <EmptyState text="Счета пока не созданы." /> : (
        <div className="grid gap-4 md:grid-cols-2">
          {accounts.map((account) => {
            const latestImport = latestImportByAccount.get(account.id);

            return (
              <article className={`rounded-3xl border bg-surface p-6 ${selectedAccount?.id === account.id ? "border-accent" : "border-border"}`} key={account.id}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm text-muted">{accountTypeLabel(account.account_type_code)}</p>
                    <h2 className="mt-2 text-xl font-semibold">{account.name}</h2>
                    <p className="mt-2 text-sm text-muted">{account.institution_name ?? "Организация не указана"}</p>
                  </div>
                  <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">{account.currency_code}</span>
                </div>
                <div className="mt-6 space-y-1 text-xs text-muted">
                  <p>Статус: {statusLabel(account.status)}</p>
                  <p>Последний импорт: {latestImport ? `${formatDateTime(latestImport.created_at)} · ${statusLabel(latestImport.status)}` : "—"}</p>
                </div>
                <Link className="mt-5 inline-flex rounded-2xl bg-accent px-4 py-2 text-sm font-medium text-white" href={`/accounts?account_id=${encodeURIComponent(account.id)}`}>
                  Открыть карточку
                </Link>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PriceNotice({ priceError, priced }: { priceError?: string; priced?: string }) {
  const priceErrors: Record<string, string> = {
    "no-family": "Для пользователя не назначена семья.",
    forbidden: "У роли viewer нет права сохранять цены.",
    "position-required": "Не выбрана позиция для оценки.",
    "position-not-found": "Позиция не найдена или уже закрыта.",
    "price-required": "Введите положительную цену.",
    "date-required": "Введите дату оценки в формате YYYY-MM-DD.",
  };

  if (priced) return <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">Рыночная цена сохранена, оценка позиции обновлена.</div>;
  if (priceError) return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{priceErrors[priceError] ?? "Не удалось сохранить рыночную цену."}</div>;
  return null;
}

function SettingsNotice({ settingsError, settingsSaved }: { settingsError?: string; settingsSaved?: string }) {
  const errors: Record<string, string> = {
    "no-family": "Для пользователя не назначена семья.",
    forbidden: "У роли viewer нет права изменять настройки.",
    "portfolio-name-required": "Введите название портфеля.",
    "account-name-required": "Введите название счёта.",
    "portfolio-required": "Выберите портфель для счёта.",
    "portfolio-not-found": "Портфель не найден или недоступен.",
    "currency-invalid": "Валюта должна быть ISO-кодом из трёх букв.",
  };

  if (settingsSaved === "portfolio") return <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">Портфель создан.</div>;
  if (settingsSaved === "account") return <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">Счёт создан и доступен для импорта.</div>;
  if (settingsError) return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{errors[settingsError] ?? "Не удалось сохранить настройки."}</div>;
  return null;
}

function OperationNotice({ operationCancelled, operationError, operationSaved }: { operationCancelled?: string; operationError?: string; operationSaved?: string }) {
  const errors: Record<string, string> = {
    "no-family": "Для пользователя не назначена семья.",
    forbidden: "У роли viewer нет права создавать операции.",
    "account-required": "Выберите счёт.",
    "account-not-found": "Выбранный счёт не найден или недоступен.",
    "asset-required": "Выберите актив.",
    "asset-not-found": "Выбранный актив не найден или недоступен.",
    "date-required": "Введите дату операции.",
    "settle-date-invalid": "Дата расчётов должна быть в формате YYYY-MM-DD.",
    "currency-invalid": "Валюта должна быть ISO-кодом из трёх букв.",
    "costs-invalid": "Комиссия и налог должны быть положительными числами или пустыми.",
    "amount-required": "Введите сумму.",
    "quantity-required": "Введите количество.",
    "price-required": "Введите цену.",
    "cash-insufficient": "Недостаточно доступного кэша для операции.",
    "position-insufficient": "Недостаточно доступного количества позиции для продажи.",
    "target-account-not-found": "Счёт-получатель не найден или недоступен.",
    "target-amount-required": "Введите сумму зачисления.",
    "fx-currency-same": "Для FX выберите разные валюты.",
    "transfer-account-same": "Для перевода выберите разные счета.",
    "forbidden-cancel": "Отмена ручной операции доступна только роли admin.",
    "operation-required": "Не выбрана операция.",
    "operation-not-found": "Операция не найдена или недоступна.",
    "operation-not-cancellable": "Можно отменять только активные ручные операции.",
  };
  const savedLabels: Record<string, string> = {
    deposit: "Пополнение сохранено, кэш пересчитан.",
    withdrawal: "Вывод сохранён, кэш пересчитан.",
    buy: "Покупка сохранена, позиция пересчитана.",
    sell: "Продажа сохранена, позиция пересчитана.",
    fx: "FX-обмен сохранён, валютные остатки пересчитаны.",
    cash_transfer: "Перевод сохранён, остатки по счетам пересчитаны.",
  };

  if (operationCancelled) return <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">Ручная операция отменена, расчёт обновлён.</div>;
  if (operationSaved) return <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{savedLabels[operationSaved] ?? "Операция сохранена."}</div>;
  if (operationError) return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{errors[operationError] ?? "Не удалось сохранить операцию."}</div>;
  return null;
}

function CashBalancesView({ data }: { data: PortfolioData }) {
  if (data.cashBalances.length === 0) return <EmptyState text="Денежные остатки пока не сформированы. Добавьте пополнение или примените импорт с валютными остатками." />;

  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-surface">
      <div className="border-b border-border p-6">
        <h2 className="text-lg font-semibold">Денежные остатки</h2>
        <p className="mt-2 text-sm text-muted">Кэш считается по счёту и валюте из импортированных снимков и ручных операций.</p>
      </div>
      <table className="w-full min-w-[680px] text-left text-sm">
        <thead className="border-b border-border text-muted">
          <tr>
            <th className="px-5 py-4 font-medium">Счёт</th>
            <th className="px-5 py-4 font-medium">Валюта</th>
            <th className="px-5 py-4 font-medium">Остаток</th>
            <th className="px-5 py-4 font-medium">Снимок</th>
            <th className="px-5 py-4 font-medium">Поток после снимка</th>
          </tr>
        </thead>
        <tbody>
          {data.cashBalances.map((balance) => (
            <tr className="border-b border-border last:border-0" key={balance.id}>
              <td className="px-5 py-4 font-medium">{balance.account_name}</td>
              <td className="px-5 py-4 text-muted">{balance.currency_code}</td>
              <td className="px-5 py-4 font-medium">{formatMoney(balance.balance, balance.currency_code)}</td>
              <td className="px-5 py-4 text-muted">{balance.snapshot_date ?? "—"}</td>
              <td className="px-5 py-4 text-muted">{formatSignedMoney(balance.net_cash_flow, balance.currency_code)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OperationTextInput({
  defaultValue,
  label,
  name,
  placeholder,
  required = false,
  type = "text",
}: {
  defaultValue?: string;
  label: string;
  name: string;
  placeholder?: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="font-medium">{label}</span>
      <input className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" defaultValue={defaultValue} name={name} placeholder={placeholder} required={required} step={type === "number" ? "0.0000001" : undefined} type={type} />
    </label>
  );
}

function OperationAccountSelect({ accounts, label = "Счёт", name = "account_id" }: { accounts: Account[]; label?: string; name?: string }) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="font-medium">{label}</span>
      <select className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" name={name} required>
        <option value="">Выберите счёт</option>
        {accounts.filter((account) => account.status === "active").map((account) => (
          <option key={account.id} value={account.id}>{account.name} · {account.currency_code}</option>
        ))}
      </select>
    </label>
  );
}

function OperationAssetSelect({ assets }: { assets: PortfolioData["assets"] }) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="font-medium">Актив</span>
      <select className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" name="asset_id" required>
        <option value="">Выберите актив</option>
        {assets.filter((asset) => asset.status === "active" && asset.asset_type_code !== "cash").map((asset) => (
          <option key={asset.id} value={asset.id}>{asset.name} · {asset.ticker ?? asset.currency_code ?? "—"}</option>
        ))}
      </select>
    </label>
  );
}

function ManualOperationsPanel({ data, returnTo }: { data: PortfolioData; returnTo: "/accounts" | "/assets" }) {
  const canEdit = canEditFamilyData(data.family?.role);
  const activeAccounts = data.accounts.filter((account) => account.status === "active");
  const tradableAssets = data.assets.filter((asset) => asset.status === "active" && asset.asset_type_code !== "cash");
  const defaultDate = todayIsoDate();
  const defaultCurrency = data.family?.baseCurrency ?? "RUB";

  if (!canEdit) {
    return (
      <div className="rounded-3xl border border-border bg-surface p-6">
        <p className="text-sm font-medium text-accent">Режим просмотра</p>
        <h2 className="mt-2 text-xl font-semibold">Ручные операции доступны только для изменения</h2>
        <p className="mt-2 text-sm text-muted">Роль viewer может смотреть операции и расчёты, но не может создавать новые записи.</p>
      </div>
    );
  }

  if (activeAccounts.length === 0) {
    return <EmptyState text="Создайте активный счёт, чтобы добавить ручную операцию." />;
  }

  return (
    <section className="rounded-3xl border border-border bg-surface p-6" data-testid="manual-operations-panel">
      <div>
        <p className="text-sm font-medium text-accent">Ручной ввод</p>
        <h2 className="mt-2 text-xl font-semibold">Добавить операцию</h2>
      </div>

      <div className="mt-5 grid gap-3 xl:grid-cols-2">
        <details className="rounded-2xl border border-border bg-background p-4" open>
          <summary className="cursor-pointer text-sm font-semibold">Пополнение</summary>
          <form action={createDepositOperation} className="mt-4 grid gap-3">
            <input name="return_to" type="hidden" value={returnTo} />
            <OperationAccountSelect accounts={activeAccounts} />
            <div className="grid gap-3 md:grid-cols-3">
              <OperationTextInput defaultValue={defaultDate} label="Дата" name="trade_date" required type="date" />
              <OperationTextInput defaultValue={defaultCurrency} label="Валюта" name="currency_code" placeholder={defaultCurrency} required />
              <OperationTextInput label="Сумма" name="amount" required type="number" />
            </div>
            <OperationTextInput label="Комментарий" name="notes" placeholder="Опционально" />
            <button className="h-11 rounded-2xl bg-accent px-5 text-sm font-medium text-white" type="submit">Сохранить пополнение</button>
          </form>
        </details>

        <details className="rounded-2xl border border-border bg-background p-4">
          <summary className="cursor-pointer text-sm font-semibold">Вывод</summary>
          <form action={createWithdrawalOperation} className="mt-4 grid gap-3">
            <input name="return_to" type="hidden" value={returnTo} />
            <OperationAccountSelect accounts={activeAccounts} />
            <div className="grid gap-3 md:grid-cols-3">
              <OperationTextInput defaultValue={defaultDate} label="Дата" name="trade_date" required type="date" />
              <OperationTextInput defaultValue={defaultCurrency} label="Валюта" name="currency_code" placeholder={defaultCurrency} required />
              <OperationTextInput label="Сумма" name="amount" required type="number" />
            </div>
            <OperationTextInput label="Комментарий" name="notes" placeholder="Опционально" />
            <button className="h-11 rounded-2xl bg-accent px-5 text-sm font-medium text-white" type="submit">Сохранить вывод</button>
          </form>
        </details>

        <details className="rounded-2xl border border-border bg-background p-4">
          <summary className="cursor-pointer text-sm font-semibold">Покупка</summary>
          <form action={createBuyOperation} className="mt-4 grid gap-3">
            <input name="return_to" type="hidden" value={returnTo} />
            <OperationAccountSelect accounts={activeAccounts} />
            <OperationAssetSelect assets={tradableAssets} />
            <div className="grid gap-3 md:grid-cols-3">
              <OperationTextInput defaultValue={defaultDate} label="Дата" name="trade_date" required type="date" />
              <OperationTextInput defaultValue={defaultCurrency} label="Валюта" name="currency_code" placeholder={defaultCurrency} required />
              <OperationTextInput label="Количество" name="quantity" required type="number" />
              <OperationTextInput label="Цена" name="price" required type="number" />
              <OperationTextInput label="Комиссия" name="fee_amount" type="number" />
              <OperationTextInput label="Налог" name="tax_amount" type="number" />
            </div>
            <OperationTextInput label="Комментарий" name="notes" placeholder="Опционально" />
            <button className="h-11 rounded-2xl bg-accent px-5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50" disabled={tradableAssets.length === 0} type="submit">Сохранить покупку</button>
          </form>
        </details>

        <details className="rounded-2xl border border-border bg-background p-4">
          <summary className="cursor-pointer text-sm font-semibold">Продажа</summary>
          <form action={createSellOperation} className="mt-4 grid gap-3">
            <input name="return_to" type="hidden" value={returnTo} />
            <OperationAccountSelect accounts={activeAccounts} />
            <OperationAssetSelect assets={tradableAssets} />
            <div className="grid gap-3 md:grid-cols-3">
              <OperationTextInput defaultValue={defaultDate} label="Дата" name="trade_date" required type="date" />
              <OperationTextInput defaultValue={defaultCurrency} label="Валюта" name="currency_code" placeholder={defaultCurrency} required />
              <OperationTextInput label="Количество" name="quantity" required type="number" />
              <OperationTextInput label="Цена" name="price" required type="number" />
              <OperationTextInput label="Комиссия" name="fee_amount" type="number" />
              <OperationTextInput label="Налог" name="tax_amount" type="number" />
            </div>
            <OperationTextInput label="Комментарий" name="notes" placeholder="Опционально" />
            <button className="h-11 rounded-2xl bg-accent px-5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50" disabled={tradableAssets.length === 0} type="submit">Сохранить продажу</button>
          </form>
        </details>

        <details className="rounded-2xl border border-border bg-background p-4">
          <summary className="cursor-pointer text-sm font-semibold">FX</summary>
          <form action={createFxOperation} className="mt-4 grid gap-3">
            <input name="return_to" type="hidden" value={returnTo} />
            <OperationAccountSelect accounts={activeAccounts} />
            <div className="grid gap-3 md:grid-cols-3">
              <OperationTextInput defaultValue={defaultDate} label="Дата" name="trade_date" required type="date" />
              <OperationTextInput defaultValue={defaultCurrency} label="Валюта списания" name="from_currency_code" required />
              <OperationTextInput label="Сумма списания" name="from_amount" required type="number" />
              <OperationTextInput label="Валюта зачисления" name="to_currency_code" placeholder="USD" required />
              <OperationTextInput label="Сумма зачисления" name="to_amount" required type="number" />
              <OperationTextInput label="Комиссия" name="fee_amount" type="number" />
            </div>
            <OperationTextInput label="Комментарий" name="notes" placeholder="Опционально" />
            <button className="h-11 rounded-2xl bg-accent px-5 text-sm font-medium text-white" type="submit">Сохранить FX</button>
          </form>
        </details>

        <details className="rounded-2xl border border-border bg-background p-4">
          <summary className="cursor-pointer text-sm font-semibold">Перевод денег</summary>
          <form action={createCashTransferOperation} className="mt-4 grid gap-3">
            <input name="return_to" type="hidden" value={returnTo} />
            <div className="grid gap-3 md:grid-cols-2">
              <OperationAccountSelect accounts={activeAccounts} label="Счёт-источник" />
              <OperationAccountSelect accounts={activeAccounts} label="Счёт-получатель" name="to_account_id" />
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <OperationTextInput defaultValue={defaultDate} label="Дата" name="trade_date" required type="date" />
              <OperationTextInput defaultValue={defaultCurrency} label="Валюта" name="currency_code" required />
              <OperationTextInput label="Сумма" name="amount" required type="number" />
            </div>
            <OperationTextInput label="Комментарий" name="notes" placeholder="Опционально" />
            <button className="h-11 rounded-2xl bg-accent px-5 text-sm font-medium text-white" type="submit">Сохранить перевод</button>
          </form>
        </details>
      </div>
    </section>
  );
}

function PositionFiltersForm({
  accounts,
  assetTypes,
  currencies,
  filters,
}: {
  accounts: Account[];
  assetTypes: string[];
  currencies: string[];
  filters: PositionFilterInput;
}) {
  return (
    <form className="rounded-3xl border border-border bg-surface p-6" data-testid="position-filters-form">
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <label className="grid gap-2 text-sm xl:col-span-2">
          <span className="font-medium">Поиск</span>
          <input className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" defaultValue={filters.query ?? ""} name="position_query" placeholder="Актив, тикер, счёт" />
        </label>
        <label className="grid gap-2 text-sm">
          <span className="font-medium">Счёт</span>
          <select className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" defaultValue={filters.accountId ?? ""} name="position_account_id">
            <option value="">Все</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>{account.name}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm">
          <span className="font-medium">Класс</span>
          <select className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" defaultValue={filters.assetType ?? ""} name="position_asset_type">
            <option value="">Все</option>
            {assetTypes.map((assetType) => (
              <option key={assetType} value={assetType}>{assetTypeLabel(assetType)}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm">
          <span className="font-medium">Валюта</span>
          <select className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" defaultValue={filters.currencyCode ?? ""} name="position_currency">
            <option value="">Все</option>
            {currencies.map((currency) => (
              <option key={currency} value={currency}>{currency}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm">
          <span className="font-medium">Сортировка</span>
          <select className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" defaultValue={filters.sortBy ?? "asset"} name="position_sort">
            <option value="asset">Актив</option>
            <option value="asset_type">Класс</option>
            <option value="currency">Валюта</option>
            <option value="value">Стоимость</option>
            <option value="pnl">P&L</option>
            <option value="quantity">Количество</option>
          </select>
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted">
          <input defaultChecked={Boolean(filters.onlyProblematic)} name="position_problematic" type="checkbox" value="1" />
          Только проблемные позиции
        </label>
        <button className="h-10 rounded-2xl bg-accent px-5 text-sm font-medium text-white" type="submit">Применить</button>
        <Link className="h-10 rounded-2xl border border-border px-5 py-2 text-sm font-medium text-muted" href="/assets">Сбросить</Link>
      </div>
    </form>
  );
}

function PositionsView({ canEdit, positions }: { canEdit: boolean; positions: Position[] }) {
  if (positions.length === 0) return <EmptyState text="Позиции пока не сформированы. Они появятся после применения операций покупки/продажи." />;

  const defaultDate = todayIsoDate();
  const groups = groupPositionsByAssetType(positions);

  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-surface" data-testid="positions-view">
      <div className="border-b border-border p-6">
        <h2 className="text-lg font-semibold">Текущие позиции</h2>
        <p className="mt-2 text-sm text-muted">Расчёт строится из операций и последней ручной рыночной оценки. Позиции сгруппированы по классу актива.</p>
      </div>
      {groups.map((group) => (
        <div className="border-b border-border last:border-0" key={group.assetType}>
          <div className="flex flex-wrap items-center justify-between gap-3 bg-background px-5 py-3">
            <h3 className="font-semibold">{assetTypeLabel(group.assetType)}</h3>
            <p className="text-xs text-muted">
              {group.positions.length} поз. · {formatMoney(group.totalValue, group.positions[0]?.currency_code ?? "RUB")} · P&L {formatSignedMoney(group.totalPnl, group.positions[0]?.currency_code ?? "RUB")}
            </p>
          </div>
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className="border-b border-border text-muted">
              <tr>
                <th className="px-5 py-4 font-medium">Актив</th>
                <th className="px-5 py-4 font-medium">Счёт</th>
                <th className="px-5 py-4 font-medium">Количество</th>
                <th className="px-5 py-4 font-medium">Средняя цена</th>
                <th className="px-5 py-4 font-medium">Балансовая стоимость</th>
                <th className="px-5 py-4 font-medium">Текущая цена</th>
                <th className="px-5 py-4 font-medium">Рыночная стоимость</th>
                <th className="px-5 py-4 font-medium">P&L</th>
                <th className="px-5 py-4 font-medium">Обновить цену</th>
              </tr>
            </thead>
            <tbody>
              {group.positions.map((position) => (
              <tr className="border-b border-border last:border-0" key={position.id}>
              <td className="px-5 py-4">
                <p className="font-medium">{position.asset_name}</p>
                <p className="mt-1 text-xs text-muted">{position.ticker ?? "—"}</p>
              </td>
              <td className="px-5 py-4 text-muted">{position.account_name}</td>
              <td className="px-5 py-4 font-medium">{formatNumber(position.quantity, 6)}</td>
              <td className="px-5 py-4 text-muted">{position.average_price === null ? "—" : formatMoney(position.average_price, position.currency_code)}</td>
              <td className="px-5 py-4 font-medium">{formatMoney(position.book_value, position.currency_code)}</td>
              <td className="px-5 py-4 text-muted">{position.market_price === null ? "—" : formatMoney(position.market_price, position.currency_code)}</td>
              <td className="px-5 py-4 font-medium">{position.market_value === null ? "—" : formatMoney(position.market_value, position.currency_code)}</td>
              <td className={position.unrealized_pnl !== null && position.unrealized_pnl >= 0 ? "px-5 py-4 text-emerald-700" : "px-5 py-4 text-red-700"}>
                {position.unrealized_pnl === null ? "—" : formatSignedMoney(position.unrealized_pnl, position.currency_code)}
                {position.valuation_date && <span className="mt-1 block text-xs text-muted">{position.valuation_date}</span>}
              </td>
              <td className="px-5 py-4">
                {canEdit && position.asset_id ? (
                  <form action={saveManualPositionPrice} className="grid min-w-52 gap-2">
                    <input name="account_id" type="hidden" value={position.account_id} />
                    <input name="asset_id" type="hidden" value={position.asset_id} />
                    <input name="currency_code" type="hidden" value={position.currency_code} />
                    <div className="flex gap-2">
                      <input
                        className="h-9 w-24 rounded-xl border border-border bg-background px-3 text-xs"
                        defaultValue={position.market_price ?? position.average_price ?? ""}
                        min="0.0000001"
                        name="market_price"
                        placeholder="Цена"
                        required
                        step="0.0000001"
                        type="number"
                      />
                      <input
                        className="h-9 w-32 rounded-xl border border-border bg-background px-3 text-xs"
                        defaultValue={position.valuation_date ?? defaultDate}
                        name="snapshot_date"
                        required
                        type="date"
                      />
                    </div>
                    <button className="h-9 rounded-xl bg-accent px-3 text-xs font-medium text-white" type="submit">
                      Сохранить
                    </button>
                  </form>
                ) : "—"}
              </td>
            </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function AssetDetailView({ asset, data }: { asset: PortfolioData["assets"][number]; data: PortfolioData }) {
  const assetPositions = data.positions.filter((position) => position.asset_id === asset.id);
  const assetOperations = data.operations.filter((operation) => operation.asset_id === asset.id);
  const quantity = assetPositions.reduce((total, position) => total + position.quantity, 0);
  const bookValue = assetPositions.reduce((total, position) => total + position.book_value, 0);
  const marketValue = assetPositions.reduce((total, position) => total + (position.market_value ?? position.book_value), 0);
  const pnl = assetPositions.reduce((total, position) => total + (position.unrealized_pnl ?? 0), 0);
  const currency = asset.currency_code ?? assetPositions[0]?.currency_code ?? data.family?.baseCurrency ?? "RUB";
  const latestValuationDate = assetPositions
    .map((position) => position.valuation_date)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const isWatched = data.watchlistItems.some((item) => item.item_type === "asset" && item.asset_id === asset.id);
  const canEdit = canEditFamilyData(data.family?.role);
  const defaultScenarioPosition = assetPositions[0];
  const assetScenarioHref = `/what-if?asset_id=${encodeURIComponent(asset.id)}${defaultScenarioPosition ? `&account_id=${encodeURIComponent(defaultScenarioPosition.account_id)}&currency_code=${encodeURIComponent(defaultScenarioPosition.currency_code)}&price=${encodeURIComponent(String(defaultScenarioPosition.market_price ?? defaultScenarioPosition.average_price ?? ""))}` : ""}`;

  return (
    <section className="space-y-6 rounded-3xl border border-border bg-surface p-6" data-testid="asset-detail">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted">{assetTypeLabel(asset.asset_type_code)} · {asset.status}</p>
          <h2 className="mt-2 text-2xl font-semibold">{asset.name}</h2>
          <p className="mt-2 text-sm text-muted">
            {asset.ticker ?? "Без тикера"} · {asset.isin ?? "ISIN не указан"} · {asset.market ?? "рынок не указан"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="rounded-2xl bg-accent px-4 py-2 text-sm font-medium text-white" href={assetScenarioHref}>
            What-if
          </Link>
          {canEdit && !isWatched && (
            <form action={addAssetToWatchlist}>
              <input name="return_to" type="hidden" value="/assets" />
              <input name="asset_id" type="hidden" value={asset.id} />
              <button className="rounded-2xl bg-accent px-4 py-2 text-sm font-medium text-white" type="submit">
                В watchlist
              </button>
            </form>
          )}
          {isWatched && <span className="rounded-2xl bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">В watchlist</span>}
          <Link className="rounded-2xl border border-border px-4 py-2 text-sm font-medium text-muted" href="/assets">Закрыть карточку</Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        <MetricCard label="Количество" value={formatNumber(quantity, 6)} hint={`Позиций: ${assetPositions.length}`} />
        <MetricCard label="Балансовая стоимость" value={formatMoney(bookValue, currency)} hint="По средней цене" />
        <MetricCard label="Текущая стоимость" value={formatMoney(marketValue, currency)} hint={latestValuationDate ? `Оценка: ${latestValuationDate}` : "Без ручной цены"} />
        <MetricCard label="P&L" value={formatSignedMoney(pnl, currency)} hint="Нереализованный" />
        <MetricCard label="Операции" value={assetOperations.length} hint="По выбранному активу" />
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-background">
        <div className="border-b border-border p-4">
          <h3 className="font-semibold">Позиции по счетам</h3>
        </div>
        {assetPositions.length === 0 ? <div className="p-4 text-sm text-muted">Открытых позиций по активу пока нет.</div> : (
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="border-b border-border text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Счёт</th>
                <th className="px-4 py-3 font-medium">Количество</th>
                <th className="px-4 py-3 font-medium">Средняя цена</th>
                <th className="px-4 py-3 font-medium">Текущая цена</th>
                <th className="px-4 py-3 font-medium">Стоимость</th>
                <th className="px-4 py-3 font-medium">P&L</th>
                <th className="px-4 py-3 font-medium">Обновить цену</th>
              </tr>
            </thead>
            <tbody>
              {assetPositions.map((position) => (
                <tr className="border-b border-border last:border-0" key={position.id}>
                  <td className="px-4 py-3 font-medium">{position.account_name}</td>
                  <td className="px-4 py-3 text-muted">{formatNumber(position.quantity, 6)}</td>
                  <td className="px-4 py-3 text-muted">{position.average_price === null ? "—" : formatMoney(position.average_price, position.currency_code)}</td>
                  <td className="px-4 py-3 text-muted">{position.market_price === null ? "—" : formatMoney(position.market_price, position.currency_code)}</td>
                  <td className="px-4 py-3 font-medium">{formatMoney(position.market_value ?? position.book_value, position.currency_code)}</td>
                  <td className={position.unrealized_pnl !== null && position.unrealized_pnl >= 0 ? "px-4 py-3 text-emerald-700" : "px-4 py-3 text-red-700"}>
                    {position.unrealized_pnl === null ? "—" : formatSignedMoney(position.unrealized_pnl, position.currency_code)}
                  </td>
                  <td className="px-4 py-3">
                    {canEditFamilyData(data.family?.role) && position.asset_id ? (
                      <form action={saveManualPositionPrice} className="flex min-w-72 gap-2">
                        <input name="account_id" type="hidden" value={position.account_id} />
                        <input name="asset_id" type="hidden" value={position.asset_id} />
                        <input name="currency_code" type="hidden" value={position.currency_code} />
                        <input className="h-9 w-24 rounded-xl border border-border bg-background px-3 text-xs" defaultValue={position.market_price ?? position.average_price ?? ""} min="0.0000001" name="market_price" placeholder="Цена" required step="0.0000001" type="number" />
                        <input className="h-9 w-32 rounded-xl border border-border bg-background px-3 text-xs" defaultValue={position.valuation_date ?? todayIsoDate()} name="snapshot_date" required type="date" />
                        <button className="h-9 rounded-xl bg-accent px-3 text-xs font-medium text-white" type="submit">OK</button>
                      </form>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <OperationsView accounts={data.accounts} assets={data.assets} canCancel={data.family?.role === "admin"} operations={assetOperations} returnTo="/assets" />
    </section>
  );
}

function AssetsView({
  data,
  positionFilters,
  operationCancelled,
  operationError,
  operationSaved,
  priceError,
  priced,
  selectedAssetId,
}: {
  data: PortfolioData;
  positionFilters: PositionFilterInput;
  operationCancelled?: string;
  operationError?: string;
  operationSaved?: string;
  priceError?: string;
  priced?: string;
  selectedAssetId?: string;
}) {
  const { assets, positions } = data;
  const selectedAsset = selectedAssetId ? assets.find((asset) => asset.id === selectedAssetId) : null;
  const filteredPositions = filterAndSortPositions(positions, positionFilters);
  const assetTypes = Array.from(new Set(positions.map((position) => position.asset_type_code).filter((value): value is string => Boolean(value)))).sort();
  const currencies = Array.from(new Set(positions.map((position) => position.currency_code))).sort();
  const canEdit = canEditFamilyData(data.family?.role);
  const watchedAssetIds = new Set(data.watchlistItems.filter((item) => item.item_type === "asset").map((item) => item.asset_id).filter(Boolean));

  return (
    <div className="space-y-6" data-testid="assets-view">
      <OperationNotice operationCancelled={operationCancelled} operationError={operationError} operationSaved={operationSaved} />
      <PriceNotice priceError={priceError} priced={priced} />
      <ManualOperationsPanel data={data} returnTo="/assets" />
      {selectedAsset && <AssetDetailView asset={selectedAsset} data={data} />}
      <PositionFiltersForm accounts={data.accounts} assetTypes={assetTypes} currencies={currencies} filters={positionFilters} />
      <PositionsView canEdit={canEdit} positions={filteredPositions} />
      {assets.length === 0 ? <EmptyState text="Активы пока не созданы." /> : (
      <div className="overflow-hidden rounded-3xl border border-border bg-surface">
        <div className="border-b border-border p-6">
          <h2 className="text-lg font-semibold">Справочник активов</h2>
          <p className="mt-2 text-sm text-muted">Все активы семьи, включая те, по которым пока нет открытой позиции.</p>
        </div>
        <table className="w-full min-w-[780px] text-left text-sm">
          <thead className="border-b border-border text-muted">
            <tr>
              <th className="px-5 py-4 font-medium">Актив</th>
              <th className="px-5 py-4 font-medium">Тип</th>
              <th className="px-5 py-4 font-medium">Тикер</th>
              <th className="px-5 py-4 font-medium">ISIN</th>
              <th className="px-5 py-4 font-medium">Рынок</th>
              <th className="px-5 py-4 font-medium">Валюта</th>
              <th className="px-5 py-4 font-medium">Watchlist</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => (
              <tr className={`border-b last:border-0 ${selectedAsset?.id === asset.id ? "bg-accent-soft" : "border-border"}`} key={asset.id}>
                <td className="px-5 py-4 font-medium">{asset.name}</td>
                <td className="px-5 py-4 text-muted">{assetTypeLabel(asset.asset_type_code)}</td>
                <td className="px-5 py-4 text-muted">{asset.ticker ?? "—"}</td>
                <td className="px-5 py-4 text-muted">{asset.isin ?? "—"}</td>
                <td className="px-5 py-4 text-muted">{asset.market ?? "—"}</td>
                <td className="px-5 py-4 text-muted">
                  {asset.currency_code ?? "—"}
                  <Link className="mt-2 block text-xs font-medium text-accent" href={`/assets?asset_id=${encodeURIComponent(asset.id)}`}>
                    Открыть карточку
                  </Link>
                </td>
                <td className="px-5 py-4">
                  {watchedAssetIds.has(asset.id) ? (
                    <span className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">В watchlist</span>
                  ) : canEdit ? (
                    <form action={addAssetToWatchlist}>
                      <input name="return_to" type="hidden" value="/assets" />
                      <input name="asset_id" type="hidden" value={asset.id} />
                      <button className="rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium" type="submit">
                        Добавить
                      </button>
                    </form>
                  ) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

function operationTypeLabel(type: string) {
  const labels: Record<string, string> = {
    buy: "Покупка",
    sell: "Продажа",
    dividend: "Дивиденд",
    coupon: "Купон",
    tax: "Налог",
    fee: "Комиссия",
    deposit: "Пополнение",
    withdrawal: "Вывод",
    fx: "FX",
    transfer_in: "Перевод входящий",
    transfer_out: "Перевод исходящий",
    split: "Сплит",
    price_snapshot: "Цена",
    other: "Другое",
  };
  return labels[type] ?? type;
}

function OperationsView({
  accounts = [],
  assets = [],
  canCancel = false,
  operations,
  returnTo = "/dashboard",
}: {
  accounts?: Account[];
  assets?: PortfolioData["assets"];
  canCancel?: boolean;
  operations: Operation[];
  returnTo?: "/accounts" | "/assets" | "/dashboard";
}) {
  if (operations.length === 0) return <EmptyState text="Операций пока нет. Они появятся после применения строк импорта." />;

  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));

  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-surface" data-testid="operations-view">
      <div className="border-b border-border p-6">
        <h2 className="text-lg font-semibold">Операции</h2>
        <p className="mt-2 text-sm text-muted">Последние операции портфеля. Импортированные записи не редактируются вручную.</p>
      </div>
      <table className="w-full min-w-[980px] text-left text-sm">
        <thead className="border-b border-border text-muted">
          <tr>
            <th className="px-5 py-4 font-medium">Дата</th>
            <th className="px-5 py-4 font-medium">Тип</th>
            <th className="px-5 py-4 font-medium">Счёт</th>
            <th className="px-5 py-4 font-medium">Актив</th>
            <th className="px-5 py-4 font-medium">Количество</th>
            <th className="px-5 py-4 font-medium">Сумма</th>
            <th className="px-5 py-4 font-medium">Источник</th>
            {canCancel && <th className="px-5 py-4 font-medium">Действие</th>}
          </tr>
        </thead>
        <tbody>
          {operations.map((operation) => {
            const account = accountsById.get(operation.account_id);
            const asset = operation.asset_id ? assetsById.get(operation.asset_id) : null;
            const isCancellable = canCancel && operation.source === "manual" && !operation.cancelled_at;

            return (
              <tr className="border-b border-border last:border-0" key={operation.id}>
                <td className="px-5 py-4 text-muted">{operation.trade_date}</td>
                <td className="px-5 py-4 font-medium">
                  {operationTypeLabel(operation.operation_type_code)}
                  {operation.notes && <span className="mt-1 block text-xs font-normal text-muted">{operation.notes}</span>}
                </td>
                <td className="px-5 py-4 text-muted">{account?.name ?? "—"}</td>
                <td className="px-5 py-4 text-muted">{asset?.name ?? "—"}</td>
                <td className="px-5 py-4 text-muted">{operation.quantity === null ? "—" : formatNumber(operation.quantity, 6)}</td>
                <td className="px-5 py-4 font-medium">{formatSignedMoney(operation.net_amount, operation.currency_code)}</td>
                <td className="px-5 py-4 text-muted">{operation.source === "manual" ? "ручная" : "импорт"}</td>
                {canCancel && (
                  <td className="px-5 py-4">
                    {isCancellable ? (
                      <form action={cancelManualOperation} className="flex min-w-56 gap-2">
                        <input name="return_to" type="hidden" value={returnTo} />
                        <input name="operation_id" type="hidden" value={operation.id} />
                        <input className="h-9 w-32 rounded-xl border border-border bg-background px-3 text-xs" name="cancellation_reason" placeholder="Причина" />
                        <button className="h-9 rounded-xl border border-red-200 px-3 text-xs font-medium text-red-700" type="submit">
                          Отменить
                        </button>
                      </form>
                    ) : "—"}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ImportUploadForm({ accounts, canUpload }: { accounts: Account[]; canUpload: boolean }) {
  const activeAccounts = accounts.filter((account) => account.status === "active");

  if (!canUpload) {
    return (
      <div className="rounded-3xl border border-border bg-surface p-6" data-testid="import-readonly">
        <p className="text-sm font-medium text-accent">Режим просмотра</p>
        <h2 className="mt-2 text-xl font-semibold">Импорт доступен только для просмотра</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Роль viewer может смотреть журнал, строки импорта и результаты, но не может загружать, разбирать или применять отчёты.
        </p>
      </div>
    );
  }

  return (
    <form action={uploadBrokerReport} className="rounded-3xl border border-border bg-surface p-6" data-testid="import-upload-form">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-accent">Первый рабочий импорт</p>
          <h2 className="mt-2 text-xl font-semibold">Загрузить брокерский отчёт</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Файл сохранится в private bucket, а в журнале появится запись со статусом “загружен”.
            Разбор CSV, XLS и XLSX уже доступен; PDF подключим следующим шагом.
          </p>
        </div>
        <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">PDF · CSV · XLS · XLSX</span>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-[1fr_1.4fr_auto] md:items-end">
        <label className="grid gap-2 text-sm">
          <span className="font-medium">Счёт</span>
          <select className="h-11 rounded-2xl border border-border bg-background px-4" data-testid="import-account-select" disabled={activeAccounts.length === 0} name="account_id" required>
            <option value="">Выберите счёт</option>
            {activeAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} · {account.currency_code}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-2 text-sm">
          <span className="font-medium">Файл отчёта</span>
          <input
            accept=".pdf,.csv,.xls,.xlsx,application/pdf,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="rounded-2xl border border-border bg-background px-4 py-2.5 text-sm"
            data-testid="import-file-input"
            name="report"
            required
            type="file"
          />
        </label>

        <button className="h-11 rounded-2xl bg-accent px-5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50" data-testid="import-upload-button" disabled={activeAccounts.length === 0} type="submit">
          Загрузить
        </button>
      </div>
    </form>
  );
}

function ImportNotice({
  applied,
  applyError,
  deleted,
  deleteError,
  error,
  parsed,
  parseError,
  reconciled,
  reconcileError,
  uploaded,
}: {
  applied?: string;
  applyError?: string;
  deleted?: string;
  deleteError?: string;
  error?: string;
  parsed?: string;
  parseError?: string;
  reconciled?: string;
  reconcileError?: string;
  uploaded?: string;
}) {
  const errors: Record<string, string> = {
    "no-family": "Для пользователя не назначена семья.",
    forbidden: "У роли viewer нет права загружать отчёты.",
    "account-required": "Выберите счёт для импорта.",
    "account-not-found": "Выбранный счёт не найден или недоступен.",
    "file-required": "Выберите файл отчёта.",
    "file-too-large": "Файл больше лимита 50 MB.",
    "file-type": "Поддерживаются только PDF, CSV, XLS и XLSX.",
    duplicate: "Такой файл уже загружался для выбранного счёта.",
  };
  const parseErrors: Record<string, string> = {
    "no-family": "Для пользователя не назначена семья.",
    forbidden: "У роли viewer нет права разбирать отчёты.",
    "import-required": "Не выбран импорт для разбора.",
    "import-not-found": "Импорт не найден или недоступен.",
    "csv-only": "Сейчас поддержан разбор CSV, XLS и XLSX. PDF добавим следующим шагом.",
    "unsupported-format": "Для разбора сейчас поддержаны CSV, XLS и XLSX.",
    "download-failed": "Не удалось скачать файл из private bucket.",
    "empty-csv": "В CSV нет строк данных.",
    "empty-file": "В файле нет поддержанных строк данных.",
    "row-validation": "Файл разобран, но часть строк не прошла базовую проверку.",
  };
  const applyErrors: Record<string, string> = {
    "no-family": "Для пользователя не назначена семья.",
    forbidden: "У роли viewer нет права применять импорт.",
    "import-required": "Не выбран импорт для применения.",
    "import-not-found": "Импорт не найден или недоступен.",
    "account-required": "У импорта нет привязанного счёта.",
    "no-normalized-rows": "Нет нормализованных строк для применения.",
    "row-apply": "Часть строк не удалось превратить в операции.",
  };
  const reconcileErrors: Record<string, string> = {
    "no-family": "Для пользователя не назначена семья.",
    forbidden: "У роли viewer нет права сверять строки импорта.",
    "row-required": "Не выбрана строка импорта.",
    "row-not-found": "Строка импорта не найдена или недоступна.",
    "row-applied": "Применённую строку нельзя исключить из импорта.",
    "row-not-skipped": "Вернуть можно только строку со статусом “пропущено”.",
  };
  const deleteErrors: Record<string, string> = {
    "no-family": "Для пользователя не назначена семья.",
    forbidden: "Удаление ошибочного импорта доступно только роли admin.",
    "import-required": "Не выбран импорт для удаления.",
    "import-not-found": "Импорт не найден или недоступен.",
    "confirm-required": "Для удаления введите DELETE или УДАЛИТЬ.",
    "status-not-deletable": "Удалять можно только ошибочные или отменённые импорты.",
  };

  if (uploaded) return <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">Файл загружен, запись импорта создана.</div>;
  if (parsed) return <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">Файл разобран, строки импорта сохранены.</div>;
  if (applied) return <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">Импорт применён, операции портфеля созданы.</div>;
  if (reconciled) return <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">Сверка строки сохранена.</div>;
  if (deleted) return <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">Ошибочный импорт удалён вместе с файлом из private bucket.</div>;
  if (parseError) return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{parseErrors[parseError] ?? "Не удалось разобрать файл."}</div>;
  if (applyError) return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{applyErrors[applyError] ?? "Не удалось применить импорт."}</div>;
  if (reconcileError) return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{reconcileErrors[reconcileError] ?? "Не удалось сохранить сверку строки."}</div>;
  if (deleteError) return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{deleteErrors[deleteError] ?? "Не удалось удалить импорт."}</div>;
  if (!error) return null;
  return <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">{errors[error] ?? "Не удалось загрузить файл."}</div>;
}

function normalizedPreview(value: Record<string, unknown> | null) {
  if (!value) return "—";

  if (value.row_type === "fx_rate") {
    return [value.rate_date, "FX", `${value.currency}/RUB`, value.rate_to_rub]
      .filter((item) => item !== null && item !== undefined && item !== "")
      .join(" · ");
  }

  if (value.row_type === "holding_snapshot") {
    return [value.snapshot_date, value.ticker, value.quantity, value.market_value_amount ?? value.price, value.currency]
      .filter((item) => item !== null && item !== undefined && item !== "")
      .join(" · ");
  }

  if (value.row_type === "cash_operation") {
    return [value.trade_date, value.operation_type, value.amount, value.currency]
      .filter((item) => item !== null && item !== undefined && item !== "")
      .join(" · ");
  }

  const parts = [value.trade_date, value.operation_type, value.ticker, value.quantity, value.price, value.currency]
    .filter((item) => item !== null && item !== undefined && item !== "");
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function summarizeImportRows(rows: PortfolioData["importRows"]) {
  const summary = {
    cashOperations: 0,
    positions: 0,
    cashBalances: 0,
    fxRates: 0,
    skipped: 0,
    failed: 0,
  };

  for (const row of rows) {
    if (row.status === "skipped") summary.skipped += 1;
    if (row.status === "failed") summary.failed += 1;

    const normalized = row.normalized_data;
    if (!normalized) continue;

    if (normalized.row_type === "cash_operation") summary.cashOperations += 1;
    if (normalized.row_type === "fx_rate") summary.fxRates += 1;
    if (normalized.row_type === "holding_snapshot" && normalized.asset_type === "cash") summary.cashBalances += 1;
    if (normalized.row_type === "holding_snapshot" && normalized.asset_type !== "cash") summary.positions += 1;
  }

  return [
    { label: "Денежные операции", value: summary.cashOperations },
    { label: "Позиции", value: summary.positions },
    { label: "Валютные остатки", value: summary.cashBalances },
    { label: "FX-курсы", value: summary.fxRates },
    { label: "Пропущено", value: summary.skipped },
    { label: "Ошибки", value: summary.failed },
  ];
}

function jsonPreview(value: Record<string, unknown> | null) {
  if (!value) return "—";
  return JSON.stringify(value, null, 2);
}

function rawSection(row: PortfolioData["importRows"][number]) {
  const section = row.raw_data.section;
  return typeof section === "string" && section.trim() ? section : "не указана";
}

function reconciliationHint(row: PortfolioData["importRows"][number]) {
  if (row.status === "skipped") return "Строка исключена из применения. Можно вернуть её в обработку.";
  if (row.status === "failed" && row.normalized_data) return "Проверьте ошибку. Если строка не нужна в учёте, исключите её; если правила исправлены, повторите разбор файла.";
  if (row.status === "failed") return "Строка не нормализована. Нужен повторный разбор после исправления файла или парсера.";
  return "Если эта строка не должна попадать в учёт, исключите её из применения.";
}

function canParseBrokerImport(importJob: ImportJob) {
  const fileName = importJob.original_file_name.toLowerCase();
  return [".csv", ".xls", ".xlsx"].some((extension) => fileName.endsWith(extension))
    && ["uploaded", "parsed", "failed"].includes(importJob.status);
}

function canApplyImport(importJob: ImportJob, rows: PortfolioData["importRows"]) {
  return ["parsed", "failed"].includes(importJob.status)
    && rows.some((row) => row.status === "normalized");
}

function canDeleteImport(importJob: ImportJob, role: string | undefined) {
  return role === "admin" && ["failed", "cancelled"].includes(importJob.status);
}

function ReconciliationRows({ canEdit, rows }: { canEdit: boolean; rows: PortfolioData["importRows"] }) {
  const reconciliationRows = rows.filter((row) => row.status === "failed" || row.status === "skipped");
  if (reconciliationRows.length === 0) return null;

  return (
    <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-amber-950">Сверка проблемных строк</p>
          <p className="mt-1 max-w-3xl text-xs text-amber-900">
            Ручное редактирование нормализации в этом этапе не включено: строку можно исключить из применения,
            вернуть в обработку или повторно разобрать файл после исправления правил.
          </p>
        </div>
        <span className="rounded-full bg-white/70 px-3 py-1 text-xs text-amber-900">Строк: {reconciliationRows.length}</span>
      </div>

      <div className="mt-4 space-y-3">
        {reconciliationRows.map((row) => (
          <div className="rounded-2xl border border-amber-200 bg-white p-4" data-testid="reconciliation-row" key={row.id}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Строка {row.row_number} · {statusLabel(row.status)}</p>
                <p className="mt-1 text-xs text-muted">Секция: {rawSection(row)}</p>
                <p className="mt-2 text-xs text-amber-900">{reconciliationHint(row)}</p>
                {row.error_message && <p className="mt-2 text-xs text-red-700">{row.error_message}</p>}
              </div>

              {canEdit && (
              <div className="flex flex-wrap gap-2">
                {row.status !== "skipped" && row.status !== "applied" && (
                  <form action={skipImportRow}>
                    <input name="row_id" type="hidden" value={row.id} />
                    <button className="rounded-xl border border-amber-300 px-3 py-2 text-xs font-medium text-amber-950" type="submit">
                      Исключить
                    </button>
                  </form>
                )}
                {row.status === "skipped" && (
                  <form action={restoreImportRow}>
                    <input name="row_id" type="hidden" value={row.id} />
                    <button className="rounded-xl bg-accent px-3 py-2 text-xs font-medium text-white" type="submit">
                      Вернуть
                    </button>
                  </form>
                )}
              </div>
              )}
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <details className="rounded-xl border border-border bg-background p-3" data-testid="import-row-raw-details">
                <summary className="cursor-pointer text-xs font-medium">Raw-данные</summary>
                <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap text-[11px] text-muted">{jsonPreview(row.raw_data)}</pre>
              </details>
              <details className="rounded-xl border border-border bg-background p-3" data-testid="import-row-normalized-details">
                <summary className="cursor-pointer text-xs font-medium">Normalized-данные</summary>
                <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap text-[11px] text-muted">{jsonPreview(row.normalized_data)}</pre>
              </details>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ImportsView({ data }: { data: PortfolioData }) {
  if (data.imports.length === 0) return <EmptyState text="Файлы ещё не загружались. Контур импорта и private bucket уже готовы." />;

  const accountsById = new Map(data.accounts.map((account) => [account.id, account]));
  const familyRole = data.family?.role;
  const canEdit = canEditFamilyData(familyRole);

  return (
    <div className="space-y-3" data-testid="import-list">
      {data.imports.map((importJob) => {
        const rows = data.importRows.filter((row) => row.import_id === importJob.id);
        const summary = summarizeImportRows(rows);
        const account = importJob.account_id ? accountsById.get(importJob.account_id) : null;

        return (
          <div className="rounded-2xl border border-border bg-surface p-4" data-import-id={importJob.id} data-status={importJob.status} data-testid="import-card" key={importJob.id}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="font-medium">{importJob.original_file_name}</p>
                <p className="mt-1 text-sm text-muted">
                  Статус: {importStatusLabel(importJob, rows)} · {formatFileSize(importJob.file_size_bytes)}
                </p>
                <p className="mt-1 text-sm text-muted">
                  Счёт: {account ? `${account.name} · ${account.currency_code}` : "не указан"} · Загружен: {formatDateTime(importJob.created_at)}
                </p>
                <p className="mt-2 break-all text-xs text-muted">{importJob.storage_object_key}</p>
              </div>
              <span className="rounded-full bg-background px-3 py-1 text-xs text-muted">SHA-256: {importJob.sha256.slice(0, 10)}…</span>
            </div>

            {importJob.error_message && (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                {importJob.error_message}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              {canEdit && canParseBrokerImport(importJob) && (
                <form action={parseBrokerImport}>
                  <input name="import_id" type="hidden" value={importJob.id} />
                  <button className="rounded-2xl bg-accent px-4 py-2 text-xs font-medium text-white" data-testid="import-parse-button" type="submit">
                    Разобрать файл
                  </button>
                </form>
              )}
              {canEdit && canApplyImport(importJob, rows) && (
                <form action={applyBrokerImport}>
                  <input name="import_id" type="hidden" value={importJob.id} />
                  <button className="rounded-2xl bg-emerald-600 px-4 py-2 text-xs font-medium text-white" data-testid="import-apply-button" type="submit">
                    Применить в операции
                  </button>
                </form>
              )}
              {rows.length > 0 && <span className="rounded-full bg-background px-3 py-1 text-xs text-muted">Строк: {rows.length}</span>}
            </div>

            {canDeleteImport(importJob, familyRole) && (
              <form action={deleteFailedImport} className="mt-4 flex flex-wrap items-end gap-3 rounded-2xl border border-red-200 bg-red-50 p-3">
                <input name="import_id" type="hidden" value={importJob.id} />
                <label className="grid gap-1 text-xs text-red-950">
                  <span>Подтвердите удаление: DELETE или УДАЛИТЬ</span>
                  <input
                    className="h-9 w-44 rounded-xl border border-red-200 bg-white px-3 text-xs text-foreground"
                    name="confirm"
                    placeholder="DELETE"
                    required
                  />
                </label>
                <button className="h-9 rounded-xl bg-red-700 px-3 text-xs font-medium text-white" type="submit">
                  Удалить ошибочный импорт
                </button>
              </form>
            )}

            {rows.length > 0 && (
              <div className="mt-4 grid gap-2 md:grid-cols-3 xl:grid-cols-6" data-testid="import-row-summary">
                {summary.map((item) => (
                  <div className="rounded-2xl border border-border bg-background px-3 py-2" key={item.label}>
                    <p className="text-[11px] uppercase tracking-wide text-muted">{item.label}</p>
                    <p className="mt-1 text-lg font-semibold">{item.value}</p>
                  </div>
                ))}
              </div>
            )}

            <ReconciliationRows canEdit={canEdit} rows={rows} />

            {rows.length > 0 && (
              <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-background" data-testid="import-rows-table">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead className="border-b border-border text-muted">
                    <tr>
                      <th className="px-4 py-3 font-medium">Строка</th>
                      <th className="px-4 py-3 font-medium">Статус</th>
                      <th className="px-4 py-3 font-medium">Нормализация</th>
                      <th className="px-4 py-3 font-medium">Ошибка</th>
                      <th className="px-4 py-3 font-medium">Данные</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr className="border-b border-border last:border-0" key={row.id}>
                        <td className="px-4 py-3">{row.row_number}</td>
                        <td className="px-4 py-3">{statusLabel(row.status)}</td>
                        <td className="px-4 py-3 text-muted">{normalizedPreview(row.normalized_data)}</td>
                        <td className="px-4 py-3 text-muted">{row.error_message ?? "—"}</td>
                        <td className="px-4 py-3 text-muted">
                          <details data-testid="import-row-raw-details">
                            <summary className="cursor-pointer">raw</summary>
                            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[11px]">{jsonPreview(row.raw_data)}</pre>
                          </details>
                          <details className="mt-2" data-testid="import-row-normalized-details">
                            <summary className="cursor-pointer">normalized</summary>
                            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[11px]">{jsonPreview(row.normalized_data)}</pre>
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AuditLogView({ entries }: { entries: PortfolioData["auditLog"] }) {
  if (entries.length === 0) {
    return <EmptyState text="Audit-записей пока нет или они недоступны текущей роли." />;
  }

  return (
    <section className="rounded-3xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Audit</h2>
          <p className="mt-2 text-sm text-muted">Последние действия по семье: импорт, сверка, настройки и критичные операции.</p>
        </div>
        <span className="rounded-full bg-background px-3 py-1 text-xs text-muted">Записей: {entries.length}</span>
      </div>

      <div className="mt-5 overflow-hidden rounded-2xl border border-border bg-background">
        <table className="w-full min-w-[860px] text-left text-xs">
          <thead className="border-b border-border text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Дата</th>
              <th className="px-4 py-3 font-medium">Действие</th>
              <th className="px-4 py-3 font-medium">Сущность</th>
              <th className="px-4 py-3 font-medium">Данные</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr className="border-b border-border last:border-0" key={entry.id}>
                <td className="whitespace-nowrap px-4 py-3 text-muted">{formatDateTime(entry.created_at)}</td>
                <td className="px-4 py-3 font-medium">{entry.action}</td>
                <td className="px-4 py-3 text-muted">
                  {entry.entity_table}
                  {entry.entity_id && <span className="block max-w-48 truncate text-[11px]">{entry.entity_id}</span>}
                </td>
                <td className="px-4 py-3 text-muted">
                  <details>
                    <summary className="cursor-pointer">after/before</summary>
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[11px]">{jsonPreview(entry.after_data ?? entry.before_data)}</pre>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LimitScopeSelect({ assets, defaultValue = "" }: { assets: PortfolioData["assets"]; defaultValue?: string | null }) {
  const assetTypes = Array.from(new Set(assets.map((asset) => asset.asset_type_code))).filter(Boolean).sort();
  const currencies = Array.from(new Set(assets.map((asset) => asset.currency_code).filter(Boolean))).sort();

  return (
    <label className="grid gap-2 text-sm">
      <span className="font-medium">Scope key</span>
      <input className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" defaultValue={defaultValue ?? ""} list="limit-scope-options" name="scope_key" placeholder="stock, RUB или asset_id" />
      <datalist id="limit-scope-options">
        {assetTypes.map((type) => <option key={`type-${type}`} value={type} />)}
        {currencies.map((currency) => <option key={`currency-${currency}`} value={currency ?? ""} />)}
        {assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
      </datalist>
    </label>
  );
}

function LimitsSettingsView({ data }: { data: PortfolioData }) {
  const canManage = canManageFamily(data.family?.role);
  const activeLimitAlerts = data.systemAlerts.filter((alert) => alert.source === "limits");

  return (
    <section className="rounded-3xl border border-border bg-surface p-6" data-testid="limits-settings">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Лимиты и алерты</h2>
          <p className="mt-2 text-sm text-muted">Пороги проверяются по текущей аналитике портфеля и создают системные алерты без дублей.</p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <form action={createDefaultLimits}>
              <input name="return_to" type="hidden" value="/settings" />
              <button className="rounded-2xl border border-border px-4 py-2 text-sm font-medium" data-testid="create-default-limits-button" type="submit">
                Создать базовые
              </button>
            </form>
            <form action={checkLimits}>
              <input name="return_to" type="hidden" value="/settings" />
              <button className="rounded-2xl bg-accent px-4 py-2 text-sm font-medium text-white" data-testid="check-limits-button" type="submit">
                Проверить лимиты
              </button>
            </form>
          </div>
        )}
      </div>

      <div className="mt-5 grid gap-6 xl:grid-cols-[1fr_1fr]">
        <div>
          <h3 className="text-sm font-semibold">Активные лимиты</h3>
          <div className="mt-3 space-y-3">
            {data.limits.map((limit) => (
              <div className="rounded-2xl border border-border bg-background p-4" data-limit-id={limit.id} data-testid="limit-card" key={limit.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{limitTypeLabel(limit.limit_type)}</p>
                    <p className="mt-1 text-sm text-muted">
                      {limitDirectionLabel(limit.direction)} {formatPercent(Number(limit.threshold_value))} · {limit.scope_key ?? "портфель"} · {severityLabel(limit.severity)}
                    </p>
                  </div>
                  {canManage && (
                    <form action={archiveLimit}>
                      <input name="return_to" type="hidden" value="/settings" />
                      <input name="limit_id" type="hidden" value={limit.id} />
                      <button className="rounded-xl border border-border px-3 py-2 text-xs font-medium text-muted" type="submit">
                        Архив
                      </button>
                    </form>
                  )}
                </div>
                {canManage && (
                  <form action={updateLimit} className="mt-4 grid gap-3 border-t border-border pt-4">
                    <input name="return_to" type="hidden" value="/settings" />
                    <input name="limit_id" type="hidden" value={limit.id} />
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="grid gap-2 text-xs">
                        <span className="font-medium">Тип</span>
                        <select className="h-9 rounded-xl border border-border bg-background px-3 text-xs" name="limit_type" defaultValue={limit.limit_type}>
                          <option value="asset_class_share">Доля класса</option>
                          <option value="currency_share">Доля валюты</option>
                          <option value="asset_share">Доля актива</option>
                          <option value="cash_min_share">Кэш минимум</option>
                          <option value="cash_max_share">Кэш максимум</option>
                        </select>
                      </label>
                      <label className="grid gap-2 text-xs">
                        <span className="font-medium">Направление</span>
                        <select className="h-9 rounded-xl border border-border bg-background px-3 text-xs" name="direction" defaultValue={limit.direction}>
                          <option value="max">Максимум</option>
                          <option value="min">Минимум</option>
                        </select>
                      </label>
                      <label className="grid gap-2 text-xs">
                        <span className="font-medium">Важность</span>
                        <select className="h-9 rounded-xl border border-border bg-background px-3 text-xs" name="severity" defaultValue={limit.severity}>
                          <option value="warning">Warning</option>
                          <option value="critical">Critical</option>
                          <option value="info">Info</option>
                        </select>
                      </label>
                    </div>
                    <div className="grid gap-3 md:grid-cols-[1fr_160px_auto]">
                      <label className="grid gap-2 text-xs">
                        <span className="font-medium">Scope key</span>
                        <input className="h-9 rounded-xl border border-border bg-background px-3 text-xs" defaultValue={limit.scope_key ?? ""} list="limit-scope-options" name="scope_key" placeholder="stock, RUB или asset_id" />
                      </label>
                      <label className="grid gap-2 text-xs">
                        <span className="font-medium">Порог</span>
                        <input className="h-9 rounded-xl border border-border bg-background px-3 text-xs" defaultValue={Number(limit.threshold_value)} name="threshold_value" required step="0.0001" type="number" />
                      </label>
                      <button className="self-end rounded-xl bg-accent px-3 py-2 text-xs font-medium text-white" type="submit">
                        Обновить
                      </button>
                    </div>
                  </form>
                )}
              </div>
            ))}
            {data.limits.length === 0 && <EmptyState text="Активных лимитов пока нет." />}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold">Активные алерты</h3>
          <div className="mt-3 space-y-3">
            {activeLimitAlerts.map((alert) => (
              <div className={`rounded-2xl border p-4 ${alert.severity === "critical" ? "border-red-200 bg-red-50 text-red-950" : "border-amber-200 bg-amber-50 text-amber-950"}`} data-testid="limit-alert-card" key={alert.id}>
                <p className="font-medium">{alert.title}</p>
                <p className="mt-1 text-sm opacity-80">
                  {severityLabel(alert.severity)} · {alert.condition_type} · проверено {formatDateTime(alert.last_checked_at)}
                </p>
              </div>
            ))}
            {activeLimitAlerts.length === 0 && <EmptyState text="Активных limit-алертов пока нет." />}
          </div>
        </div>
      </div>

      {canManage && (
        <form action={createLimit} className="mt-6 grid gap-3 rounded-2xl border border-border bg-background p-4" data-testid="create-limit-form">
          <input name="return_to" type="hidden" value="/settings" />
          <div className="grid gap-3 md:grid-cols-3">
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Тип лимита</span>
              <select className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" name="limit_type" required>
                <option value="asset_class_share">Доля класса</option>
                <option value="currency_share">Доля валюты</option>
                <option value="asset_share">Доля актива</option>
                <option value="cash_min_share">Кэш минимум</option>
                <option value="cash_max_share">Кэш максимум</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Направление</span>
              <select className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" name="direction" required>
                <option value="max">Максимум</option>
                <option value="min">Минимум</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Важность</span>
              <select className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" name="severity" required>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
                <option value="info">Info</option>
              </select>
            </label>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <LimitScopeSelect assets={data.assets} />
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Порог</span>
              <input className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" name="threshold_value" placeholder="0.35 или 35" required step="0.0001" type="number" />
            </label>
          </div>
          <button className="h-11 rounded-2xl bg-accent px-5 text-sm font-medium text-white" data-testid="create-limit-button" type="submit">
            Создать лимит
          </button>
        </form>
      )}
    </section>
  );
}

function TelegramSettingsView({ data }: { data: PortfolioData }) {
  const canManage = canManageFamily(data.family?.role);
  const telegram = data.notificationPreferences.find((preference) => preference.channel === "telegram");
  const settings = telegram?.settings ?? {};
  const chatId = typeof settings.chat_id === "string" ? settings.chat_id : "";
  const messageThreadId = typeof settings.message_thread_id === "string" ? settings.message_thread_id : "";
  const deliveries = data.notificationDeliveries.filter((delivery) => delivery.channel === "telegram").slice(0, 6);

  return (
    <section className="rounded-3xl border border-border bg-surface p-6" data-testid="telegram-settings">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Telegram</h2>
          <p className="mt-2 text-sm text-muted">Уведомления отправляются сервером через `TELEGRAM_BOT_TOKEN`; токен не хранится в UI.</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${telegram?.status === "enabled" ? "bg-emerald-50 text-emerald-700" : "bg-background text-muted"}`}>
          {telegram?.status === "enabled" ? "enabled" : "disabled"}
        </span>
      </div>

      {canManage && (
        <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_auto]">
          <form action={saveTelegramSettings} className="grid gap-3 rounded-2xl border border-border bg-background p-4">
            <input name="return_to" type="hidden" value="/settings" />
            <div className="grid gap-3 md:grid-cols-3">
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Статус</span>
                <select className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" name="status" defaultValue={telegram?.status ?? "disabled"}>
                  <option value="enabled">Enabled</option>
                  <option value="disabled">Disabled</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Chat ID</span>
                <input className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" defaultValue={chatId} name="chat_id" placeholder="-100..." />
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Thread ID</span>
                <input className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" defaultValue={messageThreadId} name="message_thread_id" placeholder="Опционально" />
              </label>
            </div>
            <button className="h-11 rounded-2xl bg-accent px-5 text-sm font-medium text-white" type="submit">
              Сохранить Telegram
            </button>
          </form>

          <form action={testTelegramNotification} className="rounded-2xl border border-border bg-background p-4">
            <input name="return_to" type="hidden" value="/settings" />
            <button className="h-11 rounded-2xl border border-border px-5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50" disabled={telegram?.status !== "enabled"} type="submit">
              Тестовая отправка
            </button>
            <p className="mt-3 max-w-64 text-xs text-muted">Если env `TELEGRAM_BOT_TOKEN` не задан, доставка будет записана как skipped.</p>
          </form>
        </div>
      )}

      <div className="mt-5">
        <h3 className="text-sm font-semibold">Последние доставки</h3>
        <div className="mt-3 space-y-3">
          {deliveries.map((delivery) => (
            <div className="rounded-2xl border border-border bg-background p-4" key={delivery.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{delivery.status}</p>
                  <p className="mt-1 text-sm text-muted">{delivery.error_message ?? "без ошибки"}</p>
                </div>
                <span className="text-xs text-muted">{formatDateTime(delivery.sent_at ?? delivery.created_at)}</span>
              </div>
            </div>
          ))}
          {deliveries.length === 0 && <EmptyState text="Доставок Telegram пока нет." />}
        </div>
      </div>
    </section>
  );
}

function MaxSettingsView({ data }: { data: PortfolioData }) {
  const canManage = canManageFamily(data.family?.role);
  const max = data.notificationPreferences.find((preference) => preference.channel === "max");
  const settings = max?.settings ?? {};
  const recipientType = settings.recipient_type === "chat" ? "chat" : "user";
  const userId = typeof settings.user_id === "string" ? settings.user_id : "";
  const chatId = typeof settings.chat_id === "string" ? settings.chat_id : "";
  const deliveries = data.notificationDeliveries.filter((delivery) => delivery.channel === "max").slice(0, 6);

  return (
    <section className="rounded-3xl border border-border bg-surface p-6" data-testid="max-settings">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">MAX</h2>
          <p className="mt-2 text-sm text-muted">Уведомления отправляются сервером через `MAX_BOT_TOKEN`; токен не хранится в UI.</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${max?.status === "enabled" ? "bg-emerald-50 text-emerald-700" : "bg-background text-muted"}`}>
          {max?.status === "enabled" ? "enabled" : "disabled"}
        </span>
      </div>

      {canManage && (
        <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_auto]">
          <form action={saveMaxSettings} className="grid gap-3 rounded-2xl border border-border bg-background p-4">
            <input name="return_to" type="hidden" value="/settings" />
            <div className="grid gap-3 md:grid-cols-4">
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Статус</span>
                <select className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" name="status" defaultValue={max?.status ?? "disabled"}>
                  <option value="enabled">Enabled</option>
                  <option value="disabled">Disabled</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Получатель</span>
                <select className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" name="recipient_type" defaultValue={recipientType}>
                  <option value="user">User ID</option>
                  <option value="chat">Chat ID</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium">User ID</span>
                <input className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" defaultValue={userId} name="user_id" placeholder="Опционально" />
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Chat ID</span>
                <input className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" defaultValue={chatId} name="chat_id" placeholder="Опционально" />
              </label>
            </div>
            <button className="h-11 rounded-2xl bg-accent px-5 text-sm font-medium text-white" type="submit">
              Сохранить MAX
            </button>
          </form>

          <form action={testMaxNotification} className="rounded-2xl border border-border bg-background p-4">
            <input name="return_to" type="hidden" value="/settings" />
            <button className="h-11 rounded-2xl border border-border px-5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50" disabled={max?.status !== "enabled"} type="submit">
              Тестовая отправка
            </button>
            <p className="mt-3 max-w-64 text-xs text-muted">Если env `MAX_BOT_TOKEN` не задан, доставка будет записана как skipped.</p>
          </form>
        </div>
      )}

      <div className="mt-5">
        <h3 className="text-sm font-semibold">Последние доставки</h3>
        <div className="mt-3 space-y-3">
          {deliveries.map((delivery) => (
            <div className="rounded-2xl border border-border bg-background p-4" key={delivery.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{delivery.status}</p>
                  <p className="mt-1 text-sm text-muted">{delivery.error_message ?? "без ошибки"}</p>
                </div>
                <span className="text-xs text-muted">{formatDateTime(delivery.sent_at ?? delivery.created_at)}</span>
              </div>
            </div>
          ))}
          {deliveries.length === 0 && <EmptyState text="Доставок MAX пока нет." />}
        </div>
      </div>
    </section>
  );
}

function SettingsView({ data, settingsError, settingsSaved, stage5Error, stage5Saved }: { data: PortfolioData; settingsError?: string; settingsSaved?: string; stage5Error?: string; stage5Saved?: string }) {
  const canEdit = canEditFamilyData(data.family?.role);

  return (
    <div className="space-y-6">
      <SettingsNotice settingsError={settingsError} settingsSaved={settingsSaved} />
      <Stage5Notice stage5Error={stage5Error} stage5Saved={stage5Saved} />

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Семья" value={data.family?.name ?? "—"} hint={`Ваша роль: ${data.family?.role ?? "—"}`} />
        <MetricCard label="Базовая валюта" value={data.family?.baseCurrency ?? "—"} hint="Берётся из family settings" />
        <MetricCard label="Хранилище" value="broker-reports" hint="Private bucket для отчётов" />
      </div>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-3xl border border-border bg-surface p-6">
          <h2 className="text-lg font-semibold">Портфели</h2>
          <div className="mt-4 space-y-3">
            {data.portfolios.map((portfolio) => (
              <div className="rounded-2xl border border-border bg-background p-4" key={portfolio.id}>
                <p className="font-medium">{portfolio.name}</p>
                <p className="mt-1 text-sm text-muted">{portfolio.base_currency} · {statusLabel(portfolio.status)}</p>
              </div>
            ))}
            {data.portfolios.length === 0 && <EmptyState text="Портфели пока не созданы." />}
          </div>

          {canEdit && (
            <form action={createPortfolio} className="mt-6 grid gap-3">
              <input className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" name="name" placeholder="Название портфеля" required />
              <input className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" defaultValue={data.family?.baseCurrency ?? "RUB"} maxLength={3} name="base_currency" placeholder="RUB" required />
              <input className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" name="description" placeholder="Описание, опционально" />
              <button className="h-11 rounded-2xl bg-accent px-5 text-sm font-medium text-white" type="submit">
                Создать портфель
              </button>
            </form>
          )}
        </div>

        <div className="rounded-3xl border border-border bg-surface p-6">
          <h2 className="text-lg font-semibold">Счета</h2>
          <div className="mt-4 space-y-3">
            {data.accounts.map((account) => (
              <div className="rounded-2xl border border-border bg-background p-4" key={account.id}>
                <p className="font-medium">{account.name}</p>
                <p className="mt-1 text-sm text-muted">{accountTypeLabel(account.account_type_code)} · {account.currency_code} · {account.institution_name ?? "организация не указана"}</p>
              </div>
            ))}
            {data.accounts.length === 0 && <EmptyState text="Счета пока не созданы." />}
          </div>

          {canEdit && (
            <form action={createAccount} className="mt-6 grid gap-3">
              <select className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" disabled={data.portfolios.length === 0} name="portfolio_id" required>
                <option value="">Выберите портфель</option>
                {data.portfolios.map((portfolio) => (
                  <option key={portfolio.id} value={portfolio.id}>{portfolio.name}</option>
                ))}
              </select>
              <input className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" name="name" placeholder="Название счёта" required />
              <input className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" name="institution_name" placeholder="Брокер или банк" />
              <div className="grid gap-3 md:grid-cols-2">
                <select className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" name="account_type_code" required>
                  <option value="brokerage">Брокерский</option>
                  <option value="iis">ИИС</option>
                  <option value="bank">Банковский</option>
                  <option value="cash">Наличные</option>
                  <option value="other">Другой</option>
                </select>
                <input className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" defaultValue={data.family?.baseCurrency ?? "RUB"} maxLength={3} name="currency_code" placeholder="RUB" required />
              </div>
              <button className="h-11 rounded-2xl bg-accent px-5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50" disabled={data.portfolios.length === 0} type="submit">
                Создать счёт
              </button>
            </form>
          )}
        </div>
      </section>

      <LimitsSettingsView data={data} />
      <TelegramSettingsView data={data} />
      <MaxSettingsView data={data} />
      <AuditLogView entries={data.auditLog} />
    </div>
  );
}

function RecommendationMetrics({ metrics }: { metrics: Record<string, unknown> }) {
  const entries = Object.entries(metrics).filter(([, value]) => value !== null && value !== undefined);
  if (entries.length === 0) return null;

  return (
    <div className="mt-4 grid gap-2 md:grid-cols-3" data-testid="recommendation-metrics">
      {entries.slice(0, 6).map(([key, value]) => (
        <div className="rounded-2xl border border-border bg-surface px-3 py-2" key={key}>
          <p className="text-[11px] uppercase text-muted">{key.replaceAll("_", " ")}</p>
          <p className="mt-1 truncate text-sm font-medium">{String(value)}</p>
        </div>
      ))}
    </div>
  );
}

function Stage5Notice({ stage5Error, stage5Saved }: { stage5Error?: string; stage5Saved?: string }) {
  const errors: Record<string, string> = {
    "no-family": "Для пользователя не назначена семья.",
    forbidden: "У роли viewer нет права изменять данные этого раздела.",
    "asset-not-found": "Связанный актив не найден в текущей семье.",
    "asset-required": "Не выбран актив для сохранения.",
    "news-title-required": "Укажите заголовок новости или идеи.",
    "news-source-required": "Укажите источник новости или идеи.",
    "news-kind-invalid": "Некорректный тип новости.",
    "news-required": "Не выбрана новость для сохранения.",
    "news-not-found": "Новость не найдена.",
    "recommendation-not-found": "Рекомендация не найдена.",
    "recommendation-generated-invalid": "Generated-рекомендацию не удалось сохранить: не хватает данных.",
    "recommendation-status-invalid": "Некорректный статус рекомендации.",
    "watchlist-required": "Не выбран элемент watchlist.",
    "watchlist-status-invalid": "Некорректный статус watchlist.",
    "watchlist-not-found": "Элемент watchlist не найден.",
    "event-required": "Не выбрано событие.",
    "event-title-required": "Укажите название события.",
    "event-type-invalid": "Некорректный тип события.",
    "event-status-invalid": "Некорректный статус события.",
    "event-date-invalid": "Некорректная дата события.",
    "event-amount-invalid": "Некорректная сумма события.",
    "currency-invalid": "Валюта должна быть в формате RUB, USD, EUR.",
    "limit-type-invalid": "Некорректный тип лимита.",
    "limit-direction-invalid": "Некорректное направление лимита.",
    "limit-severity-invalid": "Некорректная важность лимита.",
    "limit-threshold-invalid": "Укажите корректный порог лимита.",
    "limit-scope-required": "Для этого типа лимита нужен scope key.",
    "limit-required": "Не выбран лимит.",
    "limit-not-found": "Лимит не найден.",
    "telegram-status-invalid": "Некорректный статус Telegram.",
    "telegram-chat-required": "Для включения Telegram нужен chat id.",
    "telegram-not-enabled": "Telegram не включен для этой семьи.",
    "max-status-invalid": "Некорректный статус MAX.",
    "max-recipient-invalid": "Некорректный тип получателя MAX.",
    "max-user-required": "Для включения MAX с User ID нужен user id.",
    "max-chat-required": "Для включения MAX с Chat ID нужен chat id.",
    "max-not-enabled": "MAX не включен для этой семьи.",
  };
  const saved: Record<string, string> = {
    news: "Новость или идея сохранена.",
    "watchlist-news": "Материал добавлен в watchlist.",
    "watchlist-asset": "Актив добавлен в watchlist.",
    "watchlist-recommendation": "Рекомендация добавлена в watchlist.",
    "recommendation-status": "Статус рекомендации обновлен.",
    "recommendation-read": "Факт просмотра рекомендации сохранён.",
    watchlist: "Watchlist обновлен.",
    "watchlist-archived": "Элемент watchlist архивирован.",
    event: "Событие создано.",
    "event-updated": "Событие обновлено.",
    limit: "Лимит создан.",
    "limit-updated": "Лимит обновлён.",
    "limit-archived": "Лимит архивирован.",
    "limits-template": "Базовые лимиты созданы.",
    "limits-template-empty": "Базовые лимиты уже были созданы ранее.",
    "limits-checked": "Лимиты проверены, активных нарушений нет.",
    "limits-checked-partial": "Лимиты проверены частично: часть метрик недоступна или неполная. Подробности записаны в audit log.",
    "limits-checked-with-alerts": "Лимиты проверены, активные алерты обновлены.",
    "telegram-settings": "Настройки Telegram сохранены.",
    "telegram-test-sent": "Тестовое Telegram-уведомление отправлено.",
    "telegram-test-skipped": "Тестовая Telegram-доставка пропущена. Проверьте chat id и `TELEGRAM_BOT_TOKEN`.",
    "telegram-test-failed": "Тестовая Telegram-доставка завершилась ошибкой. Подробности записаны в доставки.",
    "max-settings": "Настройки MAX сохранены.",
    "max-test-sent": "Тестовое MAX-уведомление отправлено.",
    "max-test-skipped": "Тестовая MAX-доставка пропущена. Проверьте получателя и `MAX_BOT_TOKEN`.",
    "max-test-failed": "Тестовая MAX-доставка завершилась ошибкой. Подробности записаны в доставки.",
  };

  return (
    <>
      {stage5Error && <div className="rounded-3xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">{errors[stage5Error] ?? stage5Error}</div>}
      {stage5Saved && <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{saved[stage5Saved] ?? "Изменения сохранены."}</div>}
    </>
  );
}

function RecommendationActionFields({ recommendation }: { recommendation: PortfolioData["recommendations"][number] }) {
  return (
    <>
      <input name="recommendation_id" type="hidden" value={recommendation.id} />
      <input name="fingerprint" type="hidden" value={recommendation.fingerprint ?? ""} />
      <input name="title" type="hidden" value={recommendation.title} />
      <input name="body" type="hidden" value={recommendation.body ?? ""} />
      <input name="reason" type="hidden" value={recommendation.reason ?? ""} />
      <input name="priority" type="hidden" value={recommendation.priority} />
      <input name="recommendation_type" type="hidden" value={recommendation.recommendation_type} />
      <input name="confidence" type="hidden" value={recommendation.confidence?.toString() ?? ""} />
    </>
  );
}

function RecommendationsView({ data, filters }: { data: PortfolioData; filters: RecommendationFilterInput }) {
  const readIds = new Set(data.recommendationReads.map((read) => read.recommendation_id));
  const canEdit = canEditFamilyData(data.family?.role);
  const assetById = new Map(data.assets.map((asset) => [asset.id, asset]));
  const accountById = new Map(data.accounts.map((account) => [account.id, account]));
  const accountLinksByRecommendationId = data.recommendationLinks
    .filter((link) => link.entity_table === "accounts")
    .reduce((groups, link) => {
      const links = groups.get(link.recommendation_id) ?? [];
      links.push(link);
      groups.set(link.recommendation_id, links);
      return groups;
    }, new Map<string, typeof data.recommendationLinks>());
  const recommendations = [...data.recommendations]
    .filter((recommendation) => !filters.status || recommendation.status === filters.status)
    .filter((recommendation) => !filters.priority || recommendation.priority === filters.priority)
    .filter((recommendation) => !filters.assetId || recommendation.linkedAssetId === filters.assetId || recommendation.href?.includes(`asset_id=${filters.assetId}`))
    .sort((left, right) => {
    const priorityRank: Record<string, number> = { critical: 4, high: 3, normal: 2, low: 1 };
    if (filters.sort === "date") return right.updated_at.localeCompare(left.updated_at);
    if (filters.sort === "priority") return (priorityRank[right.priority] ?? 0) - (priorityRank[left.priority] ?? 0) || right.updated_at.localeCompare(left.updated_at);
    return (priorityRank[right.priority] ?? 0) - (priorityRank[left.priority] ?? 0) || right.updated_at.localeCompare(left.updated_at);
  });

  return (
    <div className="space-y-6" data-testid="recommendations-view">
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Активные" value={recommendations.filter((item) => item.status === "open").length} hint="Открытые сигналы" />
        <MetricCard label="Rule-based" value={recommendations.filter((item) => item.source === "rule_based").length} hint="Сформированы правилами" />
        <MetricCard label="Важные" value={recommendations.filter((item) => item.priority === "high" || item.priority === "critical").length} hint="High и critical" />
        <MetricCard label="Прочитано" value={readIds.size} hint="Факты просмотра из БД" />
      </div>

      <form className="rounded-3xl border border-border bg-surface p-6" data-testid="recommendation-filters-form">
        <div className="grid gap-3 md:grid-cols-4">
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Статус</span>
            <select className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" defaultValue={filters.status ?? ""} name="recommendation_status">
              <option value="">Все</option>
              <option value="open">Открытые</option>
              <option value="accepted">Принятые</option>
              <option value="rejected">Отклонённые</option>
            </select>
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Приоритет</span>
            <select className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" defaultValue={filters.priority ?? ""} name="recommendation_priority">
              <option value="">Все</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Актив</span>
            <select className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" defaultValue={filters.assetId ?? ""} name="recommendation_asset_id">
              <option value="">Все</option>
              {data.assets.map((asset) => (
                <option key={asset.id} value={asset.id}>{asset.name} · {asset.ticker ?? asset.currency_code ?? "—"}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Сортировка</span>
            <select className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" defaultValue={filters.sort ?? "priority"} name="recommendation_sort">
              <option value="priority">Приоритет и дата</option>
              <option value="date">Дата обновления</option>
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="h-11 rounded-2xl bg-accent px-5 text-sm font-medium text-white" type="submit">
            Применить
          </button>
          <Link className="h-11 rounded-2xl border border-border px-5 py-3 text-sm font-medium" href="/recommendations">
            Сбросить
          </Link>
        </div>
      </form>

      <section className="space-y-4">
        {recommendations.map((recommendation) => {
          const linkedAsset = recommendation.linkedAssetId ? assetById.get(recommendation.linkedAssetId) : null;
          const linkedAccounts = (accountLinksByRecommendationId.get(recommendation.id) ?? [])
            .map((link) => accountById.get(link.entity_id))
            .filter((account): account is NonNullable<typeof account> => Boolean(account));
          const isRead = readIds.has(recommendation.id);
          const whatIfHref = recommendationWhatIfHref(recommendation, data);

          return (
          <article className="rounded-3xl border border-border bg-surface p-6" data-testid="recommendation-card" key={recommendation.id}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-background px-3 py-1 text-xs text-muted">{recommendationPriorityLabel(recommendation.priority)}</span>
                  <span className="rounded-full bg-background px-3 py-1 text-xs text-muted">{recommendationStatusLabel(recommendation.status)}</span>
                  <span className="rounded-full bg-background px-3 py-1 text-xs text-muted">{recommendationTypeLabel(recommendation.recommendation_type)}</span>
                  {isRead && <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs text-emerald-700">прочитано</span>}
                  {isGeneratedRecommendation(recommendation.id) && <span className="rounded-full bg-blue-50 px-3 py-1 text-xs text-blue-700">сгенерировано</span>}
                </div>
                <h2 className="mt-4 text-xl font-semibold">{recommendation.title}</h2>
                <p className="mt-2 text-sm text-muted" data-testid="recommendation-reason">{recommendation.reason ?? "Причина не указана."}</p>
              </div>
              <div className="text-right text-xs text-muted">
                <p>{formatDateTime(recommendation.updated_at)}</p>
                <p className="mt-1">{recommendation.source}</p>
              </div>
            </div>

            {recommendation.body && <p className="mt-4 text-sm leading-6">{recommendation.body}</p>}
            {linkedAsset && (
              <div className="mt-4 rounded-2xl border border-border bg-background px-4 py-3 text-sm">
                <span className="text-muted">Связанный актив: </span>
                <Link className="font-medium text-accent" href={`/assets?asset_id=${linkedAsset.id}`}>
                  {linkedAsset.name}
                </Link>
              </div>
            )}
            {linkedAccounts.length > 0 && (
              <div className="mt-3 rounded-2xl border border-border bg-background px-4 py-3 text-sm">
                <span className="text-muted">Связанные счета: </span>
                <span className="inline-flex flex-wrap gap-x-3 gap-y-1">
                  {linkedAccounts.map((account) => (
                    <Link className="font-medium text-accent" href={`/accounts?account_id=${account.id}`} key={account.id}>
                      {account.name}
                    </Link>
                  ))}
                </span>
              </div>
            )}
            <RecommendationMetrics metrics={recommendation.metrics} />

            <div className="mt-5 flex flex-wrap gap-2">
              <Link className="rounded-2xl border border-border bg-background px-4 py-2 text-sm font-medium" data-testid="recommendation-source-link" href={recommendation.href ?? "/dashboard"}>
                Открыть источник
              </Link>
              {canEdit && (
                <form action={saveRecommendationToWatchlist} className="flex flex-wrap gap-2">
                  <input name="return_to" type="hidden" value="/recommendations" />
                  <RecommendationActionFields recommendation={recommendation} />
                  <button className="rounded-2xl border border-border bg-background px-4 py-2 text-sm font-medium" data-testid="recommendation-read-button" type="submit">
                    В watchlist
                  </button>
                </form>
              )}
              {canEdit && !isRead && (
                <form action={markRecommendationRead}>
                  <input name="return_to" type="hidden" value="/recommendations" />
                  <RecommendationActionFields recommendation={recommendation} />
                  <button className="rounded-2xl border border-border bg-background px-4 py-2 text-sm font-medium" data-testid="recommendation-mark-read-button" type="submit">
                    Прочитано
                  </button>
                </form>
              )}
              {canEdit && recommendation.status === "open" && (
                <>
                  <form action={updateRecommendationStatus}>
                    <input name="return_to" type="hidden" value="/recommendations" />
                    <input name="status" type="hidden" value="accepted" />
                    <RecommendationActionFields recommendation={recommendation} />
                    <button className="rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white" data-testid="recommendation-accept-button" type="submit">
                      Принять
                    </button>
                  </form>
                  <form action={updateRecommendationStatus}>
                    <input name="return_to" type="hidden" value="/recommendations" />
                    <input name="status" type="hidden" value="rejected" />
                    <RecommendationActionFields recommendation={recommendation} />
                    <button className="rounded-2xl border border-border bg-background px-4 py-2 text-sm font-medium" data-testid="recommendation-reject-button" type="submit">
                      Отклонить
                    </button>
                  </form>
                </>
              )}
              {canEdit && recommendation.status !== "archived" && (
                <form action={updateRecommendationStatus}>
                  <input name="return_to" type="hidden" value="/recommendations" />
                  <input name="status" type="hidden" value="archived" />
                  <RecommendationActionFields recommendation={recommendation} />
                  <button className="rounded-2xl border border-border bg-background px-4 py-2 text-sm font-medium text-muted" type="submit">
                    Архив
                  </button>
                </form>
              )}
              {whatIfHref ? (
                <Link className="rounded-2xl bg-accent px-4 py-2 text-sm font-medium text-white" href={whatIfHref}>
                  What-if
                </Link>
              ) : (
                <button className="rounded-2xl border border-border bg-background px-4 py-2 text-sm font-medium text-muted" disabled type="button">
                  What-if недоступен
                </button>
              )}
            </div>
          </article>
          );
        })}
        {recommendations.length === 0 && <EmptyState text="Рекомендаций пока нет. Они появятся после загрузки портфеля, цен и денежных потоков." />}
      </section>
    </div>
  );
}

function NewsView({ data, filters }: { data: PortfolioData; filters: NewsFilterInput }) {
  const assetById = new Map(data.assets.map((asset) => [asset.id, asset]));
  const watchlistNewsItems = data.watchlistItems.filter((item) => item.news_item_id);
  const watchlistNewsIds = new Set(watchlistNewsItems.map((item) => item.news_item_id).filter(Boolean));
  const watchlistItemByNewsId = new Map(watchlistNewsItems.map((item) => [item.news_item_id, item]));
  const canEdit = canEditFamilyData(data.family?.role);
  const view = filters.view === "portfolio" || filters.view === "ideas" || filters.view === "saved" ? filters.view : "all";
  const newsItems = data.newsItems.filter((item) => {
    if (view === "portfolio") return item.kind === "portfolio_news" || Boolean(item.asset_id);
    if (view === "ideas") return item.kind === "idea";
    if (view === "saved") return watchlistNewsIds.has(item.id);
    return true;
  });

  return (
    <div className="space-y-6" data-testid="news-view">
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Новости" value={data.newsItems.filter((item) => item.kind !== "idea").length} hint="По портфелю и рынку" />
        <MetricCard label="Идеи" value={data.newsItems.filter((item) => item.kind === "idea").length} hint="Внешний поток" />
        <MetricCard label="В watchlist" value={watchlistNewsIds.size} hint="Сохраненные материалы" />
      </div>

      <form className="rounded-3xl border border-border bg-surface p-6" data-testid="news-filters-form">
        <div className="flex flex-wrap gap-2">
          {[
            ["all", "Все"],
            ["portfolio", "По портфелю"],
            ["ideas", "Идеи"],
            ["saved", "Сохранённые"],
          ].map(([value, label]) => (
            <label className={`cursor-pointer rounded-2xl border px-4 py-2 text-sm font-medium ${view === value ? "border-accent bg-accent text-white" : "border-border bg-background"}`} key={value}>
              <input className="sr-only" defaultChecked={view === value} name="news_view" type="radio" value={value} />
              {label}
            </label>
          ))}
          <button className="rounded-2xl border border-border px-4 py-2 text-sm font-medium" type="submit">
            Применить
          </button>
        </div>
      </form>

      {canEdit && (
        <section className="rounded-3xl border border-border bg-surface p-6">
          <h2 className="text-lg font-semibold">Добавить новость или идею</h2>
          <form action={createNewsItem} className="mt-5 grid gap-3">
            <input name="return_to" type="hidden" value="/news" />
            <div className="grid gap-3 md:grid-cols-3">
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Тип</span>
                <select className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" name="kind" required>
                  <option value="portfolio_news">Новость по портфелю</option>
                  <option value="market_news">Рыночная новость</option>
                  <option value="idea">Инвестиционная идея</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Источник</span>
                <input className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" name="source" placeholder="Ручной ввод" required />
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Дата публикации</span>
                <input className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" name="published_at" type="datetime-local" />
              </label>
            </div>
            <input className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" name="title" placeholder="Заголовок" required />
            <textarea className="min-h-24 rounded-2xl border border-border bg-background px-4 py-3 text-sm" name="summary" placeholder="Короткое описание" />
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Связанный актив</span>
                <select className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" name="asset_id">
                  <option value="">Без привязки</option>
                  {data.assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>{asset.name} · {asset.ticker ?? asset.currency_code ?? "—"}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium">URL источника</span>
                <input className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" name="url" placeholder="https://..." />
              </label>
            </div>
            <button className="h-11 rounded-2xl bg-accent px-5 text-sm font-medium text-white" type="submit">
              Сохранить материал
            </button>
          </form>
        </section>
      )}

      <section className="grid gap-4 xl:grid-cols-2">
        {newsItems.map((newsItem) => (
          <article className="rounded-3xl border border-border bg-surface p-6" data-testid="news-card" key={newsItem.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <span className="rounded-full bg-background px-3 py-1 text-xs text-muted">{newsKindLabel(newsItem.kind)}</span>
                {watchlistNewsIds.has(newsItem.id) && <span className="ml-2 rounded-full bg-emerald-50 px-3 py-1 text-xs text-emerald-700">watchlist</span>}
              </div>
              <span className="text-xs text-muted">{formatDateTime(newsItem.published_at)}</span>
            </div>
            <h2 className="mt-4 text-lg font-semibold">{newsItem.title}</h2>
            <p className="mt-2 text-sm text-muted">
              {newsItem.source}
              {newsItem.asset_id ? ` · ${assetById.get(newsItem.asset_id)?.name ?? "Актив"}` : ""}
            </p>
            {newsItem.summary && <p className="mt-4 text-sm leading-6">{newsItem.summary}</p>}
            <div className="mt-5 flex flex-wrap gap-2">
              {newsItem.asset_id && (
                <Link className="rounded-2xl border border-border bg-background px-4 py-2 text-sm font-medium" href={`/assets?asset_id=${newsItem.asset_id}`}>
                  Открыть актив
                </Link>
              )}
              {newsItem.url && (
                <Link className="rounded-2xl border border-border bg-background px-4 py-2 text-sm font-medium" href={newsItem.url}>
                  Источник
                </Link>
              )}
              {canEdit && !watchlistNewsIds.has(newsItem.id) && (
                <form action={addNewsToWatchlist}>
                  <input name="return_to" type="hidden" value="/news" />
                  <input name="news_item_id" type="hidden" value={newsItem.id} />
                  <button className="rounded-2xl bg-accent px-4 py-2 text-sm font-medium text-white" data-testid="news-watchlist-button" type="submit">
                    В watchlist
                  </button>
                </form>
              )}
              {canEdit && watchlistNewsIds.has(newsItem.id) && (
                <form action={archiveWatchlistItem}>
                  <input name="return_to" type="hidden" value="/news" />
                  <input name="watchlist_item_id" type="hidden" value={watchlistItemByNewsId.get(newsItem.id)?.id ?? ""} />
                  <button className="rounded-2xl border border-border bg-background px-4 py-2 text-sm font-medium text-muted" type="submit">
                    Убрать из watchlist
                  </button>
                </form>
              )}
            </div>
          </article>
        ))}
        {newsItems.length === 0 && <EmptyState text="Материалов по выбранному фильтру пока нет." />}
      </section>
    </div>
  );
}

function WatchlistView({ data, filters }: { data: PortfolioData; filters: WatchlistFilterInput }) {
  const assetById = new Map(data.assets.map((asset) => [asset.id, asset]));
  const newsById = new Map(data.newsItems.map((newsItem) => [newsItem.id, newsItem]));
  const recommendationById = new Map(data.recommendations.map((recommendation) => [recommendation.id, recommendation]));
  const canEdit = canEditFamilyData(data.family?.role);
  const watchlistItems = filterWatchlistItems(data.watchlistItems, filters);

  return (
    <div className="space-y-6" data-testid="watchlist-view">
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Всего" value={watchlistItems.length} hint="По текущему фильтру" />
        <MetricCard label="Активы" value={data.watchlistItems.filter((item) => item.item_type === "asset").length} hint="Инструменты" />
        <MetricCard label="Новости" value={data.watchlistItems.filter((item) => item.item_type === "news" || item.item_type === "idea").length} hint="Материалы и идеи" />
        <MetricCard label="Рекомендации" value={data.watchlistItems.filter((item) => item.item_type === "recommendation").length} hint="Сигналы" />
      </div>

      <form className="rounded-3xl border border-border bg-surface p-6" data-testid="watchlist-filters-form">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto]">
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Тип</span>
            <select className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" defaultValue={filters.type ?? ""} name="watchlist_type">
              <option value="">Все</option>
              <option value="asset">Активы</option>
              <option value="news">Новости и идеи</option>
              <option value="recommendation">Рекомендации</option>
            </select>
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Статус</span>
            <select className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" defaultValue={filters.status ?? ""} name="watchlist_status">
              <option value="">Все</option>
              <option value="watching">Наблюдаем</option>
              <option value="considering">Изучаем</option>
              <option value="done">Разобрано</option>
            </select>
          </label>
          <button className="self-end rounded-2xl bg-accent px-5 py-3 text-sm font-medium text-white" type="submit">
            Применить
          </button>
          <Link className="self-end rounded-2xl border border-border px-5 py-3 text-sm font-medium" href="/watchlist">
            Сбросить
          </Link>
        </div>
      </form>

      <section className="overflow-hidden rounded-3xl border border-border bg-surface">
        {watchlistItems.length === 0 ? (
          <div className="p-6">
            <EmptyState text="В watchlist нет элементов по выбранному фильтру." />
          </div>
        ) : (
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-border text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Элемент</th>
                <th className="px-4 py-3 font-medium">Тип</th>
                <th className="px-4 py-3 font-medium">Статус</th>
                <th className="px-4 py-3 font-medium">Заметка</th>
                <th className="px-4 py-3 font-medium">Связь</th>
                {canEdit && <th className="px-4 py-3 font-medium">Действие</th>}
              </tr>
            </thead>
            <tbody>
              {watchlistItems.map((item) => {
                const asset = item.asset_id ? assetById.get(item.asset_id) : null;
                const newsItem = item.news_item_id ? newsById.get(item.news_item_id) : null;
                const recommendation = item.recommendation_id ? recommendationById.get(item.recommendation_id) : null;
                const href = asset ? `/assets?asset_id=${asset.id}` : newsItem ? "/news" : recommendation ? "/recommendations" : "/watchlist";

                return (
                  <tr className="border-b border-border last:border-0" key={item.id}>
                    <td className="px-4 py-3 font-medium">{item.title}</td>
                    <td className="px-4 py-3 text-muted">{item.item_type}</td>
                    <td className="px-4 py-3 text-muted">
                      {canEdit ? (
                        <select className="h-9 rounded-xl border border-border bg-background px-3 text-xs" form={`watchlist-form-${item.id}`} name="status" defaultValue={item.status}>
                          <option value="watching">Наблюдаем</option>
                          <option value="considering">Изучаем</option>
                          <option value="done">Разобрано</option>
                          <option value="archived">Архив</option>
                        </select>
                      ) : (
                        watchlistStatusLabel(item.status)
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {canEdit ? (
                        <input className="h-9 w-56 rounded-xl border border-border bg-background px-3 text-xs" defaultValue={item.notes ?? ""} form={`watchlist-form-${item.id}`} name="notes" placeholder="Заметка" />
                      ) : (
                        item.notes ?? "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Link className="font-medium text-accent" href={href}>
                        {asset?.name ?? newsItem?.title ?? recommendation?.title ?? "Открыть"}
                      </Link>
                    </td>
                    {canEdit && (
                      <td className="px-4 py-3">
                        <form action={updateWatchlistItem} id={`watchlist-form-${item.id}`}>
                          <input name="return_to" type="hidden" value="/watchlist" />
                          <input name="watchlist_item_id" type="hidden" value={item.id} />
                          <button className="rounded-xl bg-accent px-3 py-2 text-xs font-medium text-white" data-testid="watchlist-save-button" type="submit">
                            Сохранить
                          </button>
                        </form>
                        <form action={archiveWatchlistItem} className="mt-2">
                          <input name="return_to" type="hidden" value="/watchlist" />
                          <input name="watchlist_item_id" type="hidden" value={item.id} />
                          <button className="rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium text-muted" type="submit">
                            Архив
                          </button>
                        </form>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function eventPayloadOperationIds(payload: Record<string, unknown>) {
  const value = payload.operation_ids;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function eventRelatedOperations(event: PortfolioData["events"][number], operations: Operation[]) {
  const operationById = new Map(operations.map((operation) => [operation.id, operation]));
  const explicitOperations = eventPayloadOperationIds(event.payload)
    .map((operationId) => operationById.get(operationId))
    .filter((operation): operation is Operation => Boolean(operation));

  if (explicitOperations.length > 0) return explicitOperations;
  if (!event.asset_id) return [];

  return operations
    .filter((operation) => operation.asset_id === event.asset_id && operation.trade_date === event.event_date)
    .slice(0, 5);
}

function EventsView({ data, filters }: { data: PortfolioData; filters: EventFilterInput }) {
  const assetById = new Map(data.assets.map((asset) => [asset.id, asset]));
  const accountById = new Map(data.accounts.map((account) => [account.id, account]));
  const today = todayIsoDate();
  const { upcoming, history } = splitPortfolioEvents(filterPortfolioEvents(data.events, filters), today);
  const canEdit = canEditFamilyData(data.family?.role);
  const renderEventCard = (event: PortfolioData["events"][number]) => {
    const linkedOperations = eventRelatedOperations(event, data.operations);

    return (
      <article className="rounded-2xl border border-border bg-background p-4" data-testid="event-card" key={event.id}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-medium">{event.title}</p>
            <p className="mt-1 text-sm text-muted">{eventTypeLabel(event.event_type)} · {formatDate(event.event_date)} · {statusLabel(event.status)}</p>
          </div>
          {event.amount !== null && event.currency_code && <span className="text-sm font-semibold">{formatMoney(event.amount, event.currency_code)}</span>}
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {event.asset_id && <Link className="font-medium text-accent" data-testid="event-asset-link" href={`/assets?asset_id=${event.asset_id}`}>{assetById.get(event.asset_id)?.name ?? "Открыть актив"}</Link>}
          <span className="text-muted">Источник: {event.source}</span>
        </div>

        {linkedOperations.length > 0 && (
          <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-surface">
            <div className="border-b border-border px-4 py-3">
              <p className="text-sm font-medium">Связанные операции</p>
            </div>
            <div className="divide-y divide-border">
              {linkedOperations.map((operation) => {
                const account = accountById.get(operation.account_id);
                return (
                  <div className="grid gap-1 px-4 py-3 text-sm md:grid-cols-[1fr_auto]" key={operation.id}>
                    <div>
                      <p className="font-medium">{operationTypeLabel(operation.operation_type_code)}</p>
                      <p className="mt-1 text-xs text-muted">{operation.trade_date} · {account?.name ?? "Счёт не найден"}</p>
                    </div>
                    <p className="font-medium">{formatSignedMoney(operation.net_amount, operation.currency_code)}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      {canEdit && (
        <form action={updatePortfolioEvent} className="mt-4 grid gap-3 border-t border-border pt-4">
          <input name="return_to" type="hidden" value="/events" />
          <input name="event_id" type="hidden" value={event.id} />
          <div className="grid gap-3 md:grid-cols-4">
            <label className="grid gap-2 text-xs">
              <span className="font-medium">Тип</span>
              <select className="h-9 rounded-xl border border-border bg-background px-3 text-xs" name="event_type" defaultValue={event.event_type}>
                <option value="dividend">Дивиденд</option>
                <option value="coupon">Купон</option>
                <option value="redemption">Погашение</option>
              </select>
            </label>
            <label className="grid gap-2 text-xs">
              <span className="font-medium">Статус</span>
              <select className="h-9 rounded-xl border border-border bg-background px-3 text-xs" name="status" defaultValue={event.status}>
                <option value="scheduled">Запланировано</option>
                <option value="done">Выполнено</option>
                <option value="cancelled">Отменено</option>
              </select>
            </label>
            <label className="grid gap-2 text-xs">
              <span className="font-medium">Дата</span>
              <input className="h-9 rounded-xl border border-border bg-background px-3 text-xs" name="event_date" type="date" defaultValue={event.event_date} />
            </label>
            <label className="grid gap-2 text-xs">
              <span className="font-medium">Сумма</span>
              <input className="h-9 rounded-xl border border-border bg-background px-3 text-xs" name="amount" type="number" step="0.01" defaultValue={event.amount?.toString() ?? ""} />
            </label>
          </div>
          <input className="h-9 rounded-xl border border-border bg-background px-3 text-xs" name="title" defaultValue={event.title} />
          <div className="grid gap-3 md:grid-cols-[1fr_160px_auto]">
            <label className="grid gap-2 text-xs">
              <span className="font-medium">Актив</span>
              <select className="h-9 rounded-xl border border-border bg-background px-3 text-xs" name="asset_id" defaultValue={event.asset_id ?? ""}>
                <option value="">Без привязки</option>
                {data.assets.filter((asset) => asset.asset_type_code !== "cash").map((asset) => (
                  <option key={asset.id} value={asset.id}>{asset.name} · {asset.ticker ?? asset.currency_code ?? "—"}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-xs">
              <span className="font-medium">Валюта</span>
              <input className="h-9 rounded-xl border border-border bg-background px-3 text-xs" name="currency_code" maxLength={3} defaultValue={event.currency_code ?? data.family?.baseCurrency ?? "RUB"} />
            </label>
            <button className="self-end rounded-xl bg-accent px-3 py-2 text-xs font-medium text-white" type="submit">
              Обновить
            </button>
          </div>
        </form>
      )}
      </article>
    );
  };

  return (
    <div className="space-y-6" data-testid="events-view">
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Будущие" value={upcoming.length} hint="Ожидаемые события" />
        <MetricCard label="История" value={history.length} hint="Прошедшие и выполненные" />
        <MetricCard label="Купоны" value={data.events.filter((event) => event.event_type === "coupon").length} hint="Все статусы" />
        <MetricCard label="Дивиденды" value={data.events.filter((event) => event.event_type === "dividend").length} hint="Все статусы" />
      </div>

      <form className="rounded-3xl border border-border bg-surface p-6" data-testid="events-filters-form">
        <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Тип события</span>
            <select className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" name="event_type_filter" defaultValue={filters.type ?? ""}>
              <option value="">Все</option>
              <option value="dividend">Дивиденды</option>
              <option value="coupon">Купоны</option>
              <option value="redemption">Погашения</option>
            </select>
          </label>
          <button className="self-end rounded-2xl bg-accent px-5 py-3 text-sm font-medium text-white" type="submit">
            Применить
          </button>
          <Link className="self-end rounded-2xl border border-border px-5 py-3 text-sm font-medium" href="/events">
            Сбросить
          </Link>
        </div>
      </form>

      {canEdit && (
        <section className="rounded-3xl border border-border bg-surface p-6">
          <h2 className="text-lg font-semibold">Добавить событие</h2>
          <form action={createPortfolioEvent} className="mt-5 grid gap-3" data-testid="create-event-form">
            <input name="return_to" type="hidden" value="/events" />
            <div className="grid gap-3 md:grid-cols-4">
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Тип</span>
                <select className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" name="event_type" required>
                  <option value="dividend">Дивиденд</option>
                  <option value="coupon">Купон</option>
                  <option value="redemption">Погашение</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Дата</span>
                <input className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" name="event_date" required type="date" />
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Сумма</span>
                <input className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" name="amount" placeholder="Опционально" step="0.01" type="number" />
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Валюта</span>
                <input className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" defaultValue={data.family?.baseCurrency ?? "RUB"} maxLength={3} name="currency_code" />
              </label>
            </div>
            <input className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" name="title" placeholder="Название события" required />
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Актив</span>
              <select className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" name="asset_id">
                <option value="">Без привязки</option>
                {data.assets.filter((asset) => asset.asset_type_code !== "cash").map((asset) => (
                  <option key={asset.id} value={asset.id}>{asset.name} · {asset.ticker ?? asset.currency_code ?? "—"}</option>
                ))}
              </select>
            </label>
            <button className="h-11 rounded-2xl bg-accent px-5 text-sm font-medium text-white" data-testid="create-event-button" type="submit">
              Сохранить событие
            </button>
          </form>
        </section>
      )}

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-3xl border border-border bg-surface p-6" data-testid="events-upcoming-section">
          <h2 className="text-lg font-semibold">Будущие события</h2>
          <div className="mt-5 space-y-3">
            {upcoming.map(renderEventCard)}
            {upcoming.length === 0 && <EmptyState text="Будущих событий пока нет. Их можно будет загрузить из календаря или добавить вручную." />}
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-surface p-6" data-testid="events-history-section">
          <h2 className="text-lg font-semibold">История событий</h2>
          <div className="mt-5 space-y-3">
            {history.slice(0, 12).map(renderEventCard)}
            {history.length === 0 && <EmptyState text="Исторических событий пока нет." />}
          </div>
        </div>
      </section>
    </div>
  );
}

function scenarioTypeLabel(type: string | undefined) {
  return type === "sell" ? "Продажа" : "Покупка";
}

function diagnosticTone(severity: string) {
  if (severity === "error") return "border-red-200 bg-red-50 text-red-900";
  if (severity === "warning") return "border-amber-200 bg-amber-50 text-amber-950";
  return "border-blue-200 bg-blue-50 text-blue-900";
}

type SuccessfulWhatIfScenarioResult = Extract<WhatIfScenarioResult, { ok: true }>;

function ScenarioResultSummary({ result }: { result: SuccessfulWhatIfScenarioResult }) {
  const totalMetric = result.metrics.find((metric) => metric.label === "Стоимость портфеля");
  const cashMetric = result.metrics.find((metric) => metric.label === "Кэш");
  const quantityMetric = result.metrics.find((metric) => metric.label === "Количество актива");
  const limitDelta = result.after.limitCheck.violations.length - result.before.limitCheck.violations.length;

  return (
    <div className="grid gap-3 md:grid-cols-4" data-testid="what-if-summary">
      {totalMetric && (
        <div className="rounded-3xl border border-border bg-surface p-4">
          <p className="text-xs text-muted">Стоимость</p>
          <p className={`mt-2 text-lg font-semibold ${deltaTone(totalMetric.delta)}`}>{formatScenarioMetricDelta(totalMetric)}</p>
          <p className="mt-1 text-xs text-muted">После: {formatScenarioMetricValue(totalMetric, totalMetric.after)}</p>
        </div>
      )}
      {cashMetric && (
        <div className="rounded-3xl border border-border bg-surface p-4">
          <p className="text-xs text-muted">Кэш</p>
          <p className={`mt-2 text-lg font-semibold ${deltaTone(cashMetric.delta)}`}>{formatScenarioMetricDelta(cashMetric)}</p>
          <p className="mt-1 text-xs text-muted">После: {formatScenarioMetricValue(cashMetric, cashMetric.after)}</p>
        </div>
      )}
      {quantityMetric && (
        <div className="rounded-3xl border border-border bg-surface p-4">
          <p className="text-xs text-muted">Количество</p>
          <p className={`mt-2 text-lg font-semibold ${deltaTone(quantityMetric.delta)}`}>{formatScenarioMetricDelta(quantityMetric)}</p>
          <p className="mt-1 text-xs text-muted">{result.input.scenarioType === "sell" ? "Продажа" : "Покупка"} · {formatMoney(result.input.price, result.input.currencyCode)}</p>
        </div>
      )}
      <div className="rounded-3xl border border-border bg-surface p-4">
        <p className="text-xs text-muted">Лимиты</p>
        <p className={`mt-2 text-lg font-semibold ${deltaTone(limitDelta)}`}>{limitDelta > 0 ? "+" : ""}{limitDelta}</p>
        <p className="mt-1 text-xs text-muted">После: {result.after.limitCheck.violations.length} наруш.</p>
      </div>
    </div>
  );
}

function WhatIfView({ data, input }: { data: PortfolioData; input: WhatIfFormInput }) {
  const accounts = data.accounts.filter((account) => account.status === "active");
  const assets = data.assets.filter((asset) => asset.status === "active" && asset.asset_type_code !== "cash");
  const defaultAccount = accounts.find((account) => account.id === input.accountId) ?? accounts[0];
  const defaultAsset = assets.find((asset) => asset.id === input.assetId) ?? assets[0];
  const selectedAsset = assets.find((asset) => asset.id === input.assetId) ?? defaultAsset;
  const selectedAccount = accounts.find((account) => account.id === input.accountId) ?? defaultAccount;
  const selectedPosition = data.positions.find((position) => position.asset_id === selectedAsset?.id && (!selectedAccount || position.account_id === selectedAccount.id));
  const currencyOptions = Array.from(new Set([
    data.family?.baseCurrency ?? "RUB",
    selectedAccount?.currency_code,
    selectedAsset?.currency_code,
    selectedPosition?.currency_code,
    ...data.cashBalances.map((balance) => balance.currency_code),
  ].filter((value): value is string => Boolean(value)))).sort();
  const scenarioType = input.scenarioType === "sell" ? "sell" : "buy";
  const currencyCode = input.currencyCode ?? selectedPosition?.currency_code ?? selectedAsset?.currency_code ?? selectedAccount?.currency_code ?? data.family?.baseCurrency ?? "RUB";
  const tradeDate = input.tradeDate ?? todayIsoDate();
  const sourceRecommendation = input.sourceRecommendationId
    ? data.recommendations.find((recommendation) => recommendation.id === input.sourceRecommendationId)
    : null;
  const quantity = parseQueryNumber(input.quantity);
  const price = parseQueryNumber(input.price);
  const commission = parseQueryNumber(input.commission) ?? 0;
  const availableScenarioCash = data.cashBalances
    .filter((balance) => balance.account_id === selectedAccount?.id && balance.currency_code === currencyCode)
    .reduce((total, balance) => total + balance.balance, 0);
  const availableScenarioQuantity = data.positions
    .filter((position) => position.account_id === selectedAccount?.id && position.asset_id === selectedAsset?.id && position.currency_code === currencyCode)
    .reduce((total, position) => total + position.quantity, 0);
  const estimatedAmount = quantity !== null && price !== null ? quantity * price + commission : null;
  const shouldRun = whatIfInputHasSubmission(input) && Boolean(input.quantity || input.price);
  const result: WhatIfScenarioResult | null = shouldRun && data.family
    ? runWhatIfScenario({
      scenarioType,
      familyId: data.family.id,
      accountId: selectedAccount?.id ?? "",
      assetId: selectedAsset?.id ?? "",
      tradeDate,
      quantity,
      price,
      currencyCode,
      commission,
      sourceRecommendationId: input.sourceRecommendationId ?? null,
    }, {
      familyId: data.family.id,
      accounts: data.accounts,
      assets: data.assets,
      operations: data.operations,
      positionSnapshots: data.positionSnapshots,
      positions: data.positions,
      cashBalances: data.cashBalances,
      limits: data.limits,
      baseCurrency: data.family.baseCurrency,
    })
    : null;

  return (
    <div className="space-y-6" data-testid="what-if-view">
      <form action="/what-if" className="rounded-3xl border border-border bg-surface p-6" data-testid="what-if-form">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Сценарий по одному активу</h2>
            <p className="mt-1 text-sm text-muted">Расчет выполняется без записи операции и без изменения текущих позиций.</p>
          </div>
          {sourceRecommendation && (
            <Link className="rounded-2xl border border-border bg-background px-4 py-2 text-sm font-medium" href="/recommendations">
              Из рекомендации
            </Link>
          )}
        </div>

        {sourceRecommendation && (
          <div className="mt-5 rounded-2xl border border-border bg-background p-4 text-sm">
            <p className="font-medium">{sourceRecommendation.title}</p>
            <p className="mt-1 text-muted">{sourceRecommendation.reason ?? recommendationTypeLabel(sourceRecommendation.recommendation_type)}</p>
          </div>
        )}

        <input name="source_recommendation_id" type="hidden" value={input.sourceRecommendationId ?? ""} />
        <div className="mt-5 grid gap-4 md:grid-cols-4">
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Операция</span>
            <select className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" data-testid="what-if-scenario-type" defaultValue={scenarioType} name="scenario_type">
              <option value="buy">Покупка</option>
              <option value="sell">Продажа</option>
            </select>
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Счет</span>
            <select className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" data-testid="what-if-account-select" defaultValue={selectedAccount?.id ?? ""} name="account_id" required>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{account.name} · {account.currency_code}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Актив</span>
            <select className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" data-testid="what-if-asset-select" defaultValue={selectedAsset?.id ?? ""} name="asset_id" required>
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>{asset.name} · {asset.ticker ?? asset.currency_code ?? "—"}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Дата</span>
            <input className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" data-testid="what-if-trade-date-input" defaultValue={tradeDate} name="trade_date" required type="date" />
          </label>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-4">
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Количество</span>
            <input className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" data-testid="what-if-quantity-input" defaultValue={input.quantity ?? ""} min="0.0000001" name="quantity" placeholder="10" required step="0.0000001" type="number" />
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Цена</span>
            <input className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" data-testid="what-if-price-input" defaultValue={input.price ?? selectedPosition?.market_price ?? selectedPosition?.average_price ?? ""} min="0.0000001" name="price" placeholder="100" required step="0.0000001" type="number" />
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Валюта</span>
            <select className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" data-testid="what-if-currency-select" defaultValue={currencyCode} name="currency_code">
              {currencyOptions.map((currency) => (
                <option key={currency} value={currency}>{currency}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Комиссия</span>
            <input className="h-11 rounded-2xl border border-border bg-background px-4 text-sm" data-testid="what-if-commission-input" defaultValue={input.commission ?? "0"} min="0" name="commission" step="0.01" type="number" />
          </label>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3" data-testid="what-if-context">
          <div className="rounded-2xl border border-border bg-background p-4">
            <p className="text-xs text-muted">Кэш на счете</p>
            <p className="mt-2 font-semibold">{formatMoney(availableScenarioCash, currencyCode)}</p>
          </div>
          <div className="rounded-2xl border border-border bg-background p-4">
            <p className="text-xs text-muted">Позиция в валюте сценария</p>
            <p className="mt-2 font-semibold">{formatNumber(availableScenarioQuantity, 6)}</p>
          </div>
          <div className="rounded-2xl border border-border bg-background p-4">
            <p className="text-xs text-muted">Сумма сделки</p>
            <p className="mt-2 font-semibold">{estimatedAmount === null ? "—" : formatMoney(estimatedAmount, currencyCode)}</p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <button className="h-11 rounded-2xl bg-accent px-5 text-sm font-medium text-white" data-testid="what-if-submit-button" type="submit">
            Рассчитать
          </button>
          <Link className="h-11 rounded-2xl border border-border px-5 py-3 text-sm font-medium" href="/what-if">
            Сбросить
          </Link>
        </div>
      </form>

      {!result && <EmptyState text="Заполните параметры сделки и запустите расчет. Сценарий будет построен только в памяти." />}

      {result && result.diagnostics.length > 0 && (
        <section className="grid gap-3 md:grid-cols-2">
          {result.diagnostics.map((diagnostic) => (
            <div className={`rounded-3xl border p-4 text-sm ${diagnosticTone(diagnostic.severity)}`} key={`${diagnostic.code}:${diagnostic.message}`}>
              <p className="font-medium">{diagnostic.severity === "error" ? "Расчет остановлен" : "Ограничение данных"}</p>
              <p className="mt-1">{diagnostic.message}</p>
            </div>
          ))}
        </section>
      )}

      {result?.ok && (
        <section className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-border bg-surface p-4">
            <div>
              <p className="text-sm font-medium">{scenarioTypeLabel(result.input.scenarioType)} · {selectedAsset?.name ?? "Актив"}</p>
              <p className="mt-1 text-xs text-muted">{selectedAccount?.name ?? "Счет"} · {formatNumber(result.input.quantity, 6)} × {formatMoney(result.input.price, result.input.currencyCode)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link className="rounded-2xl border border-border bg-background px-4 py-2 text-sm font-medium" data-testid="what-if-export-excel-link" href={whatIfExportHref(input, "excel")}>
                Excel со сценарием
              </Link>
              <Link className="rounded-2xl border border-border bg-background px-4 py-2 text-sm font-medium" data-testid="what-if-export-pdf-link" href={whatIfExportHref(input, "pdf-html")}>
                PDF preview
              </Link>
            </div>
          </div>

          <ScenarioResultSummary result={result} />

          <div className="grid gap-4 md:grid-cols-4">
            <MetricCard label="Стоимость после" value={formatMoney(result.after.analytics.totalValue, data.family?.baseCurrency ?? "RUB")} hint={`Дельта: ${formatSignedMoney(result.after.analytics.totalValue - result.before.analytics.totalValue, data.family?.baseCurrency ?? "RUB")}`} />
            <MetricCard label="Кэш после" value={formatMoney(result.after.analytics.cashValue, data.family?.baseCurrency ?? "RUB")} hint={`Дельта: ${formatSignedMoney(result.after.analytics.cashValue - result.before.analytics.cashValue, data.family?.baseCurrency ?? "RUB")}`} />
            <MetricCard label="Лимиты" value={result.after.limitCheck.violations.length} hint={`До сценария: ${result.before.limitCheck.violations.length}`} />
            <MetricCard label="XIRR" value={formatPercent(result.after.analytics.xirr.value)} hint={xirrStatusLabel(result.after.analytics.xirr.status)} />
          </div>

          <div className="overflow-hidden rounded-3xl border border-border bg-surface" data-testid="what-if-comparison">
            <div className="border-b border-border p-6">
              <h2 className="text-lg font-semibold">Сравнение</h2>
              <p className="mt-2 text-sm text-muted">Значения до и после сценария. Денежные показатели показываются в доступной валюте расчета.</p>
            </div>
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-border text-muted">
                <tr>
                  <th className="px-5 py-4 font-medium">Метрика</th>
                  <th className="px-5 py-4 font-medium">Сейчас</th>
                  <th className="px-5 py-4 font-medium">После</th>
                  <th className="px-5 py-4 font-medium">Дельта</th>
                </tr>
              </thead>
              <tbody>
                {result.metrics.map((metric) => (
                  <tr className="border-b border-border last:border-0" key={metric.label}>
                    <td className="px-5 py-4 font-medium">{metric.label}</td>
                    <td className="px-5 py-4 text-muted">{formatScenarioMetricValue(metric, metric.before)}</td>
                    <td className="px-5 py-4 text-muted">{formatScenarioMetricValue(metric, metric.after)}</td>
                    <td className="px-5 py-4 font-medium">{formatScenarioMetricDelta(metric)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(result.after.limitCheck.violations.length > 0 || result.after.limitCheck.issues.length > 0) && (
            <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-950">
              <h2 className="font-semibold">Лимиты и риски после сценария</h2>
              <div className="mt-3 space-y-2">
                {result.after.limitCheck.violations.map((violation) => (
                  <p key={violation.fingerprint}>{violation.title}: {formatPercent(violation.currentValue)} при пороге {formatPercent(violation.thresholdValue)}</p>
                ))}
                {result.after.limitCheck.issues.map((issue) => (
                  <p key={`${issue.limitId}:${issue.reason}`}>{issue.message}</p>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function PlaceholderView({ section }: { section: string }) {
  const details: Record<string, string> = {
    recommendations: "Таблица рекомендаций уже создана. Интерфейс добавим после первого слоя операций и позиций.",
    news: "Новости подключим после формирования watchlist и списка активов портфеля.",
    watchlist: "Watchlist логично строить после справочника активов и первых рыночных источников.",
    events: "События будут связаны с активами: дивиденды, купоны, погашения и корпоративные действия.",
  };
  return <EmptyState text={details[section] ?? "Раздел подготовлен, данные подключим на следующем шаге."} />;
}

function SectionContent({
  applied,
  applyError,
  data,
  dashboardPeriod,
  deleted,
  deleteError,
  error,
  priced,
  priceError,
  positionFilters,
  recommendationFilters,
  newsFilters,
  watchlistFilters,
  whatIfInput,
  eventFilters,
  operationError,
  operationCancelled,
  operationSaved,
  parsed,
  parseError,
  reconciled,
  reconcileError,
  section,
  selectedAssetId,
  selectedAccountId,
  settingsError,
  settingsSaved,
  stage5Error,
  stage5Saved,
  uploaded,
}: {
  applied?: string;
  applyError?: string;
  data: PortfolioData;
  dashboardPeriod: PeriodKey;
  deleted?: string;
  deleteError?: string;
  error?: string;
  priced?: string;
  priceError?: string;
  positionFilters: PositionFilterInput;
  recommendationFilters: RecommendationFilterInput;
  newsFilters: NewsFilterInput;
  watchlistFilters: WatchlistFilterInput;
  whatIfInput: WhatIfFormInput;
  eventFilters: EventFilterInput;
  operationError?: string;
  operationCancelled?: string;
  operationSaved?: string;
  parsed?: string;
  parseError?: string;
  reconciled?: string;
  reconcileError?: string;
  section: string;
  selectedAssetId?: string;
  selectedAccountId?: string;
  settingsError?: string;
  settingsSaved?: string;
  stage5Error?: string;
  stage5Saved?: string;
  uploaded?: string;
}) {
  if (!data.family) return <EmptyState text="Для пользователя пока не назначена семья. Нужно добавить запись в family_members." />;

  if (section === "dashboard") return <DashboardView dashboardPeriod={dashboardPeriod} data={data} />;
  if (section === "what-if") return <WhatIfView data={data} input={whatIfInput} />;
  if (section === "accounts") return <AccountsView data={data} operationCancelled={operationCancelled} operationError={operationError} operationSaved={operationSaved} selectedAccountId={selectedAccountId} />;
  if (section === "assets") return <AssetsView data={data} operationCancelled={operationCancelled} operationError={operationError} operationSaved={operationSaved} positionFilters={positionFilters} priceError={priceError} priced={priced} selectedAssetId={selectedAssetId} />;
  if (section === "import") {
    return (
      <div className="space-y-6">
        <ImportNotice
          applied={applied}
          applyError={applyError}
          deleted={deleted}
          deleteError={deleteError}
          error={error}
          parsed={parsed}
          parseError={parseError}
          reconciled={reconciled}
          reconcileError={reconcileError}
          uploaded={uploaded}
        />
        <ImportUploadForm accounts={data.accounts} canUpload={canEditFamilyData(data.family?.role)} />
        <div className="rounded-3xl border border-border bg-surface p-6">
          <p className="text-sm font-medium text-accent">Storage готов</p>
          <h2 className="mt-2 text-xl font-semibold">Private bucket: broker-reports</h2>
          <p className="mt-2 text-sm text-muted">Путь файла: families/&lbrace;family_id&rbrace;/imports/&lbrace;import_id&rbrace;/filename.pdf</p>
        </div>
        <ImportsView data={data} />
      </div>
    );
  }
  if (section === "settings") return <SettingsView data={data} settingsError={settingsError} settingsSaved={settingsSaved} stage5Error={stage5Error} stage5Saved={stage5Saved} />;
  if (section === "recommendations") {
    return (
      <div className="space-y-6">
        <Stage5Notice stage5Error={stage5Error} stage5Saved={stage5Saved} />
        <RecommendationsView data={data} filters={recommendationFilters} />
      </div>
    );
  }
  if (section === "news") {
    return (
      <div className="space-y-6">
        <Stage5Notice stage5Error={stage5Error} stage5Saved={stage5Saved} />
        <NewsView data={data} filters={newsFilters} />
      </div>
    );
  }
  if (section === "watchlist") {
    return (
      <div className="space-y-6">
        <Stage5Notice stage5Error={stage5Error} stage5Saved={stage5Saved} />
        <WatchlistView data={data} filters={watchlistFilters} />
      </div>
    );
  }
  if (section === "events") {
    return (
      <div className="space-y-6">
        <Stage5Notice stage5Error={stage5Error} stage5Saved={stage5Saved} />
        <EventsView data={data} filters={eventFilters} />
      </div>
    );
  }
  return <PlaceholderView section={section} />;
}

export default async function SectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { section } = await params;
  const query = (await searchParams) ?? {};
  const current = sections[section];
  if (!current) notFound();

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/login");

  const family = await getActiveFamily(supabase, userId);
  const data = await getPortfolioData(supabase, family);
  const positionFilters: PositionFilterInput = {
    accountId: queryValue(query.position_account_id),
    assetType: queryValue(query.position_asset_type),
    currencyCode: queryValue(query.position_currency),
    onlyProblematic: queryValue(query.position_problematic) === "1",
    query: queryValue(query.position_query),
    sortBy: queryValue(query.position_sort),
  };
  const recommendationFilters: RecommendationFilterInput = {
    status: queryValue(query.recommendation_status),
    priority: queryValue(query.recommendation_priority),
    assetId: queryValue(query.recommendation_asset_id),
    sort: queryValue(query.recommendation_sort),
  };
  const newsFilters: NewsFilterInput = {
    view: queryValue(query.news_view),
  };
  const watchlistFilters: WatchlistFilterInput = {
    type: queryValue(query.watchlist_type),
    status: queryValue(query.watchlist_status),
  };
  const whatIfInput: WhatIfFormInput = {
    scenarioType: queryValue(query.scenario_type),
    accountId: queryValue(query.account_id),
    assetId: queryValue(query.asset_id),
    tradeDate: queryValue(query.trade_date),
    quantity: queryValue(query.quantity),
    price: queryValue(query.price),
    currencyCode: queryValue(query.currency_code),
    commission: queryValue(query.commission),
    sourceRecommendationId: queryValue(query.source_recommendation_id),
  };
  const eventFilters: EventFilterInput = {
    type: queryValue(query.event_type_filter),
  };

  return (
    <section>
      <p className="text-sm font-medium text-accent">Первый этап · реальные данные Supabase</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">{current.title}</h1>
      <p className="mt-3 max-w-2xl text-muted">{current.description}</p>
      <div className="mt-10">
        <SectionContent
          applied={queryValue(query.applied)}
          applyError={queryValue(query.apply_error)}
          data={data}
          dashboardPeriod={normalizeDashboardPeriod(queryValue(query.dashboard_period))}
          deleted={queryValue(query.deleted)}
          deleteError={queryValue(query.delete_error)}
          error={queryValue(query.error)}
          operationCancelled={queryValue(query.operation_cancelled)}
          operationError={queryValue(query.operation_error)}
          operationSaved={queryValue(query.operation_saved)}
          priced={queryValue(query.priced)}
          positionFilters={positionFilters}
          recommendationFilters={recommendationFilters}
          newsFilters={newsFilters}
          watchlistFilters={watchlistFilters}
          whatIfInput={whatIfInput}
          eventFilters={eventFilters}
          priceError={queryValue(query.price_error)}
          parsed={queryValue(query.parsed)}
          parseError={queryValue(query.parse_error)}
          reconciled={queryValue(query.reconciled)}
          reconcileError={queryValue(query.reconcile_error)}
          section={section}
          selectedAccountId={queryValue(query.account_id)}
          selectedAssetId={queryValue(query.asset_id)}
          settingsError={queryValue(query.settings_error)}
          settingsSaved={queryValue(query.settings_saved)}
          stage5Error={queryValue(query.stage5_error)}
          stage5Saved={queryValue(query.stage5_saved)}
          uploaded={queryValue(query.uploaded)}
        />
      </div>
      {section === "dashboard" && (
        <div className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Последние операции</h2>
          <OperationsView accounts={data.accounts} assets={data.assets} operations={data.operations.slice(0, 5)} />
        </div>
      )}
    </section>
  );
}

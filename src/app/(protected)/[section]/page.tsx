import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { PeriodKey, StructureSlice } from "@/lib/portfolio/analytics";
import { getActiveFamily, getPortfolioData, type Account, type ImportJob, type Operation, type PortfolioData, type Position } from "@/lib/portfolio/data";
import { filterAndSortPositions, groupPositionsByAssetType, type PositionFilterInput } from "@/lib/portfolio/position-filters";
import { canEditFamilyData } from "@/lib/portfolio/permissions";
import { createClient } from "@/lib/supabase/server";
import { applyBrokerImport, deleteFailedImport, parseBrokerImport, restoreImportRow, skipImportRow, uploadBrokerReport } from "./import-actions";
import { cancelManualOperation, createBuyOperation, createCashTransferOperation, createDepositOperation, createFxOperation, createSellOperation, createWithdrawalOperation } from "./manual-operation-actions";
import { saveManualPositionPrice } from "./position-actions";
import { createAccount, createPortfolio } from "./settings-actions";

const sections: Record<string, { title: string; description: string }> = {
  dashboard: { title: "Обзор портфеля", description: "Структура семейного портфеля, счета, активы и ближайшие действия." },
  accounts: { title: "Счета", description: "Брокерские, банковские и другие счета семьи." },
  assets: { title: "Активы", description: "Справочник активов, который будет использоваться в операциях и отчётах." },
  import: { title: "Импорт", description: "Загрузка брокерских отчётов и журнал обработки файлов." },
  recommendations: { title: "Рекомендации", description: "Сигналы и предложения по управлению портфелем." },
  news: { title: "Новости", description: "Новости, связанные с активами портфеля." },
  watchlist: { title: "Watchlist", description: "Активы и идеи для наблюдения." },
  events: { title: "События", description: "Дивиденды, купоны, погашения и другие события." },
  settings: { title: "Настройки", description: "Семья, пользователи, роли, валюты и правила импорта." },
};

export const dynamic = "force-dynamic";

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

function DashboardView({ data, dashboardPeriod }: { data: PortfolioData; dashboardPeriod: PeriodKey }) {
  const activeAccounts = data.accounts.filter((account) => account.status === "active").length;
  const analytics = data.analytics;
  const baseCurrency = analytics.baseCurrency;
  const currentPeriod = analytics.cashFlowPeriods.find((period) => period.period === dashboardPeriod) ?? analytics.cashFlowPeriods[0];
  const accountById = new Map(data.accounts.map((account) => [account.id, account]));
  const canEdit = canEditFamilyData(data.family?.role);

  return (
    <div className="space-y-8" data-testid="dashboard-view">
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
        <Link className="rounded-2xl border border-border px-4 py-2 text-sm font-medium text-muted" href="/assets">Закрыть карточку</Link>
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

  return (
    <div className="space-y-6" data-testid="assets-view">
      <OperationNotice operationCancelled={operationCancelled} operationError={operationError} operationSaved={operationSaved} />
      <PriceNotice priceError={priceError} priced={priced} />
      <ManualOperationsPanel data={data} returnTo="/assets" />
      {selectedAsset && <AssetDetailView asset={selectedAsset} data={data} />}
      <PositionFiltersForm accounts={data.accounts} assetTypes={assetTypes} currencies={currencies} filters={positionFilters} />
      <PositionsView canEdit={canEditFamilyData(data.family?.role)} positions={filteredPositions} />
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

function SettingsView({ data, settingsError, settingsSaved }: { data: PortfolioData; settingsError?: string; settingsSaved?: string }) {
  const canEdit = canEditFamilyData(data.family?.role);

  return (
    <div className="space-y-6">
      <SettingsNotice settingsError={settingsError} settingsSaved={settingsSaved} />

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

      <AuditLogView entries={data.auditLog} />
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
  uploaded?: string;
}) {
  if (!data.family) return <EmptyState text="Для пользователя пока не назначена семья. Нужно добавить запись в family_members." />;

  if (section === "dashboard") return <DashboardView dashboardPeriod={dashboardPeriod} data={data} />;
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
  if (section === "settings") return <SettingsView data={data} settingsError={settingsError} settingsSaved={settingsSaved} />;
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
          uploaded={queryValue(query.uploaded)}
        />
      </div>
      {section === "dashboard" && (
        <div className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Последние операции</h2>
          <OperationsView accounts={data.accounts} assets={data.assets} operations={data.operations} />
        </div>
      )}
    </section>
  );
}

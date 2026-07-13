import { notFound, redirect } from "next/navigation";
import { getActiveFamily, getPortfolioData, type Account, type ImportJob, type Operation, type PortfolioData, type Position } from "@/lib/portfolio/data";
import { createClient } from "@/lib/supabase/server";
import { applyBrokerImport, parseBrokerImport, uploadBrokerReport } from "./import-actions";
import { saveManualPositionPrice } from "./position-actions";

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
    parsing: "парсится",
    parsed: "распознан",
    normalized: "нормализован",
    failed: "ошибка",
    applied: "применён",
  };
  return labels[status] ?? status;
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

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-3xl border border-dashed border-border bg-surface p-8 text-sm text-muted">{text}</div>;
}

function MetricCard({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <article className="rounded-3xl border border-border bg-surface p-6">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p>
      <p className="mt-2 text-xs text-muted">{hint}</p>
    </article>
  );
}

function DashboardView({ data }: { data: PortfolioData }) {
  const activeAccounts = data.accounts.filter((account) => account.status === "active").length;
  const positionsValue = data.positions.reduce((total, position) => total + (position.market_value ?? position.book_value), 0);
  const positionsPnl = data.positions.reduce((total, position) => total + (position.unrealized_pnl ?? 0), 0);

  return (
    <div className="space-y-8">
      <div className="grid gap-4 md:grid-cols-5">
        <MetricCard label="Портфели" value={data.portfolios.length} hint={`Базовая валюта: ${data.family?.baseCurrency ?? "—"}`} />
        <MetricCard label="Счета" value={activeAccounts} hint="Активные счета в семье" />
        <MetricCard label="Активы" value={data.assets.length} hint="Стартовый справочник" />
        <MetricCard label="Позиции" value={data.positions.length} hint={formatMoney(positionsValue, data.family?.baseCurrency ?? "RUB")} />
        <MetricCard label="P&L" value={formatSignedMoney(positionsPnl, data.family?.baseCurrency ?? "RUB")} hint="По ручным рыночным ценам" />
      </div>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-3xl border border-border bg-surface p-6">
          <h2 className="text-lg font-semibold">Портфели</h2>
          <div className="mt-5 space-y-3">
            {data.portfolios.map((portfolio) => (
              <div className="rounded-2xl border border-border bg-background p-4" key={portfolio.id}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{portfolio.name}</p>
                    <p className="mt-1 text-sm text-muted">{portfolio.description ?? "Без описания"}</p>
                  </div>
                  <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">{portfolio.base_currency}</span>
                </div>
              </div>
            ))}
            {data.portfolios.length === 0 && <EmptyState text="Портфель пока не создан." />}
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-surface p-6">
          <h2 className="text-lg font-semibold">Ближайшие действия</h2>
          <ol className="mt-5 space-y-3 text-sm text-muted">
            <li className="rounded-2xl bg-background p-4">1. Загрузить ещё один отчёт для проверки нескольких операций.</li>
            <li className="rounded-2xl bg-background p-4">2. Сверить позиции по активам и счетам.</li>
            <li className="rounded-2xl bg-background p-4">3. Подключить рыночные цены для оценки портфеля.</li>
          </ol>
        </div>
      </section>

      <PositionsView positions={data.positions} />
    </div>
  );
}

function AccountsView({ accounts }: { accounts: Account[] }) {
  if (accounts.length === 0) return <EmptyState text="Счета пока не созданы." />;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {accounts.map((account) => (
        <article className="rounded-3xl border border-border bg-surface p-6" key={account.id}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-muted">{accountTypeLabel(account.account_type_code)}</p>
              <h2 className="mt-2 text-xl font-semibold">{account.name}</h2>
              <p className="mt-2 text-sm text-muted">{account.institution_name ?? "Организация не указана"}</p>
            </div>
            <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">{account.currency_code}</span>
          </div>
          <p className="mt-6 text-xs text-muted">Статус: {statusLabel(account.status)}</p>
        </article>
      ))}
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

function PositionsView({ positions }: { positions: Position[] }) {
  if (positions.length === 0) return <EmptyState text="Позиции пока не сформированы. Они появятся после применения операций покупки/продажи." />;

  const defaultDate = todayIsoDate();

  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-surface">
      <div className="border-b border-border p-6">
        <h2 className="text-lg font-semibold">Текущие позиции</h2>
        <p className="mt-2 text-sm text-muted">Расчёт строится из операций и последней ручной рыночной оценки, если она сохранена.</p>
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
          {positions.map((position) => (
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
                {position.asset_id ? (
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
  );
}

function AssetsView({ data, priceError, priced }: { data: PortfolioData; priceError?: string; priced?: string }) {
  const { assets, positions } = data;
  if (assets.length === 0) return <EmptyState text="Активы пока не созданы." />;

  return (
    <div className="space-y-6">
      <PriceNotice priceError={priceError} priced={priced} />
      <PositionsView positions={positions} />
      <div className="overflow-hidden rounded-3xl border border-border bg-surface">
        <div className="border-b border-border p-6">
          <h2 className="text-lg font-semibold">Справочник активов</h2>
          <p className="mt-2 text-sm text-muted">Все активы семьи, включая те, по которым пока нет открытой позиции.</p>
        </div>
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="border-b border-border text-muted">
            <tr>
              <th className="px-5 py-4 font-medium">Актив</th>
              <th className="px-5 py-4 font-medium">Тип</th>
              <th className="px-5 py-4 font-medium">Тикер</th>
              <th className="px-5 py-4 font-medium">Рынок</th>
              <th className="px-5 py-4 font-medium">Валюта</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => (
              <tr className="border-b border-border last:border-0" key={asset.id}>
                <td className="px-5 py-4 font-medium">{asset.name}</td>
                <td className="px-5 py-4 text-muted">{assetTypeLabel(asset.asset_type_code)}</td>
                <td className="px-5 py-4 text-muted">{asset.ticker ?? "—"}</td>
                <td className="px-5 py-4 text-muted">{asset.market ?? "—"}</td>
                <td className="px-5 py-4 text-muted">{asset.currency_code ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OperationsView({ operations }: { operations: Operation[] }) {
  if (operations.length === 0) return <EmptyState text="Операций пока нет. Они появятся после применения строк импорта." />;

  return (
    <div className="space-y-3">
      {operations.map((operation) => (
        <div className="rounded-2xl border border-border bg-surface p-4" key={operation.id}>
          <p className="font-medium">{operation.operation_type_code}</p>
          <p className="mt-1 text-sm text-muted">
            {operation.trade_date} · {operation.net_amount} {operation.currency_code}
          </p>
        </div>
      ))}
    </div>
  );
}

function ImportUploadForm({ accounts }: { accounts: Account[] }) {
  const activeAccounts = accounts.filter((account) => account.status === "active");

  return (
    <form action={uploadBrokerReport} className="rounded-3xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-accent">Первый рабочий импорт</p>
          <h2 className="mt-2 text-xl font-semibold">Загрузить брокерский отчёт</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Файл сохранится в private bucket, а в журнале появится запись со статусом “загружен”.
            Разбор CSV уже доступен; XLSX и PDF подключим следующим шагом.
          </p>
        </div>
        <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">PDF · CSV · XLS · XLSX</span>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-[1fr_1.4fr_auto] md:items-end">
        <label className="grid gap-2 text-sm">
          <span className="font-medium">Счёт</span>
          <select className="h-11 rounded-2xl border border-border bg-background px-4" disabled={activeAccounts.length === 0} name="account_id" required>
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
            name="report"
            required
            type="file"
          />
        </label>

        <button className="h-11 rounded-2xl bg-accent px-5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50" disabled={activeAccounts.length === 0} type="submit">
          Загрузить
        </button>
      </div>
    </form>
  );
}

function ImportNotice({
  applied,
  applyError,
  error,
  parsed,
  parseError,
  uploaded,
}: {
  applied?: string;
  applyError?: string;
  error?: string;
  parsed?: string;
  parseError?: string;
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
    "csv-only": "Сейчас поддержан разбор только CSV. XLSX и PDF добавим следующим шагом.",
    "download-failed": "Не удалось скачать файл из private bucket.",
    "empty-csv": "В CSV нет строк данных.",
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

  if (uploaded) return <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">Файл загружен, запись импорта создана.</div>;
  if (parsed) return <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">CSV разобран, строки импорта сохранены.</div>;
  if (applied) return <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">Импорт применён, операции портфеля созданы.</div>;
  if (parseError) return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{parseErrors[parseError] ?? "Не удалось разобрать файл."}</div>;
  if (applyError) return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{applyErrors[applyError] ?? "Не удалось применить импорт."}</div>;
  if (!error) return null;
  return <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">{errors[error] ?? "Не удалось загрузить файл."}</div>;
}

function normalizedPreview(value: Record<string, unknown> | null) {
  if (!value) return "—";
  const parts = [value.trade_date, value.operation_type, value.ticker, value.quantity, value.price, value.currency]
    .filter((item) => item !== null && item !== undefined && item !== "");
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function canParseCsv(importJob: ImportJob) {
  return importJob.original_file_name.toLowerCase().endsWith(".csv")
    && ["uploaded", "parsed", "failed"].includes(importJob.status);
}

function canApplyImport(importJob: ImportJob, rows: PortfolioData["importRows"]) {
  return ["parsed", "failed"].includes(importJob.status)
    && rows.some((row) => row.status === "normalized");
}

function ImportsView({ data }: { data: PortfolioData }) {
  if (data.imports.length === 0) return <EmptyState text="Файлы ещё не загружались. Контур импорта и private bucket уже готовы." />;

  return (
    <div className="space-y-3">
      {data.imports.map((importJob) => {
        const rows = data.importRows.filter((row) => row.import_id === importJob.id);

        return (
          <div className="rounded-2xl border border-border bg-surface p-4" key={importJob.id}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="font-medium">{importJob.original_file_name}</p>
                <p className="mt-1 text-sm text-muted">
                  Статус: {statusLabel(importJob.status)} · {formatFileSize(importJob.file_size_bytes)}
                </p>
                <p className="mt-2 break-all text-xs text-muted">{importJob.storage_object_key}</p>
              </div>
              <span className="rounded-full bg-background px-3 py-1 text-xs text-muted">SHA-256: {importJob.sha256.slice(0, 10)}…</span>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              {canParseCsv(importJob) && (
                <form action={parseBrokerImport}>
                  <input name="import_id" type="hidden" value={importJob.id} />
                  <button className="rounded-2xl bg-accent px-4 py-2 text-xs font-medium text-white" type="submit">
                    Разобрать CSV
                  </button>
                </form>
              )}
              {canApplyImport(importJob, rows) && (
                <form action={applyBrokerImport}>
                  <input name="import_id" type="hidden" value={importJob.id} />
                  <button className="rounded-2xl bg-emerald-600 px-4 py-2 text-xs font-medium text-white" type="submit">
                    Применить в операции
                  </button>
                </form>
              )}
              {rows.length > 0 && <span className="rounded-full bg-background px-3 py-1 text-xs text-muted">Строк: {rows.length}</span>}
            </div>

            {rows.length > 0 && (
              <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-background">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead className="border-b border-border text-muted">
                    <tr>
                      <th className="px-4 py-3 font-medium">Строка</th>
                      <th className="px-4 py-3 font-medium">Статус</th>
                      <th className="px-4 py-3 font-medium">Нормализация</th>
                      <th className="px-4 py-3 font-medium">Ошибка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr className="border-b border-border last:border-0" key={row.id}>
                        <td className="px-4 py-3">{row.row_number}</td>
                        <td className="px-4 py-3">{statusLabel(row.status)}</td>
                        <td className="px-4 py-3 text-muted">{normalizedPreview(row.normalized_data)}</td>
                        <td className="px-4 py-3 text-muted">{row.error_message ?? "—"}</td>
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

function SettingsView({ data }: { data: PortfolioData }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <MetricCard label="Семья" value={data.family?.name ?? "—"} hint={`Ваша роль: ${data.family?.role ?? "—"}`} />
      <MetricCard label="Базовая валюта" value={data.family?.baseCurrency ?? "—"} hint="Берётся из family settings" />
      <MetricCard label="Хранилище" value="broker-reports" hint="Private bucket для отчётов" />
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
  error,
  priced,
  priceError,
  parsed,
  parseError,
  section,
  uploaded,
}: {
  applied?: string;
  applyError?: string;
  data: PortfolioData;
  error?: string;
  priced?: string;
  priceError?: string;
  parsed?: string;
  parseError?: string;
  section: string;
  uploaded?: string;
}) {
  if (!data.family) return <EmptyState text="Для пользователя пока не назначена семья. Нужно добавить запись в family_members." />;

  if (section === "dashboard") return <DashboardView data={data} />;
  if (section === "accounts") return <AccountsView accounts={data.accounts} />;
  if (section === "assets") return <AssetsView data={data} priceError={priceError} priced={priced} />;
  if (section === "import") {
    return (
      <div className="space-y-6">
        <ImportNotice applied={applied} applyError={applyError} error={error} parsed={parsed} parseError={parseError} uploaded={uploaded} />
        <ImportUploadForm accounts={data.accounts} />
        <div className="rounded-3xl border border-border bg-surface p-6">
          <p className="text-sm font-medium text-accent">Storage готов</p>
          <h2 className="mt-2 text-xl font-semibold">Private bucket: broker-reports</h2>
          <p className="mt-2 text-sm text-muted">Путь файла: families/&lbrace;family_id&rbrace;/imports/&lbrace;import_id&rbrace;/filename.pdf</p>
        </div>
        <ImportsView data={data} />
      </div>
    );
  }
  if (section === "settings") return <SettingsView data={data} />;
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
          error={queryValue(query.error)}
          priced={queryValue(query.priced)}
          priceError={queryValue(query.price_error)}
          parsed={queryValue(query.parsed)}
          parseError={queryValue(query.parse_error)}
          section={section}
          uploaded={queryValue(query.uploaded)}
        />
      </div>
      {section === "dashboard" && (
        <div className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Последние операции</h2>
          <OperationsView operations={data.operations} />
        </div>
      )}
    </section>
  );
}

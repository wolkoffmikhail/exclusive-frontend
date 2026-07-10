import { notFound, redirect } from "next/navigation";
import { getActiveFamily, getPortfolioData, type Account, type Asset, type ImportJob, type Operation, type PortfolioData } from "@/lib/portfolio/data";
import { createClient } from "@/lib/supabase/server";
import { uploadBrokerReport } from "./import-actions";

const sections: Record<string, { title: string; description: string }> = {
  dashboard: {
    title: "Обзор портфеля",
    description: "Структура семейного портфеля, счета, активы и ближайшие действия.",
  },
  accounts: {
    title: "Счета",
    description: "Брокерские, банковские и другие счета семьи.",
  },
  assets: {
    title: "Активы",
    description: "Справочник активов, который будет использоваться в операциях и отчётах.",
  },
  import: {
    title: "Импорт",
    description: "Загрузка брокерских отчётов и журнал обработки файлов.",
  },
  recommendations: {
    title: "Рекомендации",
    description: "Сигналы и предложения по управлению портфелем.",
  },
  news: {
    title: "Новости",
    description: "Новости, связанные с активами портфеля.",
  },
  watchlist: {
    title: "Watchlist",
    description: "Активы и идеи для наблюдения.",
  },
  events: {
    title: "События",
    description: "Дивиденды, купоны, погашения и другие события.",
  },
  settings: {
    title: "Настройки",
    description: "Семья, пользователи, роли, валюты и правила импорта.",
  },
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
    applied: "применён",
    failed: "ошибка",
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

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-3xl border border-dashed border-border bg-surface p-8 text-sm text-muted">
      {text}
    </div>
  );
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

  return (
    <div className="space-y-8">
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Портфели" value={data.portfolios.length} hint={`Базовая валюта: ${data.family?.baseCurrency ?? "—"}`} />
        <MetricCard label="Счета" value={activeAccounts} hint="Активные счета в семье" />
        <MetricCard label="Активы" value={data.assets.length} hint="Стартовый справочник" />
        <MetricCard label="Операции" value={data.operations.length} hint="Пока ждём первый импорт" />
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
                  <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
                    {portfolio.base_currency}
                  </span>
                </div>
              </div>
            ))}
            {data.portfolios.length === 0 && <EmptyState text="Портфель пока не создан." />}
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-surface p-6">
          <h2 className="text-lg font-semibold">Ближайшие действия</h2>
          <ol className="mt-5 space-y-3 text-sm text-muted">
            <li className="rounded-2xl bg-background p-4">1. Загрузить первый брокерский отчёт в private bucket.</li>
            <li className="rounded-2xl bg-background p-4">2. Разобрать строки импорта в операции.</li>
            <li className="rounded-2xl bg-background p-4">3. Построить первые позиции и денежные остатки.</li>
          </ol>
        </div>
      </section>
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
            <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
              {account.currency_code}
            </span>
          </div>
          <p className="mt-6 text-xs text-muted">Статус: {statusLabel(account.status)}</p>
        </article>
      ))}
    </div>
  );
}

function AssetsView({ assets }: { assets: Asset[] }) {
  if (assets.length === 0) return <EmptyState text="Активы пока не созданы." />;

  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-surface">
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
  );
}

function OperationsView({ operations }: { operations: Operation[] }) {
  if (operations.length === 0) {
    return <EmptyState text="Операций пока нет. Они появятся после первого импорта или ручного ввода." />;
  }

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
            Парсинг и разбор строк добавим следующим шагом.
          </p>
        </div>
        <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
          PDF · CSV · XLS · XLSX
        </span>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-[1fr_1.4fr_auto] md:items-end">
        <label className="grid gap-2 text-sm">
          <span className="font-medium">Счёт</span>
          <select
            className="h-11 rounded-2xl border border-border bg-background px-4"
            disabled={activeAccounts.length === 0}
            name="account_id"
            required
          >
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

        <button
          className="h-11 rounded-2xl bg-accent px-5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          disabled={activeAccounts.length === 0}
          type="submit"
        >
          Загрузить
        </button>
      </div>
    </form>
  );
}

function ImportNotice({ error, uploaded }: { error?: string; uploaded?: string }) {
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

  if (uploaded) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        Файл загружен, запись импорта создана.
      </div>
    );
  }

  if (!error) return null;

  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
      {errors[error] ?? "Не удалось загрузить файл."}
    </div>
  );
}

function ImportsView({ imports }: { imports: ImportJob[] }) {
  if (imports.length === 0) {
    return <EmptyState text="Файлы ещё не загружались. Контур импорта и private bucket уже готовы." />;
  }

  return (
    <div className="space-y-3">
      {imports.map((importJob) => (
        <div className="rounded-2xl border border-border bg-surface p-4" key={importJob.id}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-medium">{importJob.original_file_name}</p>
              <p className="mt-1 text-sm text-muted">
                Статус: {statusLabel(importJob.status)} · {formatFileSize(importJob.file_size_bytes)}
              </p>
              <p className="mt-2 break-all text-xs text-muted">{importJob.storage_object_key}</p>
            </div>
            <span className="rounded-full bg-background px-3 py-1 text-xs text-muted">
              SHA-256: {importJob.sha256.slice(0, 10)}…
            </span>
          </div>
        </div>
      ))}
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
  data,
  error,
  section,
  uploaded,
}: {
  data: PortfolioData;
  error?: string;
  section: string;
  uploaded?: string;
}) {
  if (!data.family) {
    return <EmptyState text="Для пользователя пока не назначена семья. Нужно добавить запись в family_members." />;
  }

  if (section === "dashboard") return <DashboardView data={data} />;
  if (section === "accounts") return <AccountsView accounts={data.accounts} />;
  if (section === "assets") return <AssetsView assets={data.assets} />;
  if (section === "import") {
    return (
      <div className="space-y-6">
        <ImportNotice error={error} uploaded={uploaded} />
        <ImportUploadForm accounts={data.accounts} />
        <div className="rounded-3xl border border-border bg-surface p-6">
          <p className="text-sm font-medium text-accent">Storage готов</p>
          <h2 className="mt-2 text-xl font-semibold">Private bucket: broker-reports</h2>
          <p className="mt-2 text-sm text-muted">
            Путь файла: families/&lbrace;family_id&rbrace;/imports/&lbrace;import_id&rbrace;/filename.pdf
          </p>
        </div>
        <ImportsView imports={data.imports} />
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
          data={data}
          error={queryValue(query.error)}
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

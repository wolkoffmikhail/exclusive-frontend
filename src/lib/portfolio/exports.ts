import * as XLSX from "xlsx";
import { buildPortfolioAnalytics, type PeriodKey, type PortfolioAnalytics } from "./analytics";
import type { PortfolioData } from "./data";
import type { WhatIfScenarioResult } from "./scenarios";

export type PortfolioExportFormat = "excel" | "pdf-html";

export type PortfolioExportScope = {
  period?: PeriodKey;
  portfolioId?: string | null;
  accountId?: string | null;
  includeScenario?: boolean;
};

export type ExportSheet = {
  name: string;
  rows: Array<Record<string, string | number | null>>;
};

export type PortfolioExportViewModel = {
  fileBaseName: string;
  title: string;
  generatedAt: string;
  baseCurrency: string;
  scope: {
    familyName: string;
    portfolioName: string;
    accountName: string;
    period: PeriodKey;
  };
  warnings: string[];
  sheets: ExportSheet[];
};

function numberValue(value: number | string | null | undefined) {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateStamp(value: string) {
  return value.slice(0, 10).replaceAll("-", "");
}

function safeFilePart(value: string) {
  return value
    .trim()
    .replace(/[^\p{L}\p{N}\-_]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "portfolio";
}

type ExportDataset = {
  analytics: PortfolioAnalytics;
  positions: PortfolioData["positions"];
  cashBalances: PortfolioData["cashBalances"];
  operations: PortfolioData["operations"];
  recommendations: PortfolioData["recommendations"];
};

function selectedPeriod(analytics: PortfolioAnalytics, period: PeriodKey) {
  return analytics.cashFlowPeriods.find((item) => item.period === period) ?? analytics.cashFlowPeriods[0];
}

function positionValue(position: PortfolioData["positions"][number]) {
  return position.market_value ?? position.book_value;
}

function percent(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value * 10000) / 100;
}

function operationAssetName(data: PortfolioData, assetId: string | null) {
  if (!assetId) return "";
  return data.assets.find((asset) => asset.id === assetId)?.name ?? assetId;
}

function operationAccountName(data: PortfolioData, accountId: string) {
  return data.accounts.find((account) => account.id === accountId)?.name ?? accountId;
}

function scenarioRows(scenario: WhatIfScenarioResult | null | undefined) {
  if (!scenario?.ok) return [];

  return [
    {
      "Параметр": "Тип",
      "До": null,
      "После": scenario.input.scenarioType === "buy" ? "Покупка" : "Продажа",
      "Дельта": null,
    },
    {
      "Параметр": "Количество",
      "До": null,
      "После": scenario.input.quantity,
      "Дельта": null,
    },
    {
      "Параметр": "Цена",
      "До": null,
      "После": scenario.input.price,
      "Дельта": null,
    },
    {
      "Параметр": "Комиссия",
      "До": null,
      "После": scenario.input.commission,
      "Дельта": null,
    },
    ...scenario.metrics.map((metric) => ({
      "Параметр": metric.label,
      "До": metric.before,
      "После": metric.after,
      "Дельта": metric.delta,
    })),
  ];
}

function warningRows(warnings: string[]) {
  return warnings.length > 0
    ? warnings.map((warning) => ({ "Предупреждение": warning }))
    : [{ "Предупреждение": "Ограничений данных для выбранного отчета не зафиксировано." }];
}

function accountBelongsToPortfolio(data: PortfolioData, accountId: string, portfolioId: string | null | undefined) {
  if (!portfolioId) return true;
  return data.accounts.some((account) => account.id === accountId && account.portfolio_id === portfolioId);
}

function buildExportDataset(data: PortfolioData, scope: PortfolioExportScope): ExportDataset {
  const positions = data.positions.filter((position) => (
    (!scope.portfolioId || position.portfolio_id === scope.portfolioId)
    && (!scope.accountId || position.account_id === scope.accountId)
  ));
  const cashBalances = data.cashBalances.filter((balance) => (
    (!scope.portfolioId || balance.portfolio_id === scope.portfolioId)
    && (!scope.accountId || balance.account_id === scope.accountId)
  ));
  const operations = data.operations.filter((operation) => (
    (!scope.accountId || operation.account_id === scope.accountId)
    && accountBelongsToPortfolio(data, operation.account_id, scope.portfolioId)
  ));
  const analytics = buildPortfolioAnalytics({
    operations,
    positions,
    cashBalances,
    baseCurrency: data.analytics.baseCurrency,
    asOf: data.analytics.asOf,
  });
  const recommendations = data.recommendations.filter((recommendation) => (
    recommendation.status !== "archived"
    && (!scope.portfolioId || recommendation.portfolio_id === null || recommendation.portfolio_id === scope.portfolioId)
  ));

  return { analytics, positions, cashBalances, operations, recommendations };
}

function buildWarnings(dataset: ExportDataset, scenario: WhatIfScenarioResult | null | undefined) {
  const warnings = dataset.analytics.alerts.map((alert) => alert.message);

  if (scenario?.ok) {
    warnings.push(...scenario.diagnostics.map((diagnostic) => diagnostic.message));
  }

  if (scenario && !scenario.ok) {
    warnings.push(...scenario.diagnostics.map((diagnostic) => diagnostic.message));
  }

  return Array.from(new Set(warnings));
}

export function buildPortfolioExportViewModel({
  data,
  generatedAt = new Date().toISOString(),
  scenario,
  scope = {},
}: {
  data: PortfolioData;
  generatedAt?: string;
  scenario?: WhatIfScenarioResult | null;
  scope?: PortfolioExportScope;
}): PortfolioExportViewModel {
  const period = scope.period ?? "1M";
  const portfolio = scope.portfolioId ? data.portfolios.find((item) => item.id === scope.portfolioId) : null;
  const account = scope.accountId ? data.accounts.find((item) => item.id === scope.accountId) : null;
  const dataset = buildExportDataset(data, scope);
  const cashFlowPeriod = selectedPeriod(dataset.analytics, period);
  const warnings = buildWarnings(dataset, scenario);
  const baseCurrency = dataset.analytics.baseCurrency;
  const title = "Управленческий отчет по портфелю";
  const familyName = data.family?.name ?? "Семья не назначена";
  const fileBaseName = `${safeFilePart(familyName)}-${dateStamp(generatedAt)}`;

  const sheets: ExportSheet[] = [
    {
      name: "Summary",
      rows: [
        { "Показатель": "Стоимость портфеля", "Значение": dataset.analytics.totalValue, "Валюта": baseCurrency },
        { "Показатель": "Инвестировано", "Значение": dataset.analytics.investedValue, "Валюта": baseCurrency },
        { "Показатель": "Кэш", "Значение": dataset.analytics.cashValue, "Валюта": baseCurrency },
        { "Показатель": "P&L", "Значение": dataset.analytics.unrealizedPnl, "Валюта": baseCurrency },
        { "Показатель": "XIRR", "Значение": dataset.analytics.xirr.value === null ? null : percent(dataset.analytics.xirr.value), "Валюта": "%" },
        { "Показатель": "Позиций", "Значение": dataset.analytics.positionCount, "Валюта": "" },
      ],
    },
    {
      name: "Positions",
      rows: dataset.positions.map((position) => ({
        "Актив": position.asset_name,
        "Тикер": position.ticker ?? "",
        "Счет": position.account_name,
        "Класс": position.asset_type_code ?? "",
        "Количество": position.quantity,
        "Средняя цена": position.average_price,
        "Балансовая стоимость": position.book_value,
        "Текущая цена": position.market_price,
        "Рыночная стоимость": position.market_value,
        "Стоимость для отчета": positionValue(position),
        "P&L": position.unrealized_pnl,
        "Валюта": position.currency_code,
        "Дата оценки": position.valuation_date ?? "",
      })),
    },
    {
      name: "Cashflows",
      rows: (cashFlowPeriod?.flows ?? []).map((flow) => ({
        "Дата": flow.date,
        "Тип": flow.operationType,
        "Счет": operationAccountName(data, flow.accountId),
        "Направление": flow.direction,
        "Сумма": flow.amount,
        "Валюта": flow.currencyCode,
        "Источник": flow.source ?? "",
      })),
    },
    {
      name: "Operations",
      rows: dataset.operations.slice(0, 500).map((operation) => ({
        "Дата": operation.trade_date,
        "Тип": operation.operation_type_code,
        "Счет": operationAccountName(data, operation.account_id),
        "Актив": operationAssetName(data, operation.asset_id),
        "Количество": numberValue(operation.quantity),
        "Цена": numberValue(operation.price),
        "Gross": numberValue(operation.gross_amount),
        "Комиссия": numberValue(operation.fee_amount),
        "Налог": numberValue(operation.tax_amount),
        "Net": numberValue(operation.net_amount),
        "Валюта": operation.currency_code,
        "Источник": operation.source,
      })),
    },
    {
      name: "Recommendations",
      rows: dataset.recommendations.map((recommendation) => ({
        "Приоритет": recommendation.priority,
        "Статус": recommendation.status,
        "Тип": recommendation.recommendation_type,
        "Название": recommendation.title,
        "Причина": recommendation.reason ?? "",
        "Источник": recommendation.source,
        "Уверенность": numberValue(recommendation.confidence),
        "Обновлено": recommendation.updated_at,
      })),
    },
    {
      name: "Warnings",
      rows: warningRows(warnings),
    },
    {
      name: "Metadata",
      rows: [
        { "Ключ": "Дата формирования", "Значение": generatedAt },
        { "Ключ": "Семья", "Значение": familyName },
        { "Ключ": "Портфель", "Значение": portfolio?.name ?? "Все портфели" },
        { "Ключ": "Счет", "Значение": account?.name ?? "Все счета" },
        { "Ключ": "Период потоков", "Значение": period },
        { "Ключ": "Базовая валюта", "Значение": baseCurrency },
        { "Ключ": "What-if включен", "Значение": scenario?.ok ? "да" : "нет" },
      ],
    },
  ];

  if (scope.includeScenario && scenario?.ok) {
    sheets.splice(5, 0, {
      name: "Scenario",
      rows: scenarioRows(scenario),
    });
  }

  return {
    fileBaseName,
    title,
    generatedAt,
    baseCurrency,
    scope: {
      familyName,
      portfolioName: portfolio?.name ?? "Все портфели",
      accountName: account?.name ?? "Все счета",
      period,
    },
    warnings,
    sheets,
  };
}

export function buildPortfolioExcelWorkbook(viewModel: PortfolioExportViewModel) {
  const workbook = XLSX.utils.book_new();

  for (const sheet of viewModel.sheets) {
    const worksheet = XLSX.utils.json_to_sheet(sheet.rows.length > 0 ? sheet.rows : [{}]);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31));
  }

  return workbook;
}

export function buildPortfolioExcelBuffer(viewModel: PortfolioExportViewModel): Buffer {
  return XLSX.write(buildPortfolioExcelWorkbook(viewModel), {
    bookType: "xlsx",
    type: "buffer",
  }) as Buffer;
}

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlTable(sheet: ExportSheet, limit = 12) {
  const rows = sheet.rows.slice(0, limit);
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  if (rows.length === 0 || columns.length === 0) return "<p>Нет данных.</p>";

  return `
    <table>
      <thead><tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead>
      <tbody>
        ${rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(row[column])}</td>`).join("")}</tr>`).join("")}
      </tbody>
    </table>
  `;
}

export function buildPortfolioReportHtml(viewModel: PortfolioExportViewModel) {
  const summary = viewModel.sheets.find((sheet) => sheet.name === "Summary");
  const positions = viewModel.sheets.find((sheet) => sheet.name === "Positions");
  const cashflows = viewModel.sheets.find((sheet) => sheet.name === "Cashflows");
  const recommendations = viewModel.sheets.find((sheet) => sheet.name === "Recommendations");
  const scenario = viewModel.sheets.find((sheet) => sheet.name === "Scenario");

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(viewModel.title)}</title>
  <style>
    body { color: #122016; font-family: Arial, sans-serif; margin: 40px; }
    h1 { font-size: 28px; margin: 0 0 8px; }
    h2 { border-top: 1px solid #d8dfd9; font-size: 18px; margin-top: 28px; padding-top: 18px; }
    p { color: #5f6f63; }
    table { border-collapse: collapse; font-size: 12px; margin-top: 12px; width: 100%; }
    th, td { border: 1px solid #d8dfd9; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #eef4ef; }
    .warning { background: #fff8e5; border: 1px solid #ecd79a; margin: 8px 0; padding: 10px; }
    @media print { body { margin: 20mm; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(viewModel.title)}</h1>
  <p>${escapeHtml(viewModel.scope.familyName)} · ${escapeHtml(viewModel.scope.portfolioName)} · ${escapeHtml(viewModel.scope.accountName)} · ${escapeHtml(viewModel.generatedAt)}</p>
  ${viewModel.warnings.map((warning) => `<div class="warning">${escapeHtml(warning)}</div>`).join("")}
  <h2>Summary</h2>
  ${summary ? htmlTable(summary) : "<p>Нет данных.</p>"}
  <h2>Positions</h2>
  ${positions ? htmlTable(positions) : "<p>Нет данных.</p>"}
  <h2>Cashflows</h2>
  ${cashflows ? htmlTable(cashflows) : "<p>Нет данных.</p>"}
  <h2>Recommendations</h2>
  ${recommendations ? htmlTable(recommendations) : "<p>Нет данных.</p>"}
  ${scenario ? `<h2>What-if</h2>${htmlTable(scenario)}` : ""}
</body>
</html>`;
}

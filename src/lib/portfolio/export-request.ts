import type { PeriodKey } from "./analytics";
import type { PortfolioData } from "./data";
import type { PortfolioExportScope } from "./exports";
import type { WhatIfScenarioResult } from "./scenarios";

export type PortfolioExportRequestFormat = "excel" | "pdf-html";

export type PortfolioExportRequest = {
  format: PortfolioExportRequestFormat;
  scope: PortfolioExportScope;
};

export type PortfolioExportRequestError =
  | "portfolio-not-found"
  | "account-not-found"
  | "account-portfolio-mismatch";

export type PortfolioExportAuditPayload = {
  format: PortfolioExportRequestFormat;
  period: PeriodKey;
  portfolio_id: string | null;
  account_id: string | null;
  include_scenario: boolean;
  include_llm_summary: boolean;
  scenario_ok: boolean | null;
  scenario_type: "buy" | "sell" | null;
  generated_at: string;
  sheets: string[];
  warnings_count: number;
};

function period(value: string | null): PeriodKey {
  if (value === "3M" || value === "YTD" || value === "1Y" || value === "All") return value;
  return "1M";
}

function emptyToNull(value: string | null) {
  return value && value.trim() ? value : null;
}

export function parsePortfolioExportRequest(searchParams: URLSearchParams): PortfolioExportRequest {
  return {
    format: searchParams.get("format") === "pdf-html" ? "pdf-html" : "excel",
    scope: {
      period: period(searchParams.get("period")),
      portfolioId: emptyToNull(searchParams.get("portfolio_id")),
      accountId: emptyToNull(searchParams.get("account_id")),
      includeScenario: searchParams.get("include_scenario") === "1",
      includeLlmSummary: searchParams.get("include_llm_summary") === "1",
    },
  };
}

export function validatePortfolioExportScope(data: PortfolioData, scope: PortfolioExportScope): PortfolioExportRequestError | null {
  const portfolio = scope.portfolioId ? data.portfolios.find((item) => item.id === scope.portfolioId) : null;
  if (scope.portfolioId && !portfolio) return "portfolio-not-found";

  const account = scope.accountId ? data.accounts.find((item) => item.id === scope.accountId) : null;
  if (scope.accountId && !account) return "account-not-found";
  if (account && portfolio && account.portfolio_id !== portfolio.id) return "account-portfolio-mismatch";

  return null;
}

export function exportRequestErrorMessage(error: PortfolioExportRequestError) {
  const messages: Record<PortfolioExportRequestError, string> = {
    "portfolio-not-found": "Portfolio scope was not found for the active family.",
    "account-not-found": "Account scope was not found for the active family.",
    "account-portfolio-mismatch": "Account does not belong to the selected portfolio.",
  };
  return messages[error];
}

export function buildPortfolioExportAuditPayload({
  format,
  generatedAt,
  scenario,
  scope,
  sheets,
  warningsCount,
}: {
  format: PortfolioExportRequestFormat;
  generatedAt: string;
  scenario: WhatIfScenarioResult | null;
  scope: PortfolioExportScope;
  sheets: string[];
  warningsCount: number;
}): PortfolioExportAuditPayload {
  return {
    format,
    period: scope.period ?? "1M",
    portfolio_id: scope.portfolioId ?? null,
    account_id: scope.accountId ?? null,
    include_scenario: Boolean(scope.includeScenario),
    include_llm_summary: Boolean(scope.includeLlmSummary),
    scenario_ok: scenario?.ok ?? null,
    scenario_type: scenario?.ok ? scenario.input.scenarioType : null,
    generated_at: generatedAt,
    sheets,
    warnings_count: warningsCount,
  };
}

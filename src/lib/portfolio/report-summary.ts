import type { PortfolioData, LlmAnalysis } from "./data";
import type { PortfolioExportScope } from "./exports";

export type ReportLlmSummaryRow = Record<string, string | number | null>;

type Citation = {
  id?: string;
  title?: string;
  url?: string;
};

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function citationText(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const citation = value as Citation;
  const title = textValue(citation.title) ?? textValue(citation.id) ?? "source";
  const url = textValue(citation.url);
  return url ? `${title} (${url})` : title;
}

function listText(values: unknown[]) {
  return values
    .map((value) => {
      if (typeof value === "string") return value.trim();
      if (value && typeof value === "object" && "text" in value) return textValue((value as { text?: unknown }).text);
      return null;
    })
    .filter((value): value is string => Boolean(value))
    .join("; ");
}

function analysisRank(analysis: LlmAnalysis) {
  if (analysis.analysis_type === "report_summary") return 0;
  if (analysis.analysis_type === "recommendation_explanation") return 1;
  if (analysis.analysis_type === "portfolio_impact") return 2;
  if (analysis.analysis_type === "summary") return 3;
  return 4;
}

function readyAnalyses(data: PortfolioData) {
  return data.llmAnalyses
    .filter((analysis) => analysis.status === "ready" && textValue(analysis.summary))
    .sort((a, b) => analysisRank(a) - analysisRank(b) || b.created_at.localeCompare(a.created_at));
}

function sourceDocumentTitle(data: PortfolioData, sourceDocumentId: string | null) {
  if (!sourceDocumentId) return "";
  return data.sourceDocuments.find((document) => document.id === sourceDocumentId)?.title ?? sourceDocumentId;
}

function overviewText(data: PortfolioData, scope: PortfolioExportScope) {
  const portfolioName = scope.portfolioId
    ? data.portfolios.find((portfolio) => portfolio.id === scope.portfolioId)?.name ?? scope.portfolioId
    : "all portfolios";
  const accountName = scope.accountId
    ? data.accounts.find((account) => account.id === scope.accountId)?.name ?? scope.accountId
    : "all accounts";

  return [
    `Scope: ${portfolioName}, ${accountName}`,
    `Portfolio value: ${Math.round(data.analytics.totalValue * 100) / 100} ${data.analytics.baseCurrency}`,
    `Open recommendations: ${data.recommendations.filter((recommendation) => recommendation.status === "open").length}`,
    `Source documents: ${data.sourceDocuments.length}`,
  ].join(". ");
}

export function buildReportLlmSummaryRows({ data, scope = {} }: { data: PortfolioData; scope?: PortfolioExportScope }): ReportLlmSummaryRow[] {
  const analyses = readyAnalyses(data).slice(0, 5);
  const overview: ReportLlmSummaryRow = {
    "Section": "Portfolio overview",
    "Generated marker": "LLM-generated section; local portfolio context",
    "Text": overviewText(data, scope),
    "Impact": "unknown",
    "Confidence": null,
    "Citations": "Portfolio data snapshot",
    "Limitations": "Generated from stored portfolio data and saved LLM analyses; not investment advice.",
    "Source document": "",
    "Analysis id": "",
  };

  if (analyses.length === 0) {
    return [
      overview,
      {
        "Section": "Saved LLM analyses",
        "Generated marker": "LLM-generated section; no ready saved LLM analysis",
        "Text": "No ready LLM analyses were available for this report scope at export time.",
        "Impact": "unknown",
        "Confidence": null,
        "Citations": "Portfolio data snapshot",
        "Limitations": "The section cannot cite external source documents until analyses are saved.",
        "Source document": "",
        "Analysis id": "",
      },
    ];
  }

  return [
    overview,
    ...analyses.map((analysis) => ({
      "Section": analysis.analysis_type,
      "Generated marker": "LLM-generated section; verify citations",
      "Text": textValue(analysis.summary) ?? "",
      "Impact": analysis.impact_level,
      "Confidence": numberValue(analysis.confidence),
      "Citations": analysis.citations.map(citationText).filter((value): value is string => Boolean(value)).join("; "),
      "Limitations": listText(analysis.limitations),
      "Source document": sourceDocumentTitle(data, analysis.source_document_id),
      "Analysis id": analysis.id,
    })),
  ];
}

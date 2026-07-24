import type { LlmAnalysis, PortfolioData, Recommendation, SourceDocument } from "./data";

export type DashboardTodayItem = {
  id: string;
  kind: "recommendation" | "source_document" | "llm_analysis";
  title: string;
  summary: string;
  badge: string;
  href: string;
  actionLabel: string;
  secondaryHref: string | null;
  secondaryActionLabel: string | null;
  tone: "critical" | "warning" | "info";
  createdAt: string;
  score: number;
};

type BuildDashboardTodayItemsInput = {
  data: Pick<PortfolioData, "assets" | "llmAnalyses" | "newsSources" | "recommendations" | "sourceDocumentLinks" | "sourceDocuments">;
  limit?: number;
};

type PortfolioLink = {
  entity_type?: unknown;
  entity_id?: unknown;
  label?: unknown;
};

type Citation = {
  url?: unknown;
};

function timestamp(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function recommendationPriorityScore(priority: string) {
  if (priority === "critical") return 100;
  if (priority === "high") return 80;
  if (priority === "normal") return 55;
  return 35;
}

function recommendationTone(priority: string): DashboardTodayItem["tone"] {
  if (priority === "critical") return "critical";
  if (priority === "high") return "warning";
  return "info";
}

function recommendationItem(recommendation: Recommendation): DashboardTodayItem {
  const hasAsset = Boolean(recommendation.linkedAssetId);

  return {
    id: `recommendation:${recommendation.id}`,
    kind: "recommendation",
    title: recommendation.title,
    summary: recommendation.reason ?? recommendation.body ?? recommendation.recommendation_type,
    badge: `Рекомендация · ${recommendation.priority}`,
    href: "/recommendations",
    actionLabel: "Открыть",
    secondaryHref: hasAsset ? `/what-if?asset_id=${encodeURIComponent(recommendation.linkedAssetId as string)}` : recommendation.href ?? null,
    secondaryActionLabel: hasAsset ? "What-if" : recommendation.href ? "Источник" : null,
    tone: recommendationTone(recommendation.priority),
    createdAt: recommendation.updated_at,
    score: recommendationPriorityScore(recommendation.priority) + timestamp(recommendation.updated_at) / 100000000000,
  };
}

function sourceDocumentItem({
  document,
  linkedAssetCount,
  sourceName,
}: {
  document: SourceDocument;
  linkedAssetCount: number;
  sourceName: string;
}): DashboardTodayItem {
  const createdAt = document.published_at ?? document.created_at;

  return {
    id: `source-document:${document.id}`,
    kind: "source_document",
    title: document.title,
    summary: document.raw_excerpt ?? [
      document.document_type,
      document.ticker,
      document.isin,
    ].filter(Boolean).join(" · "),
    badge: `${sourceName} · ${linkedAssetCount > 0 ? `${linkedAssetCount} связ.` : document.trust_level}`,
    href: "/news",
    actionLabel: "Открыть",
    secondaryHref: document.url,
    secondaryActionLabel: document.url ? "Источник" : null,
    tone: linkedAssetCount > 0 ? "warning" : "info",
    createdAt,
    score: 65 + Math.min(10, linkedAssetCount * 3) + timestamp(createdAt) / 100000000000,
  };
}

function analysisPrimaryLink(analysis: LlmAnalysis) {
  const links = analysis.portfolio_links as PortfolioLink[];
  const recommendation = links.find((link) => link.entity_type === "recommendation" && typeof link.entity_id === "string");
  if (recommendation) return { href: "/recommendations", label: "Рекомендация" };

  const asset = links.find((link) => link.entity_type === "asset" && typeof link.entity_id === "string");
  if (asset) return { href: `/assets?asset_id=${encodeURIComponent(asset.entity_id as string)}`, label: "Актив" };

  return { href: "/news", label: "Открыть" };
}

function firstCitationUrl(analysis: LlmAnalysis) {
  const citation = (analysis.citations as Citation[]).find((item) => typeof item.url === "string");
  return typeof citation?.url === "string" ? citation.url : null;
}

function analysisItem(analysis: LlmAnalysis): DashboardTodayItem {
  const primary = analysisPrimaryLink(analysis);
  const isExplanation = analysis.analysis_type === "recommendation_explanation";
  const confidence = analysis.confidence === null ? null : Number(analysis.confidence);
  const scoreConfidence = typeof confidence === "number" && Number.isFinite(confidence) ? confidence : 0.35;

  return {
    id: `llm-analysis:${analysis.id}`,
    kind: "llm_analysis",
    title: isExplanation ? "Объяснение рекомендации" : "LLM-анализ материала",
    summary: analysis.summary ?? "Анализ создан, но краткое резюме пока недоступно.",
    badge: `${analysis.impact_level} · ${analysis.model ?? "model"}`,
    href: primary.href,
    actionLabel: primary.label,
    secondaryHref: firstCitationUrl(analysis),
    secondaryActionLabel: firstCitationUrl(analysis) ? "Источник" : null,
    tone: analysis.impact_level === "high" ? "critical" : analysis.impact_level === "medium" ? "warning" : "info",
    createdAt: analysis.created_at,
    score: 70 + scoreConfidence * 10 + timestamp(analysis.created_at) / 100000000000,
  };
}

export function buildDashboardTodayItems({ data, limit = 6 }: BuildDashboardTodayItemsInput): DashboardTodayItem[] {
  const sourceById = new Map(data.newsSources.map((source) => [source.id, source]));
  const activeLinksByDocumentId = new Map<string, Set<string>>();

  for (const link of data.sourceDocumentLinks) {
    if (link.status === "rejected") continue;
    const assetIds = activeLinksByDocumentId.get(link.source_document_id) ?? new Set<string>();
    assetIds.add(link.asset_id);
    activeLinksByDocumentId.set(link.source_document_id, assetIds);
  }

  const recommendationItems = data.recommendations
    .filter((recommendation) => recommendation.status === "open")
    .sort((left, right) => recommendationPriorityScore(right.priority) - recommendationPriorityScore(left.priority) || timestamp(right.updated_at) - timestamp(left.updated_at))
    .slice(0, 3)
    .map(recommendationItem);
  const documentItems = [...data.sourceDocuments]
    .sort((left, right) => timestamp(right.published_at ?? right.created_at) - timestamp(left.published_at ?? left.created_at))
    .slice(0, 3)
    .map((document) => sourceDocumentItem({
      document,
      linkedAssetCount: activeLinksByDocumentId.get(document.id)?.size ?? 0,
      sourceName: sourceById.get(document.source_id)?.source_name ?? document.trust_level,
    }));
  const analysisItems = data.llmAnalyses
    .filter((analysis) => analysis.status === "ready")
    .sort((left, right) => timestamp(right.created_at) - timestamp(left.created_at))
    .slice(0, 3)
    .map(analysisItem);

  return [...recommendationItems, ...documentItems, ...analysisItems]
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

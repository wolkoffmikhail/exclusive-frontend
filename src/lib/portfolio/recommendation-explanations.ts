import type { LlmAnalysis } from "./data";

type PortfolioLink = {
  entity_type?: unknown;
  entity_id?: unknown;
};

function timestamp(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function linksRecommendation(analysis: LlmAnalysis, recommendationId: string) {
  return analysis.portfolio_links.some((link) => {
    const portfolioLink = link as PortfolioLink;
    return portfolioLink.entity_type === "recommendation" && portfolioLink.entity_id === recommendationId;
  });
}

export function latestRecommendationExplanationById(analyses: LlmAnalysis[]) {
  const result = new Map<string, LlmAnalysis>();

  for (const analysis of analyses) {
    if (analysis.analysis_type !== "recommendation_explanation") continue;

    for (const link of analysis.portfolio_links) {
      const portfolioLink = link as PortfolioLink;
      if (portfolioLink.entity_type !== "recommendation" || typeof portfolioLink.entity_id !== "string") continue;

      const existing = result.get(portfolioLink.entity_id);
      if (!existing || timestamp(analysis.created_at) >= timestamp(existing.created_at)) {
        result.set(portfolioLink.entity_id, analysis);
      }
    }
  }

  return result;
}

export function latestRecommendationExplanation({
  analyses,
  recommendationId,
}: {
  analyses: LlmAnalysis[];
  recommendationId: string;
}) {
  return analyses
    .filter((analysis) => analysis.analysis_type === "recommendation_explanation")
    .filter((analysis) => linksRecommendation(analysis, recommendationId))
    .sort((left, right) => timestamp(right.created_at) - timestamp(left.created_at))[0] ?? null;
}

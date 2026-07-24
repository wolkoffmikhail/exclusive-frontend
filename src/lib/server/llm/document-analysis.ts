import { generateAdvisorResponseWithConfiguredProvider, type LlmProviderResult } from "./provider";
import { buildRecommendationExplanationPrompt, buildSourceDocumentAnalysisPrompt } from "./prompts";
import { validateAdvisorStructuredResponse, type AdvisorStructuredResponse } from "./safety";

export const sourceDocumentAnalysisPromptVersion = "stage7-local-fallback-v1";
export const sourceDocumentAnalysisModel = "local-fallback";
export const recommendationExplanationPromptVersion = "stage7-recommendation-explanation-local-v1";
export const recommendationExplanationModel = "local-fallback";

export type SourceDocumentAnalysisDocument = {
  id: string;
  title: string;
  url: string | null;
  document_type: string;
  issuer_name: string | null;
  ticker: string | null;
  isin: string | null;
  published_at: string | null;
  raw_excerpt: string | null;
};

export type SourceDocumentAnalysisAssetLink = {
  asset_id: string;
  label: string;
  ticker: string | null;
  status: string;
  confidence: number | string;
};

export type SourceDocumentAnalysisInsert = {
  analysis_type: "summary";
  model: string;
  prompt_version: string;
  status: "ready" | "failed";
  summary: string | null;
  facts: AdvisorStructuredResponse["facts"];
  portfolio_links: AdvisorStructuredResponse["portfolio_links"];
  impact_level: AdvisorStructuredResponse["impact_level"];
  confidence: number | null;
  limitations: string[];
  citations: AdvisorStructuredResponse["source_links"];
  suggested_actions: AdvisorStructuredResponse["suggested_actions"];
  what_if_prefill: AdvisorStructuredResponse["what_if_prefill"];
  safety_flags: string[];
};

export type RecommendationExplanationRecommendation = {
  id: string;
  title: string;
  body: string | null;
  reason: string | null;
  priority: string;
  recommendation_type: string;
  source: string;
  confidence: number | string | null;
  metrics: Record<string, unknown>;
  href: string | null;
  linkedAssetId: string | null;
};

export type RecommendationExplanationAsset = {
  id: string;
  name: string;
  ticker: string | null;
};

export type RecommendationExplanationSourceDocument = {
  id: string;
  title: string;
  url: string | null;
  document_type: string;
  published_at: string | null;
  raw_excerpt: string | null;
};

export type RecommendationExplanationInsert = {
  analysis_type: "recommendation_explanation";
  model: string;
  prompt_version: string;
  status: "ready" | "failed";
  summary: string | null;
  facts: AdvisorStructuredResponse["facts"];
  portfolio_links: AdvisorStructuredResponse["portfolio_links"];
  impact_level: AdvisorStructuredResponse["impact_level"];
  confidence: number | null;
  limitations: string[];
  citations: AdvisorStructuredResponse["source_links"];
  suggested_actions: AdvisorStructuredResponse["suggested_actions"];
  what_if_prefill: AdvisorStructuredResponse["what_if_prefill"];
  safety_flags: string[];
};

function numberConfidence(value: number | string) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
}

function excerptText(document: SourceDocumentAnalysisDocument) {
  const excerpt = document.raw_excerpt?.trim();
  if (excerpt) return excerpt.replace(/\s+/g, " ").slice(0, 500);
  return document.title.trim();
}

function linkedAssetsText(links: SourceDocumentAnalysisAssetLink[]) {
  const confirmed = links.filter((link) => link.status === "confirmed");
  const usable = confirmed.length > 0 ? confirmed : links.filter((link) => link.status === "suggested");
  if (usable.length === 0) return "No linked portfolio assets are confirmed yet.";
  return `Linked assets: ${usable.map((link) => link.ticker ?? link.label).join(", ")}.`;
}

function impactLevel(links: SourceDocumentAnalysisAssetLink[]): AdvisorStructuredResponse["impact_level"] {
  if (links.some((link) => link.status === "confirmed")) return "low";
  if (links.some((link) => link.status === "suggested")) return "unknown";
  return "unknown";
}

function responseConfidence(links: SourceDocumentAnalysisAssetLink[]) {
  const confirmed = links.filter((link) => link.status === "confirmed");
  if (confirmed.length > 0) {
    return Math.min(0.72, 0.45 + Math.max(...confirmed.map((link) => numberConfidence(link.confidence))) * 0.25);
  }
  if (links.length > 0) {
    return Math.min(0.45, 0.25 + Math.max(...links.map((link) => numberConfidence(link.confidence))) * 0.2);
  }
  return 0.25;
}

function recommendationMetricFacts({
  citationId,
  metrics,
}: {
  citationId: string;
  metrics: Record<string, unknown>;
}) {
  return Object.entries(metrics)
    .filter(([, value]) => value !== null && value !== undefined && typeof value !== "object")
    .slice(0, 3)
    .map(([key, value]) => ({
      text: `Recommendation metric ${key}: ${String(value)}.`,
      citation_ids: [citationId],
    }));
}

function recommendationExplanationConfidence({
  linkedDocuments,
  recommendation,
}: {
  recommendation: RecommendationExplanationRecommendation;
  linkedDocuments: RecommendationExplanationSourceDocument[];
}) {
  const baseConfidence = numberConfidence(recommendation.confidence ?? 0.45);
  const documentBoost = Math.min(0.18, linkedDocuments.length * 0.06);
  return Math.min(0.78, Math.max(0.35, baseConfidence * 0.55 + 0.25 + documentBoost));
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function sourceDocumentInsertFromProvider(result: Extract<LlmProviderResult, { ok: true }>): SourceDocumentAnalysisInsert {
  return {
    analysis_type: "summary",
    model: result.model,
    prompt_version: result.promptVersion,
    status: "ready",
    summary: result.response.answer,
    facts: result.response.facts,
    portfolio_links: result.response.portfolio_links,
    impact_level: result.response.impact_level,
    confidence: result.response.confidence,
    limitations: result.response.limitations,
    citations: result.response.source_links,
    suggested_actions: result.response.suggested_actions,
    what_if_prefill: result.response.what_if_prefill,
    safety_flags: uniqueStrings([...result.response.safety_flags, ...result.safetyFlags]),
  };
}

function recommendationInsertFromProvider(result: Extract<LlmProviderResult, { ok: true }>): RecommendationExplanationInsert {
  return {
    analysis_type: "recommendation_explanation",
    model: result.model,
    prompt_version: result.promptVersion,
    status: "ready",
    summary: result.response.answer,
    facts: result.response.facts,
    portfolio_links: result.response.portfolio_links,
    impact_level: result.response.impact_level,
    confidence: result.response.confidence,
    limitations: result.response.limitations,
    citations: result.response.source_links,
    suggested_actions: result.response.suggested_actions,
    what_if_prefill: result.response.what_if_prefill,
    safety_flags: uniqueStrings([...result.response.safety_flags, ...result.safetyFlags]),
  };
}

function appendProviderFallbackFlags<T extends { limitations: string[]; safety_flags: string[] }>(analysis: T, providerResult: LlmProviderResult): T {
  if (providerResult.ok) return analysis;
  return {
    ...analysis,
    limitations: uniqueStrings([
      ...analysis.limitations,
      `LLM provider unavailable or rejected output (${providerResult.reason}); local fallback was used.`,
    ]),
    safety_flags: uniqueStrings([...analysis.safety_flags, ...providerResult.safetyFlags, "llm_provider_fallback"]),
  };
}

export function buildFallbackRecommendationExplanation({
  asset,
  linkedDocuments = [],
  recommendation,
}: {
  recommendation: RecommendationExplanationRecommendation;
  asset?: RecommendationExplanationAsset | null;
  linkedDocuments?: RecommendationExplanationSourceDocument[];
}): RecommendationExplanationInsert {
  const recommendationCitationId = `recommendation:${recommendation.id}`;
  const sourceLinks = [
    {
      id: recommendationCitationId,
      url: recommendation.href,
      title: recommendation.title,
    },
    ...linkedDocuments.slice(0, 3).map((document) => ({
      id: `source-document:${document.id}`,
      url: document.url,
      title: document.title,
    })),
  ];
  const portfolioLinks = [
    {
      entity_type: "recommendation",
      entity_id: recommendation.id,
      label: recommendation.title,
    },
    ...(asset ? [{
      entity_type: "asset",
      entity_id: asset.id,
      label: asset.ticker ? `${asset.name} (${asset.ticker})` : asset.name,
    }] : []),
  ];
  const documentFacts = linkedDocuments.slice(0, 3).map((document) => ({
    text: `Linked source document: ${document.title}.`,
    citation_ids: [`source-document:${document.id}`],
  }));
  const answer = [
    `This explains why the recommendation "${recommendation.title}" was shown.`,
    recommendation.reason ? `Reason: ${recommendation.reason}` : null,
    recommendation.body ? `Context: ${recommendation.body}` : null,
    asset ? `Linked portfolio asset: ${asset.ticker ?? asset.name}.` : "No linked portfolio asset was confirmed for this recommendation.",
    linkedDocuments.length > 0
      ? `There are ${linkedDocuments.length} linked source document(s) that can be reviewed as supporting context.`
      : "No linked source documents were found yet, so the explanation relies on the recommendation record and portfolio metrics only.",
    "This local fallback is explanatory only and does not issue trading instructions.",
  ].filter(Boolean).join(" ");
  const response: AdvisorStructuredResponse = {
    answer,
    facts: [
      {
        text: `Recommendation title: ${recommendation.title}.`,
        citation_ids: [recommendationCitationId],
      },
      {
        text: `Recommendation type: ${recommendation.recommendation_type}; priority: ${recommendation.priority}.`,
        citation_ids: [recommendationCitationId],
      },
      ...(recommendation.reason ? [{
        text: `Recommendation reason: ${recommendation.reason}.`,
        citation_ids: [recommendationCitationId],
      }] : []),
      ...recommendationMetricFacts({ citationId: recommendationCitationId, metrics: recommendation.metrics }),
      ...documentFacts,
    ],
    assumptions: [
      "Stored portfolio state and rule-based recommendation inputs are treated as the current context.",
      ...(linkedDocuments.length === 0 ? ["No source document citation is available for this recommendation yet."] : []),
    ],
    portfolio_links: portfolioLinks,
    source_links: sourceLinks,
    impact_level: asset ? "low" : "unknown",
    confidence: recommendationExplanationConfidence({ recommendation, linkedDocuments }),
    suggested_actions: [
      {
        label: "Open recommendation",
        action_type: "open_recommendation",
        href: "/recommendations",
      },
      ...(asset ? [{
        label: "Open asset",
        action_type: "open_asset" as const,
        href: `/assets?asset_id=${asset.id}`,
      }] : []),
      ...(recommendation.linkedAssetId ? [{
        label: "Open what-if",
        action_type: "open_what_if" as const,
        href: `/what-if?asset_id=${recommendation.linkedAssetId}`,
      }] : []),
    ],
    what_if_prefill: recommendation.linkedAssetId ? { asset_id: recommendation.linkedAssetId } : null,
    limitations: [
      "Local fallback explanation only; no external LLM provider was called.",
      "It explains the recommendation logic and context, but does not replace independent investment review.",
      ...(linkedDocuments.length === 0 ? ["No linked source documents were available for citation."] : []),
    ],
    disclaimer_required: true,
    safety_flags: ["local_fallback"],
  };
  const validation = validateAdvisorStructuredResponse(response);

  if (!validation.ok) {
    return {
      analysis_type: "recommendation_explanation",
      model: recommendationExplanationModel,
      prompt_version: recommendationExplanationPromptVersion,
      status: "failed",
      summary: null,
      facts: [],
      portfolio_links: [],
      impact_level: "unknown",
      confidence: null,
      limitations: validation.errors,
      citations: [],
      suggested_actions: [],
      what_if_prefill: null,
      safety_flags: validation.safetyFlags,
    };
  }

  return {
    analysis_type: "recommendation_explanation",
    model: recommendationExplanationModel,
    prompt_version: recommendationExplanationPromptVersion,
    status: "ready",
    summary: validation.value.answer,
    facts: validation.value.facts,
    portfolio_links: validation.value.portfolio_links,
    impact_level: validation.value.impact_level,
    confidence: validation.value.confidence,
    limitations: validation.value.limitations,
    citations: validation.value.source_links,
    suggested_actions: validation.value.suggested_actions,
    what_if_prefill: validation.value.what_if_prefill,
    safety_flags: validation.value.safety_flags,
  };
}

export async function buildRecommendationExplanation({
  asset,
  linkedDocuments = [],
  recommendation,
}: {
  recommendation: RecommendationExplanationRecommendation;
  asset?: RecommendationExplanationAsset | null;
  linkedDocuments?: RecommendationExplanationSourceDocument[];
}): Promise<RecommendationExplanationInsert> {
  const prompt = buildRecommendationExplanationPrompt({ asset, linkedDocuments, recommendation });
  const providerResult = await generateAdvisorResponseWithConfiguredProvider(prompt);
  if (providerResult.ok) return recommendationInsertFromProvider(providerResult);

  return appendProviderFallbackFlags(
    buildFallbackRecommendationExplanation({ asset, linkedDocuments, recommendation }),
    providerResult,
  );
}

export function buildFallbackSourceDocumentAnalysis({
  document,
  links = [],
}: {
  document: SourceDocumentAnalysisDocument;
  links?: SourceDocumentAnalysisAssetLink[];
}): SourceDocumentAnalysisInsert {
  const citationId = `source-document:${document.id}`;
  const confirmedLinks = links.filter((link) => link.status === "confirmed");
  const portfolioLinks = confirmedLinks.map((link) => ({
    entity_type: "asset",
    entity_id: link.asset_id,
    label: link.ticker ? `${link.label} (${link.ticker})` : link.label,
  }));
  const response: AdvisorStructuredResponse = {
    answer: [
      excerptText(document),
      linkedAssetsText(links),
      "This local fallback does not make trading conclusions; it prepares a cited summary for review.",
    ].join(" "),
    facts: [
      {
        text: `Document title: ${document.title}.`,
        citation_ids: [citationId],
      },
      {
        text: `Document type: ${document.document_type}.`,
        citation_ids: [citationId],
      },
      ...(document.issuer_name ? [{
        text: `Issuer mentioned: ${document.issuer_name}.`,
        citation_ids: [citationId],
      }] : []),
      ...(document.ticker ? [{
        text: `Ticker mentioned: ${document.ticker}.`,
        citation_ids: [citationId],
      }] : []),
    ],
    assumptions: links.some((link) => link.status === "suggested")
      ? ["Some asset links are still suggested and should be confirmed before relying on the analysis."]
      : [],
    portfolio_links: portfolioLinks,
    source_links: [
      {
        id: citationId,
        url: document.url,
        title: document.title,
      },
    ],
    impact_level: impactLevel(links),
    confidence: responseConfidence(links),
    suggested_actions: [
      ...(document.url ? [{
        label: "Open source",
        action_type: "open_source" as const,
        href: document.url,
      }] : []),
      ...portfolioLinks.slice(0, 2).map((link) => ({
        label: `Open ${link.label}`,
        action_type: "open_asset" as const,
        href: `/assets?asset_id=${link.entity_id}`,
      })),
    ],
    what_if_prefill: portfolioLinks[0] ? { asset_id: portfolioLinks[0].entity_id } : null,
    limitations: [
      "Local fallback summary only; no external LLM provider was called.",
      ...(confirmedLinks.length === 0 ? ["No confirmed asset link is available yet."] : []),
      "Potential portfolio impact remains conservative until a real LLM/provider analysis is enabled.",
    ],
    disclaimer_required: true,
    safety_flags: ["local_fallback"],
  };
  const validation = validateAdvisorStructuredResponse(response);

  if (!validation.ok) {
    return {
      analysis_type: "summary",
      model: sourceDocumentAnalysisModel,
      prompt_version: sourceDocumentAnalysisPromptVersion,
      status: "failed",
      summary: null,
      facts: [],
      portfolio_links: [],
      impact_level: "unknown",
      confidence: null,
      limitations: validation.errors,
      citations: [],
      suggested_actions: [],
      what_if_prefill: null,
      safety_flags: validation.safetyFlags,
    };
  }

  return {
    analysis_type: "summary",
    model: sourceDocumentAnalysisModel,
    prompt_version: sourceDocumentAnalysisPromptVersion,
    status: "ready",
    summary: validation.value.answer,
    facts: validation.value.facts,
    portfolio_links: validation.value.portfolio_links,
    impact_level: validation.value.impact_level,
    confidence: validation.value.confidence,
    limitations: validation.value.limitations,
    citations: validation.value.source_links,
    suggested_actions: validation.value.suggested_actions,
    what_if_prefill: validation.value.what_if_prefill,
    safety_flags: validation.value.safety_flags,
  };
}

export async function buildSourceDocumentAnalysis({
  document,
  links = [],
}: {
  document: SourceDocumentAnalysisDocument;
  links?: SourceDocumentAnalysisAssetLink[];
}): Promise<SourceDocumentAnalysisInsert> {
  const prompt = buildSourceDocumentAnalysisPrompt({ document, links });
  const providerResult = await generateAdvisorResponseWithConfiguredProvider(prompt);
  if (providerResult.ok) return sourceDocumentInsertFromProvider(providerResult);

  return appendProviderFallbackFlags(
    buildFallbackSourceDocumentAnalysis({ document, links }),
    providerResult,
  );
}

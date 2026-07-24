import type { PortfolioData } from "../../portfolio/data";
import { generateAdvisorResponseWithConfiguredProvider, type LlmProviderResult } from "./provider";
import { buildAdvisorPortfolioQuestionPrompt, llmPromptVersions } from "./prompts";
import { validateAdvisorStructuredResponse, type AdvisorStructuredResponse } from "./safety";

export const advisorPortfolioQuestionFallbackModel = "local-fallback";
export const advisorMessageContextLimit = 8;

export type AdvisorAnswerMessage = {
  content: string;
  citations: AdvisorStructuredResponse["source_links"];
  linked_entities: AdvisorStructuredResponse["portfolio_links"];
  model: string;
  prompt_version: string;
  safety_flags: string[];
};

type AdvisorMessageContext = Pick<PortfolioData["advisorMessages"][number], "role" | "content" | "created_at">;

function numberValue(value: number | string | null | undefined) {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function percent(value: number | string | null | undefined) {
  return Math.round(numberValue(value) * 10000) / 100;
}

function recentMessages(messages: AdvisorMessageContext[]) {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(-advisorMessageContextLimit)
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, 1200),
    }));
}

function topPositions(data: PortfolioData) {
  return data.positions
    .slice()
    .sort((a, b) => numberValue(b.market_value ?? b.book_value) - numberValue(a.market_value ?? a.book_value))
    .slice(0, 8)
    .map((position) => ({
      id: position.id,
      asset_id: position.asset_id,
      asset: position.asset_name,
      ticker: position.ticker,
      account: position.account_name,
      value: position.market_value ?? position.book_value,
      currency: position.currency_code,
      pnl: position.unrealized_pnl,
    }));
}

function openRecommendations(data: PortfolioData) {
  return data.recommendations
    .filter((recommendation) => recommendation.status === "open")
    .slice(0, 8)
    .map((recommendation) => ({
      id: recommendation.id,
      title: recommendation.title,
      priority: recommendation.priority,
      reason: recommendation.reason,
      confidence: recommendation.confidence,
      linkedAssetId: recommendation.linkedAssetId,
    }));
}

function latestAnalyses(data: PortfolioData) {
  return data.llmAnalyses
    .filter((analysis) => analysis.status === "ready" && analysis.summary)
    .slice(0, 5)
    .map((analysis) => ({
      id: analysis.id,
      source_document_id: analysis.source_document_id,
      analysis_type: analysis.analysis_type,
      summary: analysis.summary,
      impact_level: analysis.impact_level,
      confidence: analysis.confidence,
      citations: analysis.citations,
      limitations: analysis.limitations,
    }));
}

function selectedSourceDocument(data: PortfolioData, sourceDocumentId?: string | null) {
  if (!sourceDocumentId) return null;
  const document = data.sourceDocuments.find((item) => item.id === sourceDocumentId);
  if (!document) return null;
  const analysis = data.llmAnalyses.find((item) => item.source_document_id === document.id && item.status === "ready");
  return {
    id: document.id,
    title: document.title,
    url: document.url,
    document_type: document.document_type,
    published_at: document.published_at,
    raw_excerpt: document.raw_excerpt,
    analysis_summary: analysis?.summary ?? null,
    analysis_limitations: analysis?.limitations ?? [],
  };
}

function portfolioSnapshot(data: PortfolioData) {
  return {
    asOf: data.analytics.asOf,
    baseCurrency: data.analytics.baseCurrency,
    totalValue: data.analytics.totalValue,
    cashValue: data.analytics.cashValue,
    investedValue: data.analytics.investedValue,
    unrealizedPnl: data.analytics.unrealizedPnl,
    xirr: data.analytics.xirr,
    alerts: data.analytics.alerts.slice(0, 8).map((alert) => alert.message),
    topPositions: topPositions(data),
    openRecommendations: openRecommendations(data),
    latestAnalyses: latestAnalyses(data),
  };
}

function fallbackResponse({
  data,
  question,
  sourceDocumentId,
}: {
  data: PortfolioData;
  question: string;
  sourceDocumentId?: string | null;
}): AdvisorStructuredResponse {
  const selectedDocument = selectedSourceDocument(data, sourceDocumentId);
  const topPosition = topPositions(data)[0];
  const firstRecommendation = openRecommendations(data)[0];
  const sourceLinks = [
    { id: "portfolio:snapshot", url: null, title: "Portfolio snapshot" },
    ...(firstRecommendation ? [{ id: `recommendation:${firstRecommendation.id}`, url: "/recommendations", title: firstRecommendation.title }] : []),
    ...(selectedDocument ? [{ id: `source-document:${selectedDocument.id}`, url: selectedDocument.url, title: selectedDocument.title }] : []),
  ];
  const portfolioLinks = [
    ...(topPosition?.asset_id ? [{ entity_type: "asset", entity_id: topPosition.asset_id, label: topPosition.ticker ? `${topPosition.asset} (${topPosition.ticker})` : topPosition.asset }] : []),
    ...(firstRecommendation ? [{ entity_type: "recommendation", entity_id: firstRecommendation.id, label: firstRecommendation.title }] : []),
    ...(selectedDocument ? [{ entity_type: "source_document", entity_id: selectedDocument.id, label: selectedDocument.title }] : []),
  ];

  return {
    answer: [
      `Вопрос: ${question.slice(0, 400)}`,
      `По текущему снимку портфеля стоимость составляет ${Math.round(data.analytics.totalValue * 100) / 100} ${data.analytics.baseCurrency}, кэш ${Math.round(data.analytics.cashValue * 100) / 100} ${data.analytics.baseCurrency}, нереализованный P&L ${Math.round(data.analytics.unrealizedPnl * 100) / 100} ${data.analytics.baseCurrency}.`,
      topPosition ? `Крупнейшая позиция в текущем контексте: ${topPosition.asset}, стоимость ${topPosition.value} ${topPosition.currency}.` : "Открытых позиций в текущем контексте нет.",
      firstRecommendation ? `Есть открытая рекомендация для проверки: ${firstRecommendation.title}; confidence ${percent(firstRecommendation.confidence)}%.` : "Открытых рекомендаций сейчас нет.",
      selectedDocument ? `Выбранный материал для разбора: ${selectedDocument.title}. ${selectedDocument.analysis_summary ?? "Сохраненного LLM-анализа по нему пока нет."}` : "Материал для разбора не выбран.",
      "Ответ носит справочный характер внутри учета портфеля и не является персональной инвестиционной рекомендацией.",
    ].join(" "),
    facts: [
      { text: `Portfolio total value: ${data.analytics.totalValue} ${data.analytics.baseCurrency}.`, citation_ids: ["portfolio:snapshot"] },
      { text: `Portfolio cash value: ${data.analytics.cashValue} ${data.analytics.baseCurrency}.`, citation_ids: ["portfolio:snapshot"] },
      ...(firstRecommendation ? [{ text: `Open recommendation: ${firstRecommendation.title}.`, citation_ids: [`recommendation:${firstRecommendation.id}`] }] : []),
      ...(selectedDocument ? [{ text: `Selected source document: ${selectedDocument.title}.`, citation_ids: [`source-document:${selectedDocument.id}`] }] : []),
    ],
    assumptions: ["Only the stored app snapshot and selected source documents are used."],
    portfolio_links: portfolioLinks,
    source_links: sourceLinks,
    impact_level: firstRecommendation ? "low" : "unknown",
    confidence: selectedDocument || firstRecommendation ? 0.52 : 0.38,
    suggested_actions: [
      ...(firstRecommendation ? [{ label: "Open recommendations", action_type: "open_recommendation" as const, href: "/recommendations" }] : []),
      ...(topPosition?.asset_id ? [{ label: "Open asset", action_type: "open_asset" as const, href: `/assets?asset_id=${topPosition.asset_id}` }] : []),
      ...(selectedDocument?.url ? [{ label: "Open source", action_type: "open_source" as const, href: selectedDocument.url }] : []),
    ],
    what_if_prefill: topPosition?.asset_id ? { asset_id: topPosition.asset_id } : null,
    limitations: [
      "Local fallback answer only; external LLM provider was not used or did not return valid structured output.",
      "The response is based on the current stored portfolio snapshot and may miss events outside the app.",
    ],
    disclaimer_required: true,
    safety_flags: ["local_fallback"],
  };
}

function messageFromProvider(result: Extract<LlmProviderResult, { ok: true }>): AdvisorAnswerMessage {
  return {
    content: result.response.answer,
    citations: result.response.source_links,
    linked_entities: result.response.portfolio_links,
    model: result.model,
    prompt_version: result.promptVersion,
    safety_flags: Array.from(new Set([...result.response.safety_flags, ...result.safetyFlags])),
  };
}

export async function buildAdvisorPortfolioAnswer({
  data,
  messages = [],
  question,
  sourceDocumentId,
}: {
  data: PortfolioData;
  messages?: AdvisorMessageContext[];
  question: string;
  sourceDocumentId?: string | null;
}): Promise<AdvisorAnswerMessage> {
  const prompt = buildAdvisorPortfolioQuestionPrompt({
    question,
    portfolioSnapshot: portfolioSnapshot(data),
    recentMessages: recentMessages(messages),
    sourceDocument: selectedSourceDocument(data, sourceDocumentId),
  });
  const providerResult = await generateAdvisorResponseWithConfiguredProvider(prompt);
  if (providerResult.ok) return messageFromProvider(providerResult);

  const validation = validateAdvisorStructuredResponse(fallbackResponse({ data, question, sourceDocumentId }));
  if (!validation.ok) {
    return {
      content: "Не удалось подготовить безопасный структурированный ответ. Попробуйте сузить вопрос или выбрать конкретный документ.",
      citations: [],
      linked_entities: [],
      model: advisorPortfolioQuestionFallbackModel,
      prompt_version: llmPromptVersions.advisorPortfolioQuestion,
      safety_flags: Array.from(new Set([...providerResult.safetyFlags, ...validation.safetyFlags, "advisor_fallback_failed"])),
    };
  }

  return {
    content: validation.value.answer,
    citations: validation.value.source_links,
    linked_entities: validation.value.portfolio_links,
    model: advisorPortfolioQuestionFallbackModel,
    prompt_version: llmPromptVersions.advisorPortfolioQuestion,
    safety_flags: Array.from(new Set([...validation.value.safety_flags, ...providerResult.safetyFlags, "llm_provider_fallback"])),
  };
}

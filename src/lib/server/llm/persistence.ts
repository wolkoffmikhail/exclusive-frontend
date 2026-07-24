import type { RecommendationExplanationInsert, SourceDocumentAnalysisInsert } from "./document-analysis";
import type { AdvisorAnswerMessage } from "./portfolio-advisor";

export type PersistableLlmAnalysis = SourceDocumentAnalysisInsert | RecommendationExplanationInsert;

export function buildLlmAnalysisInsert({
  analysis,
  familyId,
  sourceDocumentId,
  userId,
}: {
  analysis: PersistableLlmAnalysis;
  familyId: string;
  sourceDocumentId: string | null;
  userId: string;
}) {
  return {
    family_id: familyId,
    source_document_id: sourceDocumentId,
    analysis_type: analysis.analysis_type,
    model: analysis.model,
    prompt_version: analysis.prompt_version,
    status: analysis.status,
    summary: analysis.summary,
    facts: analysis.facts,
    portfolio_links: analysis.portfolio_links,
    impact_level: analysis.impact_level,
    confidence: analysis.confidence,
    limitations: analysis.limitations,
    citations: analysis.citations,
    suggested_actions: analysis.suggested_actions,
    what_if_prefill: analysis.what_if_prefill,
    safety_flags: analysis.safety_flags,
    created_by: userId,
  };
}

export function buildAdvisorThreadTitle(question: string) {
  const trimmed = question.trim();
  return trimmed.length > 90 ? `${trimmed.slice(0, 87)}...` : trimmed;
}

export function buildAdvisorThreadInsert({
  familyId,
  question,
  sourceDocumentId,
  userId,
}: {
  familyId: string;
  question: string;
  sourceDocumentId?: string | null;
  userId: string;
}) {
  return {
    family_id: familyId,
    created_by: userId,
    title: buildAdvisorThreadTitle(question),
    context_scope: sourceDocumentId ? { source_document_id: sourceDocumentId } : {},
  };
}

export function buildAdvisorUserMessageInsert({
  familyId,
  question,
  sourceDocumentId,
  threadId,
}: {
  familyId: string;
  question: string;
  sourceDocumentId?: string | null;
  threadId: string;
}) {
  return {
    family_id: familyId,
    thread_id: threadId,
    role: "user",
    content: question,
    citations: [],
    linked_entities: sourceDocumentId ? [{ entity_type: "source_document", entity_id: sourceDocumentId, label: "Selected source document" }] : [],
    model: null,
    prompt_version: null,
    safety_flags: [],
  };
}

export function buildAdvisorAssistantMessageInsert({
  answer,
  familyId,
  threadId,
}: {
  answer: AdvisorAnswerMessage;
  familyId: string;
  threadId: string;
}) {
  return {
    family_id: familyId,
    thread_id: threadId,
    role: "assistant",
    content: answer.content,
    citations: answer.citations,
    linked_entities: answer.linked_entities,
    model: answer.model,
    prompt_version: answer.prompt_version,
    safety_flags: answer.safety_flags,
  };
}

export function buildAdvisorQuestionAuditPayload({
  answer,
  question,
  sourceDocumentId,
}: {
  answer: AdvisorAnswerMessage;
  question: string;
  sourceDocumentId?: string | null;
}) {
  return {
    question_length: question.length,
    source_document_id: sourceDocumentId ?? null,
    model: answer.model,
    prompt_version: answer.prompt_version,
    safety_flags: answer.safety_flags,
    citations_count: answer.citations.length,
    linked_entities_count: answer.linked_entities.length,
  };
}

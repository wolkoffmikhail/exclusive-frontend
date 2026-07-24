import { describe, expect, it } from "vitest";
import { buildAdvisorAssistantMessageInsert, buildAdvisorQuestionAuditPayload, buildAdvisorThreadInsert, buildAdvisorThreadTitle, buildAdvisorUserMessageInsert, buildLlmAnalysisInsert } from "./persistence";

const familyId = "family-1";
const userId = "user-1";

describe("LLM persistence helpers", () => {
  it("builds llm_analyses inserts with structured output fields", () => {
    const payload = buildLlmAnalysisInsert({
      familyId,
      sourceDocumentId: "document-1",
      userId,
      analysis: {
        analysis_type: "summary",
        model: "configured-model",
        prompt_version: "stage7-source-document-analysis-v1",
        status: "ready",
        summary: "Structured summary",
        facts: [{ text: "Fact", citation_ids: ["source-document:document-1"] }],
        portfolio_links: [{ entity_type: "asset", entity_id: "asset-1", label: "Asset" }],
        impact_level: "low",
        confidence: 0.6,
        limitations: ["Limited context"],
        citations: [{ id: "source-document:document-1", url: null, title: "Document" }],
        suggested_actions: [],
        what_if_prefill: { asset_id: "asset-1" },
        safety_flags: ["local_fallback"],
      },
    });

    expect(payload).toMatchObject({
      family_id: familyId,
      source_document_id: "document-1",
      analysis_type: "summary",
      prompt_version: "stage7-source-document-analysis-v1",
      created_by: userId,
    });
    expect(payload.citations).toHaveLength(1);
    expect(payload.what_if_prefill).toEqual({ asset_id: "asset-1" });
  });

  it("builds advisor thread and message inserts for a saved exchange", () => {
    const question = "Как разобрать новость по эмитенту?";
    const answer = {
      content: "Справочный ответ без персональной инвестиционной рекомендации.",
      citations: [{ id: "source-document:document-1", url: "https://example.test/doc", title: "Document" }],
      linked_entities: [{ entity_type: "source_document", entity_id: "document-1", label: "Document" }],
      model: "local-fallback",
      prompt_version: "stage7-advisor-portfolio-question-v1",
      safety_flags: ["local_fallback"],
    };

    expect(buildAdvisorThreadInsert({ familyId, question, sourceDocumentId: "document-1", userId })).toMatchObject({
      family_id: familyId,
      created_by: userId,
      title: question,
      context_scope: { source_document_id: "document-1" },
    });
    expect(buildAdvisorUserMessageInsert({ familyId, question, sourceDocumentId: "document-1", threadId: "thread-1" })).toMatchObject({
      role: "user",
      content: question,
      linked_entities: [{ entity_type: "source_document", entity_id: "document-1", label: "Selected source document" }],
    });
    expect(buildAdvisorAssistantMessageInsert({ answer, familyId, threadId: "thread-1" })).toMatchObject({
      role: "assistant",
      content: answer.content,
      citations: answer.citations,
      linked_entities: answer.linked_entities,
      model: "local-fallback",
    });
  });

  it("keeps advisor audit payload free of raw prompts and message text", () => {
    const question = "Bearer secret-token что проверить?";
    const answer = {
      content: "Ответ с секретом не должен попасть в audit.",
      citations: [{ id: "portfolio:snapshot", url: null, title: "Portfolio snapshot" }],
      linked_entities: [{ entity_type: "asset", entity_id: "asset-1", label: "Asset" }],
      model: "local-fallback",
      prompt_version: "stage7-advisor-portfolio-question-v1",
      safety_flags: ["llm_provider_fallback"],
    };
    const payload = buildAdvisorQuestionAuditPayload({ answer, question, sourceDocumentId: null });

    expect(payload).toEqual({
      question_length: question.length,
      source_document_id: null,
      model: "local-fallback",
      prompt_version: "stage7-advisor-portfolio-question-v1",
      safety_flags: ["llm_provider_fallback"],
      citations_count: 1,
      linked_entities_count: 1,
    });
    expect(JSON.stringify(payload)).not.toContain("secret-token");
    expect(JSON.stringify(payload)).not.toContain("Ответ");
    expect(JSON.stringify(payload)).not.toContain("prompt context");
  });

  it("limits thread titles to the database constraint", () => {
    expect(buildAdvisorThreadTitle("x".repeat(220))).toHaveLength(90);
    expect(buildAdvisorThreadTitle("x".repeat(220)).endsWith("...")).toBe(true);
  });
});

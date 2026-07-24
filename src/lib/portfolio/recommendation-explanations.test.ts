import { describe, expect, it } from "vitest";
import type { LlmAnalysis } from "./data";
import { latestRecommendationExplanation, latestRecommendationExplanationById } from "./recommendation-explanations";

function analysis(overrides: Partial<LlmAnalysis>): LlmAnalysis {
  return {
    id: "analysis-1",
    family_id: "family-1",
    source_document_id: null,
    analysis_type: "recommendation_explanation",
    model: "local-fallback",
    prompt_version: "stage7-test",
    status: "ready",
    summary: "Summary",
    facts: [],
    portfolio_links: [
      { entity_type: "recommendation", entity_id: "recommendation-1", label: "Recommendation" },
    ],
    impact_level: "low",
    confidence: 0.6,
    limitations: [],
    citations: [],
    suggested_actions: [],
    what_if_prefill: null,
    safety_flags: [],
    created_at: "2026-07-23T10:00:00.000Z",
    updated_at: "2026-07-23T10:00:00.000Z",
    ...overrides,
  };
}

describe("latestRecommendationExplanation", () => {
  it("finds the newest explanation linked through portfolio_links", () => {
    const analyses = [
      analysis({ id: "old", created_at: "2026-07-23T10:00:00.000Z" }),
      analysis({ id: "new", created_at: "2026-07-23T11:00:00.000Z" }),
      analysis({
        id: "source-doc",
        analysis_type: "summary",
        created_at: "2026-07-23T12:00:00.000Z",
      }),
    ];

    expect(latestRecommendationExplanation({ analyses, recommendationId: "recommendation-1" })?.id).toBe("new");
    expect(latestRecommendationExplanationById(analyses).get("recommendation-1")?.id).toBe("new");
  });

  it("ignores explanations for other recommendations", () => {
    const analyses = [
      analysis({
        id: "other",
        portfolio_links: [
          { entity_type: "recommendation", entity_id: "recommendation-2", label: "Other" },
        ],
      }),
    ];

    expect(latestRecommendationExplanation({ analyses, recommendationId: "recommendation-1" })).toBeNull();
  });
});

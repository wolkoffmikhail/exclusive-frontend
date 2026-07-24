import { describe, expect, it } from "vitest";
import { buildRecommendationExplanationPrompt, buildSourceDocumentAnalysisPrompt, llmPromptVersions } from "./prompts";

describe("stage 7 LLM prompts", () => {
  it("versions source document analysis prompts and redacts context values", () => {
    const prompt = buildSourceDocumentAnalysisPrompt({
      document: {
        id: "doc-1",
        title: "Issuer disclosure",
        url: "https://example.test/source",
        document_type: "issuer_disclosure",
        issuer_name: "Demo issuer",
        ticker: "DEMO",
        isin: null,
        published_at: "2026-07-24T10:00:00.000Z",
        raw_excerpt: "Authorization Bearer very-secret-token",
      },
      links: [],
    });

    expect(prompt.promptVersion).toBe(llmPromptVersions.sourceDocumentAnalysis);
    expect(JSON.stringify(prompt.messages)).not.toContain("very-secret-token");
    expect(prompt.messages[1].content).toContain("\"raw_excerpt\": \"[REDACTED]\"");
  });

  it("versions recommendation explanation prompts and redacts secret-like metrics", () => {
    const prompt = buildRecommendationExplanationPrompt({
      recommendation: {
        id: "recommendation-1",
        title: "Review concentration",
        body: null,
        reason: "Asset share is above threshold.",
        priority: "high",
        recommendation_type: "single_asset_concentration",
        source: "rule_based",
        confidence: 0.8,
        metrics: { telegram_token: "secret-metric-token", share_percent: 42 },
        href: "/recommendations",
        linkedAssetId: "asset-1",
      },
      asset: { id: "asset-1", name: "Demo asset", ticker: "DEMO" },
      linkedDocuments: [],
    });

    expect(prompt.promptVersion).toBe(llmPromptVersions.recommendationExplanation);
    expect(JSON.stringify(prompt.messages)).not.toContain("secret-metric-token");
    expect(JSON.stringify(prompt.messages)).toContain("[REDACTED]");
  });
});

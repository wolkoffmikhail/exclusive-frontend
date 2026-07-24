import { describe, expect, it } from "vitest";
import { buildFallbackRecommendationExplanation, buildFallbackSourceDocumentAnalysis } from "./document-analysis";

const document = {
  id: "doc-1",
  title: "SBER published dividend update",
  url: "https://example.test/source",
  document_type: "dividend",
  issuer_name: "Sberbank",
  ticker: "SBER",
  isin: "RU0009029540",
  published_at: "2026-07-23T10:00:00.000Z",
  raw_excerpt: "Board recommended a dividend. Details require source review.",
};

describe("buildFallbackSourceDocumentAnalysis", () => {
  it("builds a cited ready analysis for confirmed links", () => {
    const analysis = buildFallbackSourceDocumentAnalysis({
      document,
      links: [
        {
          asset_id: "asset-1",
          label: "Sberbank",
          ticker: "SBER",
          status: "confirmed",
          confidence: 0.98,
        },
      ],
    });

    expect(analysis).toMatchObject({
      status: "ready",
      model: "local-fallback",
      prompt_version: "stage7-local-fallback-v1",
      impact_level: "low",
    });
    expect(analysis.citations[0]).toMatchObject({ id: "source-document:doc-1" });
    expect(analysis.facts.every((fact) => fact.citation_ids.includes("source-document:doc-1"))).toBe(true);
    expect(analysis.portfolio_links[0]).toMatchObject({ entity_type: "asset", entity_id: "asset-1" });
    expect(analysis.what_if_prefill).toEqual({ asset_id: "asset-1" });
  });

  it("keeps impact unknown when there are only suggested links", () => {
    const analysis = buildFallbackSourceDocumentAnalysis({
      document,
      links: [
        {
          asset_id: "asset-1",
          label: "Sberbank",
          ticker: "SBER",
          status: "suggested",
          confidence: 0.74,
        },
      ],
    });

    expect(analysis.status).toBe("ready");
    expect(analysis.impact_level).toBe("unknown");
    expect(analysis.portfolio_links).toEqual([]);
    expect(analysis.limitations).toContain("No confirmed asset link is available yet.");
  });
});

describe("buildFallbackRecommendationExplanation", () => {
  it("builds a cited explanation for a linked recommendation", () => {
    const explanation = buildFallbackRecommendationExplanation({
      recommendation: {
        id: "recommendation-1",
        title: "Review single asset concentration",
        body: "SBER is above the target share.",
        reason: "The asset share is above the configured threshold.",
        priority: "high",
        recommendation_type: "single_asset_concentration",
        source: "rule_based",
        confidence: 0.7,
        metrics: { share_percent: 42.5 },
        href: "/assets?asset_id=asset-1",
        linkedAssetId: "asset-1",
      },
      asset: {
        id: "asset-1",
        name: "Sberbank",
        ticker: "SBER",
      },
      linkedDocuments: [
        {
          id: "doc-1",
          title: "SBER disclosure",
          url: "https://example.test/disclosure",
          document_type: "issuer_disclosure",
          published_at: "2026-07-23T10:00:00.000Z",
          raw_excerpt: "Issuer disclosure text.",
        },
      ],
    });

    expect(explanation).toMatchObject({
      analysis_type: "recommendation_explanation",
      status: "ready",
      model: "local-fallback",
      prompt_version: "stage7-recommendation-explanation-local-v1",
      impact_level: "low",
    });
    expect(explanation.citations.map((citation) => citation.id)).toContain("recommendation:recommendation-1");
    expect(explanation.citations.map((citation) => citation.id)).toContain("source-document:doc-1");
    expect(explanation.what_if_prefill).toEqual({ asset_id: "asset-1" });
    expect(explanation.portfolio_links).toEqual(expect.arrayContaining([
      expect.objectContaining({ entity_type: "recommendation", entity_id: "recommendation-1" }),
      expect.objectContaining({ entity_type: "asset", entity_id: "asset-1" }),
    ]));
  });
});

import { describe, expect, it } from "vitest";
import { buildFallbackSourceDocumentAnalysis } from "./document-analysis";
import { stage7EvalFixtures } from "./eval-fixtures";
import { containsForbiddenTradingCommand } from "./safety";

const expectedFixtureIds = [
  "regulator-news-without-issuer",
  "issuer-specific-disclosure",
  "dividend-announcement",
  "similar-company-names",
  "unrelated-to-portfolio",
  "negative-news-with-uncertainty",
  "english-language-filing",
];

function portfolioAssetIds(analysis: ReturnType<typeof buildFallbackSourceDocumentAnalysis>) {
  return analysis.portfolio_links
    .filter((link) => link.entity_type === "asset")
    .map((link) => link.entity_id);
}

describe("stage7EvalFixtures", () => {
  it("covers the accepted stage 7 eval matrix", () => {
    expect(stage7EvalFixtures.map((fixture) => fixture.id)).toEqual(expectedFixtureIds);
  });

  it.each(stage7EvalFixtures)("keeps $id cited, cautious and non-directive", (fixture) => {
    const analysis = buildFallbackSourceDocumentAnalysis({
      document: fixture.document,
      links: fixture.links,
    });

    expect(analysis.status).toBe("ready");
    expect(analysis.impact_level).toBe(fixture.expected.impactLevel);
    expect(analysis.citations.map((citation) => citation.id)).toContain(fixture.expected.sourceCitationId);
    expect(analysis.facts.length).toBeGreaterThan(0);
    expect(analysis.facts.every((fact) => fact.citation_ids.includes(fixture.expected.sourceCitationId))).toBe(true);
    expect(containsForbiddenTradingCommand(analysis.summary ?? "")).toBe(false);

    const linkedAssetIds = portfolioAssetIds(analysis);
    expect(linkedAssetIds).toEqual(expect.arrayContaining(fixture.expected.linkedAssetIds));

    for (const assetId of fixture.expected.excludedAssetIds ?? []) {
      expect(linkedAssetIds).not.toContain(assetId);
    }

    if (fixture.expected.linkedAssetIds.length === 0) {
      expect(linkedAssetIds).toEqual([]);
      expect(analysis.what_if_prefill).toBeNull();
      expect(analysis.limitations).toContain("No confirmed asset link is available yet.");
    }

    if (typeof fixture.expected.minConfidence === "number") {
      expect(analysis.confidence).not.toBeNull();
      expect(analysis.confidence as number).toBeGreaterThanOrEqual(fixture.expected.minConfidence);
    }

    if (typeof fixture.expected.maxConfidence === "number") {
      expect(analysis.confidence).not.toBeNull();
      expect(analysis.confidence as number).toBeLessThanOrEqual(fixture.expected.maxConfidence);
    }
  });
});

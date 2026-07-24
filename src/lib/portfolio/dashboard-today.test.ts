import { describe, expect, it } from "vitest";
import type { LlmAnalysis, NewsSource, PortfolioData, Recommendation, SourceDocument, SourceDocumentLink } from "./data";
import { buildDashboardTodayItems } from "./dashboard-today";

const familyId = "family-1";

function recommendation(overrides: Partial<Recommendation>): Recommendation {
  return {
    id: "recommendation-1",
    family_id: familyId,
    portfolio_id: null,
    title: "Review concentration",
    body: null,
    status: "open",
    priority: "high",
    due_on: null,
    recommendation_type: "single_asset_concentration",
    reason: "Asset share is above threshold.",
    source: "rule_based",
    confidence: 0.7,
    metrics: {},
    fingerprint: "single_asset_concentration:asset-1",
    last_generated_at: "2026-07-23T09:00:00.000Z",
    accepted_at: null,
    rejected_at: null,
    archived_at: null,
    created_at: "2026-07-23T09:00:00.000Z",
    updated_at: "2026-07-23T09:00:00.000Z",
    href: "/assets?asset_id=asset-1",
    linkedAssetId: "asset-1",
    ...overrides,
  };
}

function sourceDocument(overrides: Partial<SourceDocument>): SourceDocument {
  return {
    id: "doc-1",
    family_id: familyId,
    source_id: "source-1",
    external_id: null,
    url: "https://example.test/doc",
    title: "Issuer disclosure",
    published_at: "2026-07-23T10:00:00.000Z",
    issuer_name: null,
    ticker: "SBER",
    isin: null,
    language: "ru",
    document_type: "issuer_disclosure",
    trust_level: "manual",
    raw_excerpt: "Disclosure excerpt.",
    content_hash: null,
    payload: {},
    created_at: "2026-07-23T10:01:00.000Z",
    updated_at: "2026-07-23T10:01:00.000Z",
    ...overrides,
  };
}

function analysis(overrides: Partial<LlmAnalysis>): LlmAnalysis {
  return {
    id: "analysis-1",
    family_id: familyId,
    source_document_id: null,
    analysis_type: "recommendation_explanation",
    model: "local-fallback",
    prompt_version: "stage7-test",
    status: "ready",
    summary: "Explanation summary.",
    facts: [],
    portfolio_links: [
      { entity_type: "recommendation", entity_id: "recommendation-1", label: "Review concentration" },
      { entity_type: "asset", entity_id: "asset-1", label: "Sberbank" },
    ],
    impact_level: "low",
    confidence: 0.72,
    limitations: [],
    citations: [{ id: "source-document:doc-1", url: "https://example.test/doc", title: "Issuer disclosure" }],
    suggested_actions: [],
    what_if_prefill: null,
    safety_flags: [],
    created_at: "2026-07-23T11:00:00.000Z",
    updated_at: "2026-07-23T11:00:00.000Z",
    ...overrides,
  };
}

function source(overrides: Partial<NewsSource> = {}): NewsSource {
  return {
    id: "source-1",
    family_id: familyId,
    source_code: "manual",
    source_name: "Manual",
    source_type: "manual",
    base_url: null,
    status: "active",
    requires_token: false,
    terms_status: "approved",
    terms_checked_at: null,
    last_success_at: null,
    last_error: null,
    created_at: "2026-07-23T08:00:00.000Z",
    updated_at: "2026-07-23T08:00:00.000Z",
    ...overrides,
  };
}

function documentLink(overrides: Partial<SourceDocumentLink>): SourceDocumentLink {
  return {
    id: "link-1",
    family_id: familyId,
    source_document_id: "doc-1",
    asset_id: "asset-1",
    link_type: "ticker",
    confidence: 0.9,
    status: "confirmed",
    evidence: {},
    created_at: "2026-07-23T10:02:00.000Z",
    updated_at: "2026-07-23T10:02:00.000Z",
    ...overrides,
  };
}

function data(overrides: Partial<Pick<PortfolioData, "assets" | "llmAnalyses" | "newsSources" | "recommendations" | "sourceDocumentLinks" | "sourceDocuments">>) {
  return {
    assets: [{ id: "asset-1", name: "Sberbank", ticker: "SBER" }],
    llmAnalyses: [],
    newsSources: [],
    recommendations: [],
    sourceDocumentLinks: [],
    sourceDocuments: [],
    ...overrides,
  } as Pick<PortfolioData, "assets" | "llmAnalyses" | "newsSources" | "recommendations" | "sourceDocumentLinks" | "sourceDocuments">;
}

describe("buildDashboardTodayItems", () => {
  it("prioritizes critical open recommendations and exposes what-if", () => {
    const items = buildDashboardTodayItems({
      data: data({
        recommendations: [
          recommendation({ id: "normal", title: "Normal", priority: "normal" }),
          recommendation({ id: "critical", title: "Critical", priority: "critical" }),
        ],
      }),
      limit: 2,
    });

    expect(items[0]).toMatchObject({
      id: "recommendation:critical",
      tone: "critical",
      secondaryActionLabel: "What-if",
    });
  });

  it("includes linked source documents and ready LLM analyses", () => {
    const items = buildDashboardTodayItems({
      data: data({
        llmAnalyses: [analysis({})],
        newsSources: [source()],
        sourceDocumentLinks: [documentLink({})],
        sourceDocuments: [sourceDocument({})],
      }),
      limit: 6,
    });

    expect(items.map((item) => item.kind)).toEqual(expect.arrayContaining(["source_document", "llm_analysis"]));
    expect(items.find((item) => item.kind === "source_document")).toMatchObject({
      badge: "Manual · 1 связ.",
      secondaryHref: "https://example.test/doc",
    });
    expect(items.find((item) => item.kind === "llm_analysis")).toMatchObject({
      href: "/recommendations",
      secondaryActionLabel: "Источник",
    });
  });
});

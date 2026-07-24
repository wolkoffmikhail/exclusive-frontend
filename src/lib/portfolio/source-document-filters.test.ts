import { describe, expect, it } from "vitest";
import type { LlmAnalysis, SourceDocument, SourceDocumentLink } from "./data";
import { sourceDocumentsForAsset } from "./source-document-filters";

const familyId = "family-1";

function document(overrides: Partial<SourceDocument>): SourceDocument {
  return {
    id: "doc-1",
    family_id: familyId,
    source_id: "source-1",
    external_id: null,
    url: null,
    title: "Document",
    published_at: "2026-07-20T10:00:00.000Z",
    issuer_name: null,
    ticker: "SBER",
    isin: null,
    language: "ru",
    document_type: "news",
    trust_level: "manual",
    raw_excerpt: null,
    content_hash: null,
    payload: {},
    created_at: "2026-07-20T10:01:00.000Z",
    updated_at: "2026-07-20T10:01:00.000Z",
    ...overrides,
  };
}

function link(overrides: Partial<SourceDocumentLink>): SourceDocumentLink {
  return {
    id: "link-1",
    family_id: familyId,
    source_document_id: "doc-1",
    asset_id: "asset-1",
    link_type: "ticker",
    confidence: 0.8,
    status: "suggested",
    evidence: {},
    created_at: "2026-07-20T10:02:00.000Z",
    updated_at: "2026-07-20T10:02:00.000Z",
    ...overrides,
  };
}

function analysis(overrides: Partial<LlmAnalysis>): LlmAnalysis {
  return {
    id: "analysis-1",
    family_id: familyId,
    source_document_id: "doc-1",
    analysis_type: "portfolio_impact",
    model: "local-fallback",
    prompt_version: "stage7-test",
    status: "ready",
    summary: "Summary",
    facts: [],
    portfolio_links: [],
    impact_level: "low",
    confidence: 0.7,
    limitations: [],
    citations: [],
    suggested_actions: [],
    what_if_prefill: null,
    safety_flags: [],
    created_at: "2026-07-20T10:03:00.000Z",
    updated_at: "2026-07-20T10:03:00.000Z",
    ...overrides,
  };
}

describe("sourceDocumentsForAsset", () => {
  it("returns documents linked to an asset and excludes rejected links", () => {
    const result = sourceDocumentsForAsset({
      assetId: "asset-1",
      documents: [document({ id: "doc-1" }), document({ id: "doc-2" })],
      links: [
        link({ id: "link-1", source_document_id: "doc-1", status: "suggested" }),
        link({ id: "link-2", source_document_id: "doc-2", status: "rejected" }),
        link({ id: "link-3", source_document_id: "doc-1", asset_id: "asset-2" }),
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0].document.id).toBe("doc-1");
    expect(result[0].links.map((item) => item.id)).toEqual(["link-1"]);
  });

  it("sorts newest documents first and attaches the latest analysis", () => {
    const result = sourceDocumentsForAsset({
      assetId: "asset-1",
      documents: [
        document({ id: "doc-old", title: "Old", published_at: "2026-07-18T10:00:00.000Z" }),
        document({ id: "doc-new", title: "New", published_at: "2026-07-22T10:00:00.000Z" }),
      ],
      links: [
        link({ id: "link-old", source_document_id: "doc-old", status: "confirmed", confidence: 0.95 }),
        link({ id: "link-new", source_document_id: "doc-new", status: "suggested", confidence: 0.65 }),
      ],
      analyses: [
        analysis({ id: "analysis-old", source_document_id: "doc-new", summary: "Earlier", created_at: "2026-07-22T11:00:00.000Z" }),
        analysis({ id: "analysis-new", source_document_id: "doc-new", summary: "Later", created_at: "2026-07-22T12:00:00.000Z" }),
      ],
    });

    expect(result.map((item) => item.document.id)).toEqual(["doc-new", "doc-old"]);
    expect(result[0].latestAnalysis?.id).toBe("analysis-new");
  });

  it("prioritizes confirmed links inside a document", () => {
    const result = sourceDocumentsForAsset({
      assetId: "asset-1",
      documents: [document({ id: "doc-1" })],
      links: [
        link({ id: "suggested", source_document_id: "doc-1", status: "suggested", confidence: 0.99 }),
        link({ id: "confirmed", source_document_id: "doc-1", status: "confirmed", confidence: 0.4 }),
      ],
    });

    expect(result[0].links.map((item) => item.id)).toEqual(["confirmed", "suggested"]);
  });
});

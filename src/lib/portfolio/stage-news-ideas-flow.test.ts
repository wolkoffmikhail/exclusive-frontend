import { describe, expect, it } from "vitest";
import { buildFallbackSourceDocumentAnalysis } from "../server/llm/document-analysis";
import { containsForbiddenTradingCommand } from "../server/llm/safety";
import { linkSourceDocumentToAssets, type LinkableAsset } from "./news-linking";
import { collectNewsProviderItems, demoNewsProvider, type NewsProviderAsset } from "./news-provider";
import { buildManualSourceDocumentImportPlan } from "./source-documents";

const familyId = "family-stage-flow";

const linkableAssets: LinkableAsset[] = [
  {
    id: "asset-sber",
    family_id: familyId,
    name: "Sberbank",
    ticker: "SBER",
    isin: "RU0009029540",
  },
  {
    id: "asset-gazp",
    family_id: familyId,
    name: "Gazprom",
    ticker: "GAZP",
    isin: "RU0007661625",
  },
];

const providerAssets: NewsProviderAsset[] = linkableAssets.map((asset) => ({
  id: asset.id,
  asset_type_code: "stock",
  name: asset.name,
  ticker: asset.ticker,
  currency_code: "RUB",
}));

function analysisDocumentFromPlan(plan: ReturnType<typeof buildManualSourceDocumentImportPlan>, id: string) {
  return {
    id,
    title: plan.document.title,
    url: plan.document.url,
    document_type: plan.document.documentType,
    issuer_name: plan.document.issuerName,
    ticker: plan.document.ticker,
    isin: plan.document.isin,
    published_at: plan.document.publishedAt,
    raw_excerpt: plan.document.rawExcerpt,
  };
}

describe("stage news and idea acceptance flow", () => {
  it("phase 1 loads portfolio news, market news and an investment idea", async () => {
    const result = await collectNewsProviderItems([demoNewsProvider], {
      familyId,
      assets: providerAssets,
      now: new Date("2026-07-27T08:00:00.000Z"),
    });

    expect(result.errors).toEqual([]);
    expect(result.items.map((item) => item.kind)).toEqual(["portfolio_news", "market_news", "idea"]);
    expect(new Set(result.items.map((item) => item.external_id)).size).toBe(3);
    expect(result.items[0]).toMatchObject({
      source: "demo",
      kind: "portfolio_news",
      asset_id: "asset-sber",
      published_at: "2026-07-27T08:00:00.000Z",
    });

    const idea = result.items.find((item) => item.kind === "idea");
    expect(idea).toMatchObject({
      source: "demo",
      asset_id: null,
      payload: { provider: "demo", scenario: "idea" },
    });
    expect(idea?.title.length).toBeGreaterThan(0);
    expect(idea?.summary?.length).toBeGreaterThan(0);
  });

  it("phase 2 links loaded issuer news to a portfolio asset and produces a cited relevance analysis", () => {
    const plan = buildManualSourceDocumentImportPlan({
      input: {
        familyId,
        title: "SBER board recommends dividend",
        ticker: "sber",
        isin: " ru0009029540 ",
        rawExcerpt: "The board recommended a dividend. Record date and final approval require source review.",
        publishedAt: "2026-07-27T09:00:00.000Z",
        documentType: "dividend",
      },
      assets: linkableAssets,
      sourceDocumentId: "source-doc-sber-dividend",
    });

    expect(plan.document).toMatchObject({
      sourceCode: "manual",
      title: "SBER board recommends dividend",
      ticker: "SBER",
      isin: "RU0009029540",
      documentType: "dividend",
    });
    expect(plan.links).toEqual([
      expect.objectContaining({
        asset_id: "asset-sber",
        link_type: "isin",
        confidence: 0.98,
        status: "suggested",
      }),
    ]);

    const analysis = buildFallbackSourceDocumentAnalysis({
      document: analysisDocumentFromPlan(plan, "source-doc-sber-dividend"),
      links: plan.links.map((link) => ({
        asset_id: link.asset_id,
        label: "Sberbank",
        ticker: "SBER",
        status: "confirmed",
        confidence: link.confidence,
      })),
    });

    expect(analysis).toMatchObject({
      status: "ready",
      impact_level: "low",
      what_if_prefill: { asset_id: "asset-sber" },
    });
    expect(analysis.citations.map((citation) => citation.id)).toContain("source-document:source-doc-sber-dividend");
    expect(analysis.portfolio_links).toEqual([
      expect.objectContaining({ entity_type: "asset", entity_id: "asset-sber" }),
    ]);
    expect(analysis.confidence).toBeGreaterThanOrEqual(0.65);
    expect(containsForbiddenTradingCommand(analysis.summary ?? "")).toBe(false);
  });

  it("phase 3 keeps unrelated news outside portfolio relevance", () => {
    const linkCandidates = linkSourceDocumentToAssets({
      assets: linkableAssets,
      document: {
        id: "source-doc-retail-survey",
        family_id: familyId,
        title: "Regional retail traffic survey is published",
        issuer_name: null,
        ticker: null,
        isin: null,
        raw_excerpt: "The text has no held issuer, ticker, ISIN or verified portfolio link.",
      },
    });

    const analysis = buildFallbackSourceDocumentAnalysis({
      document: {
        id: "source-doc-retail-survey",
        title: "Regional retail traffic survey is published",
        url: "https://example.test/news/retail-survey",
        document_type: "news",
        issuer_name: null,
        ticker: null,
        isin: null,
        published_at: "2026-07-27T10:00:00.000Z",
        raw_excerpt: "The text has no held issuer, ticker, ISIN or verified portfolio link.",
      },
      links: [],
    });

    expect(linkCandidates).toEqual([]);
    expect(analysis).toMatchObject({
      status: "ready",
      impact_level: "unknown",
      portfolio_links: [],
      what_if_prefill: null,
    });
    expect(analysis.confidence).toBeLessThanOrEqual(0.3);
    expect(analysis.limitations).toContain("No confirmed asset link is available yet.");
    expect(containsForbiddenTradingCommand(analysis.summary ?? "")).toBe(false);
  });
});

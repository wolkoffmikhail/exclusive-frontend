import { describe, expect, it } from "vitest";
import { firstAcceptanceSourceDefinitions, normalizeSourceDocumentCandidate, secondQueueSourceDefinitions, sourceDefinitionByCode, stage7SourceRegistry } from "./news-sources";

describe("stage7SourceRegistry", () => {
  it("contains primary and manual first-iteration sources", () => {
    expect(firstAcceptanceSourceDefinitions().map((source) => source.source_code)).toEqual(["cbr", "moex_iss", "manual"]);
    expect(secondQueueSourceDefinitions().map((source) => source.source_code)).toEqual(["edisclosure", "t_invest", "sec_edgar", "rbc_investments", "kommersant", "issuer_ir"]);
    expect(sourceDefinitionByCode("manual")?.default_terms_status).toBe("approved");
  });

  it("records terms, rate limits and production access for every source", () => {
    expect(stage7SourceRegistry.every((source) => source.terms_checked_at === "2026-07-24")).toBe(true);
    expect(stage7SourceRegistry.every((source) => source.app_rate_limit.length > 0)).toBe(true);
    expect(stage7SourceRegistry.every((source) => source.production_access.length > 0)).toBe(true);
    expect(firstAcceptanceSourceDefinitions().some((source) => source.requires_token)).toBe(false);
    expect(sourceDefinitionByCode("cbr")).toMatchObject({ default_terms_status: "approved", automated_ingestion: true });
    expect(sourceDefinitionByCode("moex_iss")).toMatchObject({ default_terms_status: "restricted", automated_ingestion: true });
    expect(sourceDefinitionByCode("edisclosure")).toMatchObject({ default_terms_status: "restricted", requires_token: true, automated_ingestion: false });
  });
});

describe("normalizeSourceDocumentCandidate", () => {
  it("normalizes document identity fields and builds a stable hash", () => {
    const first = normalizeSourceDocumentCandidate({
      sourceCode: "manual",
      externalId: " ext-1 ",
      title: "  Дивидендное   сообщение  ",
      ticker: " sber ",
      isin: " ru0009029540 ",
      rawExcerpt: "Совет директоров рекомендовал дивиденды.",
    });
    const second = normalizeSourceDocumentCandidate({
      sourceCode: "manual",
      externalId: "ext-1",
      title: "Дивидендное сообщение",
      ticker: "SBER",
      isin: "RU0009029540",
      rawExcerpt: "Совет директоров рекомендовал дивиденды.",
    });

    expect(first).toMatchObject({
      title: "Дивидендное сообщение",
      ticker: "SBER",
      isin: "RU0009029540",
      language: "ru",
      documentType: "news",
      trustLevel: "manual",
    });
    expect(first.contentHash).toBe(second.contentHash);
  });
});

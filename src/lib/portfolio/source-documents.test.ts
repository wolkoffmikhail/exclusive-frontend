import { describe, expect, it } from "vitest";
import { buildManualSourceDocumentImportPlan } from "./source-documents";

const familyId = "family-1";

describe("buildManualSourceDocumentImportPlan", () => {
  it("normalizes manual documents and creates link candidates", () => {
    const plan = buildManualSourceDocumentImportPlan({
      input: {
        familyId,
        title: "  SBER сообщил о дивидендах  ",
        ticker: " sber ",
        rawExcerpt: "Материал добавлен вручную.",
        publishedAt: "2026-07-23T10:00:00.000Z",
      },
      assets: [
        {
          id: "asset-1",
          family_id: familyId,
          name: "Сбербанк",
          ticker: "SBER",
          isin: "RU0009029540",
        },
      ],
    });

    expect(plan.document).toMatchObject({
      sourceCode: "manual",
      title: "SBER сообщил о дивидендах",
      ticker: "SBER",
      trustLevel: "manual",
    });
    expect(plan.document.publishedAt).toBe("2026-07-23T10:00:00.000Z");
    expect(plan.links[0]).toMatchObject({
      asset_id: "asset-1",
      link_type: "ticker",
    });
  });

  it("keeps links scoped to the input family", () => {
    const plan = buildManualSourceDocumentImportPlan({
      input: {
        familyId,
        title: "GAZP опубликовал отчет",
        ticker: "GAZP",
      },
      assets: [
        {
          id: "asset-other",
          family_id: "other-family",
          name: "Газпром",
          ticker: "GAZP",
          isin: null,
        },
      ],
    });

    expect(plan.links).toEqual([]);
  });
});

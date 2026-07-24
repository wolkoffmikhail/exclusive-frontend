import { describe, expect, it } from "vitest";
import { buildSourceDocumentLinkStatusUpdate, linkSourceDocumentToAssets, type LinkableAsset } from "./news-linking";

const familyId = "family-1";
const assets: LinkableAsset[] = [
  {
    id: "asset-sber",
    family_id: familyId,
    name: "Сбербанк",
    ticker: "SBER",
    isin: "RU0009029540",
  },
  {
    id: "asset-gazp",
    family_id: familyId,
    name: "Газпром",
    ticker: "GAZP",
    isin: "RU0007661625",
  },
];

describe("linkSourceDocumentToAssets", () => {
  it("prefers ISIN matches", () => {
    const links = linkSourceDocumentToAssets({
      assets,
      document: {
        id: "doc-1",
        family_id: familyId,
        title: "Раскрытие эмитента",
        issuer_name: null,
        ticker: null,
        isin: "RU0009029540",
      },
    });

    expect(links[0]).toMatchObject({
      asset_id: "asset-sber",
      link_type: "isin",
      confidence: 0.98,
    });
  });

  it("links by active issuer alias", () => {
    const links = linkSourceDocumentToAssets({
      assets,
      aliases: [
        { asset_id: "asset-gazp", alias: "ПАО Газпром", confidence: 0.9, status: "active" },
      ],
      document: {
        id: "doc-2",
        family_id: familyId,
        title: "ПАО Газпром опубликовал отчетность",
        issuer_name: null,
        ticker: null,
        isin: null,
      },
    });

    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      asset_id: "asset-gazp",
      link_type: "issuer_alias",
    });
  });

  it("does not link assets from another family", () => {
    const links = linkSourceDocumentToAssets({
      assets: [{ ...assets[0], family_id: "other-family" }],
      document: {
        id: "doc-3",
        family_id: familyId,
        title: "SBER опубликовал результаты",
        issuer_name: null,
        ticker: "SBER",
        isin: null,
      },
    });

    expect(links).toEqual([]);
  });
});

describe("buildSourceDocumentLinkStatusUpdate", () => {
  it("accepts supported link statuses", () => {
    expect(buildSourceDocumentLinkStatusUpdate({ status: "confirmed", updatedBy: "user-1" })).toEqual({
      status: "confirmed",
      updatedBy: "user-1",
    });
  });

  it("rejects unsupported link statuses", () => {
    expect(buildSourceDocumentLinkStatusUpdate({ status: "deleted", updatedBy: "user-1" })).toBeNull();
    expect(buildSourceDocumentLinkStatusUpdate({ status: "confirmed", updatedBy: "" })).toBeNull();
  });
});

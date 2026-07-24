import { describe, expect, it } from "vitest";
import { buildMoexAliasRowsForAsset, buildMoexSecurityUrl, parseMoexSecurityReference } from "./moex";

const moexFixture = {
  description: {
    columns: ["name", "title", "value", "type"],
    data: [
      ["SECID", "Код ценной бумаги", "SBER", "string"],
      ["SHORTNAME", "Краткое наименование", "Сбербанк", "string"],
      ["SECNAME", "Полное наименование", "Сбербанк ПАО ао", "string"],
      ["ISIN", "ISIN", "RU0009029540", "string"],
      ["LATNAME", "Английское наименование", "Sberbank", "string"],
    ],
  },
  securities: {
    columns: ["SECID", "SHORTNAME", "NAME", "ISIN"],
    data: [["SBER", "Сбербанк", "Сбербанк ПАО ао", "RU0009029540"]],
  },
};

describe("parseMoexSecurityReference", () => {
  it("extracts aliases from description and securities blocks", () => {
    const reference = parseMoexSecurityReference(moexFixture);

    expect(reference).toEqual({
      secid: "SBER",
      isin: "RU0009029540",
      shortName: "Сбербанк",
      secName: "Сбербанк ПАО ао",
      latName: "Sberbank",
      aliases: ["SBER", "Сбербанк", "Сбербанк ПАО ао", "Sberbank", "RU0009029540"],
    });
  });

  it("builds issuer aliases for an asset", () => {
    const reference = parseMoexSecurityReference(moexFixture);
    expect(reference).not.toBeNull();

    const rows = buildMoexAliasRowsForAsset({ assetId: "asset-1", reference: reference! });

    expect(rows).toContainEqual({
      asset_id: "asset-1",
      alias: "SBER",
      source: "moex",
      confidence: 0.95,
      status: "active",
    });
    expect(rows.find((row) => row.alias === "RU0009029540")?.confidence).toBe(0.98);
  });

  it("builds a stable ISS security URL", () => {
    expect(buildMoexSecurityUrl(" sber ")).toBe("https://iss.moex.com/iss/securities/SBER.json?iss.only=description,securities");
  });
});

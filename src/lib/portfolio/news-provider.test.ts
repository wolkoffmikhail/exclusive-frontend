import { describe, expect, it } from "vitest";
import { buildDemoNewsItems, collectNewsProviderItems, demoNewsProvider, type NewsProvider } from "./news-provider";

const familyId = "family-1";
const asset = {
  id: "asset-1",
  asset_type_code: "stock",
  name: "Demo Asset",
  ticker: "DEMO",
  currency_code: "RUB",
};

describe("buildDemoNewsItems", () => {
  it("creates demo portfolio news, market news and ideas", () => {
    const items = buildDemoNewsItems({
      familyId,
      assets: [asset],
      now: new Date("2026-07-17T10:00:00.000Z"),
    });

    expect(items.map((item) => item.kind)).toEqual(["portfolio_news", "market_news", "idea"]);
    expect(items[0].asset_id).toBe("asset-1");
    expect(items.every((item) => item.source === "demo")).toBe(true);
  });
});

describe("collectNewsProviderItems", () => {
  it("collects provider items", async () => {
    const result = await collectNewsProviderItems([demoNewsProvider], {
      familyId,
      assets: [asset],
      now: new Date("2026-07-17T10:00:00.000Z"),
    });

    expect(result.items).toHaveLength(3);
    expect(result.errors).toEqual([]);
  });

  it("keeps provider errors isolated", async () => {
    const brokenProvider: NewsProvider = {
      id: "broken",
      async fetch() {
        throw new Error("source unavailable");
      },
    };

    const result = await collectNewsProviderItems([brokenProvider, demoNewsProvider], {
      familyId,
      assets: [asset],
      now: new Date("2026-07-17T10:00:00.000Z"),
    });

    expect(result.items).toHaveLength(3);
    expect(result.errors).toEqual([{ provider_id: "broken", message: "source unavailable" }]);
  });
});

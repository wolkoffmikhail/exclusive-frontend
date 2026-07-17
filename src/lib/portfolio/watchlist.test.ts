import { describe, expect, it } from "vitest";
import { filterWatchlistItems, type WatchlistItemLike } from "./watchlist";

function item(overrides: Partial<WatchlistItemLike> = {}): WatchlistItemLike {
  return {
    item_type: "asset",
    status: "watching",
    updated_at: "2026-07-17T10:00:00.000Z",
    ...overrides,
  };
}

describe("filterWatchlistItems", () => {
  it("filters by item type", () => {
    const items = [
      item({ item_type: "asset" }),
      item({ item_type: "recommendation" }),
    ];

    expect(filterWatchlistItems(items, { type: "recommendation" })).toEqual([items[1]]);
  });

  it("treats ideas as news in the news filter", () => {
    const items = [
      item({ item_type: "news" }),
      item({ item_type: "idea" }),
      item({ item_type: "asset" }),
    ];

    expect(filterWatchlistItems(items, { type: "news" })).toEqual([items[0], items[1]]);
  });

  it("filters by status", () => {
    const items = [
      item({ status: "watching" }),
      item({ status: "done" }),
    ];

    expect(filterWatchlistItems(items, { status: "done" })).toEqual([items[1]]);
  });

  it("sorts by updated_at descending", () => {
    const oldItem = item({ updated_at: "2026-07-10T10:00:00.000Z" });
    const newItem = item({ updated_at: "2026-07-18T10:00:00.000Z" });

    expect(filterWatchlistItems([oldItem, newItem], {}).map((entry) => entry.updated_at)).toEqual([
      "2026-07-18T10:00:00.000Z",
      "2026-07-10T10:00:00.000Z",
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { filterPortfolioEvents, splitPortfolioEvents, type PortfolioEventLike } from "./events";

function event(overrides: Partial<PortfolioEventLike> = {}): PortfolioEventLike {
  return {
    event_date: "2026-07-20",
    event_type: "dividend",
    status: "scheduled",
    ...overrides,
  };
}

describe("filterPortfolioEvents", () => {
  it("filters events by type", () => {
    const events = [
      event({ event_type: "dividend" }),
      event({ event_type: "coupon" }),
      event({ event_type: "redemption" }),
    ];

    expect(filterPortfolioEvents(events, { type: "coupon" })).toEqual([events[1]]);
  });

  it("returns all events without a type filter", () => {
    const events = [event({ event_type: "dividend" }), event({ event_type: "coupon" })];

    expect(filterPortfolioEvents(events, {})).toEqual(events);
  });
});

describe("splitPortfolioEvents", () => {
  it("splits upcoming events and history by date and status", () => {
    const upcoming = event({ event_date: "2026-07-21", status: "scheduled" });
    const past = event({ event_date: "2026-07-10", status: "scheduled" });
    const done = event({ event_date: "2026-07-22", status: "done" });
    const cancelled = event({ event_date: "2026-07-23", status: "cancelled" });

    const result = splitPortfolioEvents([upcoming, past, done, cancelled], "2026-07-17");

    expect(result.upcoming).toEqual([upcoming]);
    expect(result.history).toEqual([cancelled, done, past]);
  });

  it("sorts upcoming events ascending and history descending", () => {
    const result = splitPortfolioEvents([
      event({ event_date: "2026-08-10" }),
      event({ event_date: "2026-07-20" }),
      event({ event_date: "2026-06-01" }),
      event({ event_date: "2026-07-01" }),
    ], "2026-07-17");

    expect(result.upcoming.map((item) => item.event_date)).toEqual(["2026-07-20", "2026-08-10"]);
    expect(result.history.map((item) => item.event_date)).toEqual(["2026-07-01", "2026-06-01"]);
  });
});

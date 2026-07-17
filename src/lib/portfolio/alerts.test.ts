import { describe, expect, it } from "vitest";
import { planLimitAlertLifecycle, type ExistingLimitAlert } from "./alerts";
import type { LimitViolation } from "./limits";

function violation(overrides: Partial<LimitViolation> = {}): LimitViolation {
  return {
    limitId: "limit-1",
    limitType: "cash_min_share",
    scopeKey: null,
    direction: "min",
    severity: "warning",
    fingerprint: "limit:limit-1:cash_min_share:portfolio:min",
    title: "Лимит нарушен",
    currentValue: 0.02,
    thresholdValue: 0.05,
    href: "/dashboard",
    payload: {
      limit_id: "limit-1",
      limit_type: "cash_min_share",
      scope_key: null,
      direction: "min",
      severity: "warning",
      current_value: 0.02,
      threshold_value: 0.05,
      current_percent: 2,
      threshold_percent: 5,
      source: "portfolio_analytics",
    },
    ...overrides,
  };
}

function alert(overrides: Partial<ExistingLimitAlert> = {}): ExistingLimitAlert {
  return {
    id: "alert-1",
    fingerprint: "limit:limit-1:cash_min_share:portfolio:min",
    source: "limits",
    status: "triggered",
    ...overrides,
  };
}

describe("planLimitAlertLifecycle", () => {
  it("plans new alerts for new violations", () => {
    const currentViolation = violation();
    const plan = planLimitAlertLifecycle({ existingAlerts: [], violations: [currentViolation] });

    expect(plan.create).toEqual([currentViolation]);
    expect(plan.update).toEqual([]);
    expect(plan.resolve).toEqual([]);
  });

  it("plans updates instead of duplicate alerts for existing fingerprints", () => {
    const currentViolation = violation();
    const plan = planLimitAlertLifecycle({
      existingAlerts: [alert({ id: "alert-existing" })],
      violations: [currentViolation],
    });

    expect(plan.create).toEqual([]);
    expect(plan.update).toEqual([{ alertId: "alert-existing", violation: currentViolation }]);
  });

  it("plans resolved alerts when violations disappear", () => {
    const staleAlert = alert({ id: "alert-stale", fingerprint: "stale" });
    const plan = planLimitAlertLifecycle({
      existingAlerts: [staleAlert],
      violations: [violation()],
    });

    expect(plan.resolve).toEqual([staleAlert]);
  });

  it("ignores non-limit and already resolved alerts", () => {
    const plan = planLimitAlertLifecycle({
      existingAlerts: [
        alert({ id: "manual", source: "manual" }),
        alert({ id: "resolved", status: "archived" }),
      ],
      violations: [],
    });

    expect(plan.resolve).toEqual([]);
  });
});

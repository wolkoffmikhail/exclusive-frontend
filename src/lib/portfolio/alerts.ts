import type { LimitViolation } from "./limits";

export type ExistingLimitAlert = {
  id: string;
  fingerprint: string | null;
  source: string;
  status: string;
};

export type LimitAlertLifecyclePlan = {
  create: LimitViolation[];
  update: Array<{ alertId: string; violation: LimitViolation }>;
  resolve: ExistingLimitAlert[];
};

export function planLimitAlertLifecycle({
  existingAlerts,
  violations,
}: {
  existingAlerts: ExistingLimitAlert[];
  violations: LimitViolation[];
}): LimitAlertLifecyclePlan {
  const activeExistingAlerts = existingAlerts.filter((alert) => alert.source === "limits" && alert.fingerprint && (alert.status === "active" || alert.status === "triggered"));
  const existingByFingerprint = new Map(activeExistingAlerts.map((alert) => [alert.fingerprint, alert]));
  const activeFingerprints = new Set(violations.map((violation) => violation.fingerprint));

  const create: LimitViolation[] = [];
  const update: Array<{ alertId: string; violation: LimitViolation }> = [];

  for (const violation of violations) {
    const existing = existingByFingerprint.get(violation.fingerprint);
    if (existing) {
      update.push({ alertId: existing.id, violation });
    } else {
      create.push(violation);
    }
  }

  return {
    create,
    update,
    resolve: activeExistingAlerts.filter((alert) => alert.fingerprint && !activeFingerprints.has(alert.fingerprint)),
  };
}

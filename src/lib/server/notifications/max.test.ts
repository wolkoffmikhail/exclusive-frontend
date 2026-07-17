import { describe, expect, it } from "vitest";
import { buildMaxAlertMessage } from "./max";

describe("buildMaxAlertMessage", () => {
  it("formats alert messages without secrets", () => {
    const message = buildMaxAlertMessage({
      appUrl: "https://example.test/settings",
      severity: "critical",
      title: "Лимит нарушен",
      value: "Текущее значение: 42%",
    });

    expect(message).toContain("CRITICAL");
    expect(message).toContain("Лимит нарушен");
    expect(message).toContain("https://example.test/settings");
    expect(message).not.toContain("token");
  });
});

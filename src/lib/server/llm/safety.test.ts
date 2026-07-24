import { describe, expect, it } from "vitest";
import { containsForbiddenTradingCommand, redactLlmContext, validateAdvisorStructuredResponse } from "./safety";

const validResponse = {
  answer: "Новость может быть важна для позиции, но данных для вывода о сделке недостаточно.",
  facts: [
    { text: "Эмитент опубликовал сообщение.", citation_ids: ["source-1"] },
  ],
  assumptions: [],
  portfolio_links: [
    { entity_type: "asset", entity_id: "asset-1", label: "Сбербанк" },
  ],
  source_links: [
    { id: "source-1", url: "https://example.test/news", title: "Сообщение эмитента" },
  ],
  impact_level: "unknown",
  confidence: 0.42,
  suggested_actions: [
    { label: "Проверить в what-if", action_type: "open_what_if", href: "/what-if?asset_id=asset-1" },
  ],
  what_if_prefill: { asset_id: "asset-1" },
  limitations: ["Нет данных о цене после новости."],
  disclaimer_required: true,
  safety_flags: [],
};

describe("validateAdvisorStructuredResponse", () => {
  it("accepts cited cautious responses", () => {
    const result = validateAdvisorStructuredResponse(validResponse);

    expect(result.ok).toBe(true);
  });

  it("rejects uncited facts", () => {
    const result = validateAdvisorStructuredResponse({
      ...validResponse,
      facts: [{ text: "Факт без ссылки.", citation_ids: [] }],
    });

    expect(result.ok).toBe(false);
    expect(result.safetyFlags[0]).toContain("missing_or_unknown_citation");
  });

  it("rejects direct trading commands", () => {
    const result = validateAdvisorStructuredResponse({
      ...validResponse,
      answer: "Покупайте этот актив сейчас.",
    });

    expect(result.ok).toBe(false);
    expect(result.safetyFlags).toContain("forbidden_trading_command");
  });
});

describe("redactLlmContext", () => {
  it("removes secret-looking fields recursively", () => {
    const redacted = redactLlmContext({
      family_id: "family-1",
      service_role_key: "secret",
      nested: { telegram_token: "token", note: "ok" },
      auth: "Bearer very-secret-token",
    });

    expect(redacted).toEqual({
      family_id: "family-1",
      service_role_key: "[REDACTED]",
      nested: { telegram_token: "[REDACTED]", note: "ok" },
      auth: "Bearer [REDACTED]",
    });
  });

  it("detects forbidden trading commands", () => {
    expect(containsForbiddenTradingCommand("Гарантированно вырастет, покупайте")).toBe(true);
  });
});

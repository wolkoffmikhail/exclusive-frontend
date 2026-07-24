import { describe, expect, it } from "vitest";
import { generateAdvisorResponseWithConfiguredProvider, readLlmProviderConfig } from "./provider";
import type { VersionedLlmPrompt } from "./prompts";

const validStructuredResponse = {
  answer: "The document may be relevant to the linked asset, but there is not enough evidence for a trading conclusion.",
  facts: [
    { text: "The issuer published a source document.", citation_ids: ["source-document:doc-1"] },
  ],
  assumptions: [],
  portfolio_links: [
    { entity_type: "asset", entity_id: "asset-1", label: "Demo asset" },
  ],
  source_links: [
    { id: "source-document:doc-1", url: "https://example.test/source", title: "Source" },
  ],
  impact_level: "unknown",
  confidence: 0.4,
  suggested_actions: [
    { label: "Open source", action_type: "open_source", href: "https://example.test/source" },
  ],
  what_if_prefill: { asset_id: "asset-1" },
  limitations: ["Only the supplied source document was reviewed."],
  disclaimer_required: true,
  safety_flags: [],
};

const prompt: VersionedLlmPrompt = {
  promptVersion: "stage7-test-prompt-v1",
  messages: [
    { role: "system", content: "Return JSON only." },
    { role: "user", content: "Analyze source-document:doc-1 with auth Bearer secret-token-value." },
  ],
};

describe("readLlmProviderConfig", () => {
  it("keeps LLM disabled when the env flag is set", () => {
    expect(readLlmProviderConfig({
      LLM_DISABLED: "1",
      LLM_MODEL: "configured-model",
      LLM_API_KEY: "secret",
    })).toMatchObject({
      enabled: false,
      disabledReason: "env_disabled",
      model: "configured-model",
    });
  });

  it("requires a model instead of hardcoding one", () => {
    expect(readLlmProviderConfig({
      LLM_PROVIDER: "openai-compatible",
      LLM_API_KEY: "secret",
    })).toMatchObject({
      enabled: false,
      disabledReason: "missing_model",
      model: null,
    });
  });

  it("enables Mistral with Mistral-specific runtime env", () => {
    expect(readLlmProviderConfig({
      LLM_PROVIDER: "mistral",
      MISTRAL_API_KEY: "secret",
      MISTRAL_MODEL: "configured-mistral-model",
    })).toMatchObject({
      enabled: true,
      provider: "mistral",
      model: "configured-mistral-model",
      baseUrl: "https://api.mistral.ai/v1",
    });
  });

  it("auto-detects Mistral when only Mistral credentials are configured", () => {
    expect(readLlmProviderConfig({
      MISTRAL_API_KEY: "secret",
      MISTRAL_MODEL: "configured-mistral-model",
    })).toMatchObject({
      enabled: true,
      provider: "mistral",
      model: "configured-mistral-model",
    });
  });
});

describe("generateAdvisorResponseWithConfiguredProvider", () => {
  it("posts a redacted prompt and validates structured output", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const result = await generateAdvisorResponseWithConfiguredProvider(prompt, {
      env: {
        LLM_PROVIDER: "openai-compatible",
        LLM_BASE_URL: "https://llm.example.test/v1",
        LLM_MODEL: "configured-model",
        LLM_API_KEY: "secret-api-key",
      },
      fetchImpl: async (_url, init) => {
        capturedBody = JSON.parse(String(init.body));
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            choices: [{ message: { content: JSON.stringify(validStructuredResponse) } }],
          }),
        };
      },
    });

    expect(result).toMatchObject({
      ok: true,
      model: "configured-model",
      promptVersion: "stage7-test-prompt-v1",
    });
    expect(JSON.stringify(capturedBody)).not.toContain("secret-token-value");
    expect(JSON.stringify(capturedBody)).toContain("Bearer [REDACTED]");
  });

  it("rejects invalid provider output before it can be saved as ready", async () => {
    const result = await generateAdvisorResponseWithConfiguredProvider(prompt, {
      env: {
        LLM_PROVIDER: "openai-compatible",
        LLM_MODEL: "configured-model",
        LLM_API_KEY: "secret-api-key",
      },
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ answer: "Missing required fields." }) } }],
        }),
      }),
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "provider_invalid_structured_output",
    });
  });

  it("posts Mistral requests to the Mistral chat completions endpoint", async () => {
    let capturedUrl: string | null = null;
    const result = await generateAdvisorResponseWithConfiguredProvider(prompt, {
      env: {
        LLM_PROVIDER: "mistral",
        MISTRAL_MODEL: "configured-mistral-model",
        MISTRAL_API_KEY: "secret-api-key",
      },
      fetchImpl: async (url) => {
        capturedUrl = url;
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            choices: [{ message: { content: JSON.stringify(validStructuredResponse) } }],
          }),
        };
      },
    });

    expect(result).toMatchObject({
      ok: true,
      model: "configured-mistral-model",
    });
    expect(capturedUrl).toBe("https://api.mistral.ai/v1/chat/completions");
  });
});

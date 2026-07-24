import { redactLlmContext, validateAdvisorStructuredResponse, type AdvisorStructuredResponse } from "./safety";
import type { VersionedLlmPrompt } from "./prompts";

export type LlmProviderName = "none" | "openai-compatible" | "mistral";

export type LlmProviderConfig = {
  enabled: boolean;
  provider: LlmProviderName;
  model: string | null;
  baseUrl: string;
  apiKey: string | null;
  disabledReason: string | null;
};

export type LlmProviderSuccess = {
  ok: true;
  response: AdvisorStructuredResponse;
  model: string;
  promptVersion: string;
  safetyFlags: string[];
};

export type LlmProviderFailure = {
  ok: false;
  reason: string;
  model: string | null;
  promptVersion: string;
  safetyFlags: string[];
};

export type LlmProviderResult = LlmProviderSuccess | LlmProviderFailure;

type FetchLike = (input: string, init: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

type LlmEnv = Record<string, string | undefined>;

function envTrue(value: string | undefined) {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

function firstText(...values: Array<string | undefined>) {
  return values.map((value) => value?.trim()).find(Boolean) ?? null;
}

function readProviderName(env: LlmEnv): LlmProviderName | "unsupported" {
  const explicitProvider = firstText(env.LLM_PROVIDER)?.toLowerCase();
  if (explicitProvider) {
    return explicitProvider === "none" || explicitProvider === "openai-compatible" || explicitProvider === "mistral"
      ? explicitProvider
      : "unsupported";
  }

  if (firstText(env.MISTRAL_API_KEY)) return "mistral";
  if (firstText(env.LLM_API_KEY, env.OPENAI_API_KEY)) return "openai-compatible";
  return "none";
}

function readProviderApiKey(provider: LlmProviderName, env: LlmEnv) {
  if (provider === "mistral") return firstText(env.MISTRAL_API_KEY, env.LLM_API_KEY);
  if (provider === "openai-compatible") return firstText(env.LLM_API_KEY, env.OPENAI_API_KEY);
  return null;
}

function readProviderModel(provider: LlmProviderName, env: LlmEnv) {
  if (provider === "mistral") return firstText(env.MISTRAL_MODEL, env.LLM_MODEL);
  if (provider === "openai-compatible") return firstText(env.LLM_MODEL, env.OPENAI_MODEL);
  return firstText(env.LLM_MODEL, env.OPENAI_MODEL, env.MISTRAL_MODEL);
}

function readProviderBaseUrl(provider: LlmProviderName, env: LlmEnv) {
  if (provider === "mistral") {
    return firstText(env.MISTRAL_BASE_URL, env.LLM_BASE_URL) ?? "https://api.mistral.ai/v1";
  }

  return firstText(env.LLM_BASE_URL, env.OPENAI_BASE_URL) ?? "https://api.openai.com/v1";
}

export function readLlmProviderConfig(env: LlmEnv = process.env): LlmProviderConfig {
  const provider = readProviderName(env);
  const disabled = envTrue(env.LLM_DISABLED) || envTrue(env.DISABLE_LLM) || envTrue(env.LLM_FEATURES_DISABLED);
  const effectiveProvider = provider === "unsupported" ? "none" : provider;
  const apiKey = readProviderApiKey(effectiveProvider, env);
  const model = readProviderModel(effectiveProvider, env);
  const baseUrl = readProviderBaseUrl(effectiveProvider, env);

  if (disabled) {
    return { enabled: false, provider: "none", model, baseUrl, apiKey: null, disabledReason: "env_disabled" };
  }

  if (provider === "unsupported" || provider === "none") {
    return { enabled: false, provider: "none", model, baseUrl, apiKey: null, disabledReason: provider === "none" ? "provider_not_configured" : "unsupported_provider" };
  }

  if (!apiKey) {
    return { enabled: false, provider, model, baseUrl, apiKey: null, disabledReason: "missing_api_key" };
  }

  if (!model) {
    return { enabled: false, provider, model: null, baseUrl, apiKey: null, disabledReason: "missing_model" };
  }

  return { enabled: true, provider, model, baseUrl, apiKey, disabledReason: null };
}

function parseChatCompletionContent(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return null;
  const first = choices[0];
  if (!first || typeof first !== "object") return null;
  const message = (first as { message?: unknown }).message;
  if (!message || typeof message !== "object") return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

function parseJsonObject(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1)) as unknown;
    } catch {
      return null;
    }
  }
}

export async function generateAdvisorResponseWithConfiguredProvider(
  prompt: VersionedLlmPrompt,
  {
    env = process.env,
    fetchImpl = fetch as FetchLike,
  }: {
    env?: LlmEnv;
    fetchImpl?: FetchLike;
  } = {},
): Promise<LlmProviderResult> {
  const config = readLlmProviderConfig(env);
  if (!config.enabled || !config.apiKey || !config.model) {
    return {
      ok: false,
      reason: config.disabledReason ?? "provider_disabled",
      model: config.model,
      promptVersion: prompt.promptVersion,
      safetyFlags: [config.disabledReason ?? "provider_disabled"],
    };
  }

  const endpoint = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const body = {
    model: config.model,
    response_format: { type: "json_object" },
    temperature: 0.1,
    messages: redactLlmContext(prompt.messages),
  };

  let responseText: string;
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    responseText = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        reason: `provider_http_${response.status}`,
        model: config.model,
        promptVersion: prompt.promptVersion,
        safetyFlags: ["provider_http_error"],
      };
    }
  } catch {
    return {
      ok: false,
      reason: "provider_fetch_failed",
      model: config.model,
      promptVersion: prompt.promptVersion,
      safetyFlags: ["provider_fetch_failed"],
    };
  }

  const completion = parseJsonObject(responseText);
  const content = parseChatCompletionContent(completion);
  const parsedContent = content ? parseJsonObject(content) : null;
  const validation = validateAdvisorStructuredResponse(parsedContent);

  if (!validation.ok) {
    return {
      ok: false,
      reason: "provider_invalid_structured_output",
      model: config.model,
      promptVersion: prompt.promptVersion,
      safetyFlags: validation.safetyFlags,
    };
  }

  return {
    ok: true,
    response: validation.value,
    model: config.model,
    promptVersion: prompt.promptVersion,
    safetyFlags: validation.safetyFlags,
  };
}

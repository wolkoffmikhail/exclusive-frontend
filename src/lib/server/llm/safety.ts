import { z } from "zod";

const forbiddenTradingPatterns = [
  /(^|[^а-яёa-z])покупа(й|йте|ть)($|[^а-яёa-z])/i,
  /(^|[^а-яёa-z])продава(й|йте|ть)($|[^а-яёa-z])/i,
  /(^|[^а-яёa-z])обязательно\s+(купить|продать)($|[^а-яёa-z])/i,
  /(^|[^а-яёa-z])гарантированн\w*\s+(вырастет|доходност)/i,
  /\bbuy\s+now\b/i,
  /\bsell\s+now\b/i,
];

const secretKeyPattern = /(service[_-]?role|supabase[_-]?key|telegram[_-]?token|max[_-]?token|t[_-]?invest[_-]?token|cookie|authorization)/i;

export const advisorStructuredResponseSchema = z.object({
  answer: z.string().min(1),
  facts: z.array(z.object({
    text: z.string().min(1),
    citation_ids: z.array(z.string()).default([]),
  })).default([]),
  assumptions: z.array(z.string()).default([]),
  portfolio_links: z.array(z.object({
    entity_type: z.string().min(1),
    entity_id: z.string().min(1),
    label: z.string().min(1),
  })).default([]),
  source_links: z.array(z.object({
    id: z.string().min(1),
    url: z.string().nullable().optional(),
    title: z.string().min(1),
  })).default([]),
  impact_level: z.enum(["none", "low", "medium", "high", "unknown"]),
  confidence: z.number().min(0).max(1),
  suggested_actions: z.array(z.object({
    label: z.string().min(1),
    action_type: z.enum(["open_source", "open_asset", "open_recommendation", "open_what_if", "none"]),
    href: z.string().nullable().optional(),
  })).default([]),
  what_if_prefill: z.record(z.string(), z.string()).nullable().default(null),
  limitations: z.array(z.string()).default([]),
  disclaimer_required: z.boolean().default(true),
  safety_flags: z.array(z.string()).default([]),
});

export type AdvisorStructuredResponse = z.infer<typeof advisorStructuredResponseSchema>;

export type AdvisorValidationResult =
  | { ok: true; value: AdvisorStructuredResponse; safetyFlags: string[] }
  | { ok: false; errors: string[]; safetyFlags: string[] };

export function containsForbiddenTradingCommand(text: string) {
  return forbiddenTradingPatterns.some((pattern) => pattern.test(text));
}

export function redactLlmContext<T>(input: T): T {
  if (typeof input === "string") {
    if (secretKeyPattern.test(input)) return "[REDACTED]" as T;
    return input.replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]") as T;
  }

  if (Array.isArray(input)) {
    return input.map((item) => redactLlmContext(item)) as T;
  }

  if (input && typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => [
        key,
        secretKeyPattern.test(key) ? "[REDACTED]" : redactLlmContext(value),
      ]),
    ) as T;
  }

  return input;
}

function missingCitationFlags(response: AdvisorStructuredResponse) {
  const sourceIds = new Set(response.source_links.map((source) => source.id));
  return response.facts
    .filter((fact) => fact.citation_ids.length === 0 || fact.citation_ids.some((id) => !sourceIds.has(id)))
    .map((fact) => `missing_or_unknown_citation:${fact.text.slice(0, 60)}`);
}

export function validateAdvisorStructuredResponse(input: unknown): AdvisorValidationResult {
  const parsed = advisorStructuredResponseSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      safetyFlags: ["invalid_schema"],
    };
  }

  const safetyFlags = [
    ...missingCitationFlags(parsed.data),
    ...(containsForbiddenTradingCommand(parsed.data.answer) ? ["forbidden_trading_command"] : []),
  ];

  if (safetyFlags.length > 0) {
    return {
      ok: false,
      errors: safetyFlags,
      safetyFlags,
    };
  }

  return {
    ok: true,
    value: {
      ...parsed.data,
      safety_flags: Array.from(new Set([...parsed.data.safety_flags, ...safetyFlags])),
    },
    safetyFlags,
  };
}

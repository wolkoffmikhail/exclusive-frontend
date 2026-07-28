import { createHash } from "crypto";

export type NewsSourceType =
  | "regulator"
  | "exchange_reference"
  | "issuer_disclosure"
  | "broker_api"
  | "editorial"
  | "issuer_ir"
  | "manual";

export type NewsSourceTermsStatus = "unchecked" | "approved" | "restricted" | "blocked";
export type SourceDocumentTrustLevel = "primary" | "reference" | "editorial" | "manual";

export type NewsSourceDefinition = {
  source_code: string;
  source_name: string;
  source_type: NewsSourceType;
  base_url: string | null;
  requires_token: boolean;
  default_terms_status: NewsSourceTermsStatus;
  terms_url: string | null;
  terms_checked_at: string;
  acceptance_queue: "first" | "second";
  automated_ingestion: boolean;
  app_rate_limit: string;
  production_access: string;
  trust_level: SourceDocumentTrustLevel;
  stores_full_text: boolean;
  notes: string;
};

export type SourceDocumentCandidate = {
  sourceCode: string;
  externalId?: string | null;
  url?: string | null;
  title: string;
  publishedAt?: string | null;
  issuerName?: string | null;
  ticker?: string | null;
  isin?: string | null;
  language?: string | null;
  documentType?: string | null;
  trustLevel?: SourceDocumentTrustLevel | null;
  rawExcerpt?: string | null;
  payload?: Record<string, unknown>;
};

export type NormalizedSourceDocument = {
  sourceCode: string;
  externalId: string | null;
  url: string | null;
  title: string;
  publishedAt: string | null;
  issuerName: string | null;
  ticker: string | null;
  isin: string | null;
  language: string;
  documentType: string;
  trustLevel: SourceDocumentTrustLevel;
  rawExcerpt: string | null;
  contentHash: string;
  payload: Record<string, unknown>;
};

export const stage7SourceRegistry: NewsSourceDefinition[] = [
  {
    source_code: "cbr",
    source_name: "Банк России",
    source_type: "regulator",
    base_url: "https://www.cbr.ru/",
    requires_token: false,
    default_terms_status: "approved",
    terms_url: "https://www.cbr.ru/user_agreement/",
    terms_checked_at: "2026-07-24",
    acceptance_queue: "first",
    automated_ingestion: true,
    app_rate_limit: "1 RSS request per minute per family; 20 items per run",
    production_access: "Use official RSS channels with mandatory source link; store metadata, URL, hash and short excerpt.",
    trust_level: "primary",
    stores_full_text: false,
    notes: "Primary regulatory source. Terms and exact RSS/API paths must be checked before production ingestion.",
  },
  {
    source_code: "moex_iss",
    source_name: "MOEX ISS",
    source_type: "exchange_reference",
    base_url: "https://iss.moex.com/iss/",
    requires_token: false,
    default_terms_status: "restricted",
    terms_url: "https://www.moex.com/a2193",
    terms_checked_at: "2026-07-24",
    acceptance_queue: "first",
    automated_ingestion: true,
    app_rate_limit: "30 sequential security lookups per run; do not request real-time market data",
    production_access: "Use only instrument description/reference data for linking; no redistribution or profit-extraction use without MOEX agreement.",
    trust_level: "reference",
    stores_full_text: false,
    notes: "Reference and linking source for ticker, ISIN, board and issuer metadata.",
  },
  {
    source_code: "edisclosure",
    source_name: "e-disclosure",
    source_type: "issuer_disclosure",
    base_url: "https://www.e-disclosure.ru/",
    requires_token: true,
    default_terms_status: "restricted",
    terms_url: "https://e-disclosure.ru/poluchenie-informacii/shlyuz-api",
    terms_checked_at: "2026-07-24",
    acceptance_queue: "second",
    automated_ingestion: false,
    app_rate_limit: "Disabled until API access/subscription is configured; manual URL/text fallback only",
    production_access: "Automated API access requires authorization/subscription; first acceptance uses manual URL/text import for issuer disclosures.",
    trust_level: "primary",
    stores_full_text: false,
    notes: "Primary issuer disclosure source. Production access method must be confirmed before automated ingestion.",
  },
  {
    source_code: "manual",
    source_name: "Ручной импорт",
    source_type: "manual",
    base_url: null,
    requires_token: false,
    default_terms_status: "approved",
    terms_url: null,
    terms_checked_at: "2026-07-24",
    acceptance_queue: "first",
    automated_ingestion: false,
    app_rate_limit: "User initiated only; no background fetch",
    production_access: "Family-scoped fallback for user-provided URLs and permitted excerpts.",
    trust_level: "manual",
    stores_full_text: true,
    notes: "Family-scoped fallback for pasted URLs or user-provided excerpts.",
  },
  {
    source_code: "t_invest",
    source_name: "T-Invest API",
    source_type: "broker_api",
    base_url: null,
    requires_token: true,
    default_terms_status: "restricted",
    terms_url: null,
    terms_checked_at: "2026-07-24",
    acceptance_queue: "second",
    automated_ingestion: false,
    app_rate_limit: "Disabled until user token, consent and terms are configured",
    production_access: "Second queue only; never include broker tokens in prompts/logs/exports.",
    trust_level: "reference",
    stores_full_text: false,
    notes: "Potential second-queue source for broker-side reference data after explicit user setup.",
  },
  {
    source_code: "sec_edgar",
    source_name: "SEC EDGAR",
    source_type: "regulator",
    base_url: "https://www.sec.gov/",
    requires_token: false,
    default_terms_status: "approved",
    terms_url: "https://www.sec.gov/os/accessing-edgar-data",
    terms_checked_at: "2026-07-28",
    acceptance_queue: "second",
    automated_ingestion: true,
    app_rate_limit: "One current-filings Atom request per scheduled run; descriptive User-Agent is required.",
    production_access: "Use EDGAR current filings Atom for issuer events; store metadata, URL, hash and short excerpt only.",
    trust_level: "primary",
    stores_full_text: false,
    notes: "Foreign primary source for US issuer events, useful for 8-K relevance and idea generation.",
  },
  {
    source_code: "fed_press",
    source_name: "Federal Reserve",
    source_type: "regulator",
    base_url: "https://www.federalreserve.gov/",
    requires_token: false,
    default_terms_status: "approved",
    terms_url: "https://www.federalreserve.gov/feeds/feeds.htm",
    terms_checked_at: "2026-07-28",
    acceptance_queue: "second",
    automated_ingestion: true,
    app_rate_limit: "One RSS request per scheduled run; short official excerpts only.",
    production_access: "Use official Federal Reserve press RSS for monetary policy and regulatory context.",
    trust_level: "primary",
    stores_full_text: false,
    notes: "Foreign macro source for Fed decisions, banking regulation and market-moving US policy signals.",
  },
  {
    source_code: "fed_feds_notes",
    source_name: "Federal Reserve FEDS Notes",
    source_type: "regulator",
    base_url: "https://www.federalreserve.gov/",
    requires_token: false,
    default_terms_status: "approved",
    terms_url: "https://www.federalreserve.gov/feeds/feeds.htm",
    terms_checked_at: "2026-07-28",
    acceptance_queue: "second",
    automated_ingestion: true,
    app_rate_limit: "One RSS request per scheduled run; research note metadata and short excerpt only.",
    production_access: "Use official Federal Reserve research RSS for analytical context and investment idea prompts.",
    trust_level: "primary",
    stores_full_text: false,
    notes: "Foreign insight source with Fed research notes for macro themes and risk narratives.",
  },
  {
    source_code: "ecb_press",
    source_name: "European Central Bank",
    source_type: "regulator",
    base_url: "https://www.ecb.europa.eu/",
    requires_token: false,
    default_terms_status: "approved",
    terms_url: "https://www.ecb.europa.eu/rss/press.html",
    terms_checked_at: "2026-07-28",
    acceptance_queue: "second",
    automated_ingestion: true,
    app_rate_limit: "One RSS request per scheduled run; short official excerpts only.",
    production_access: "Use official ECB press RSS for euro-area monetary policy and bank-supervision context.",
    trust_level: "primary",
    stores_full_text: false,
    notes: "Foreign macro source for ECB policy, inflation, EUR rates and European banking signals.",
  },
  {
    source_code: "ecb_blog",
    source_name: "ECB Blog",
    source_type: "regulator",
    base_url: "https://www.ecb.europa.eu/",
    requires_token: false,
    default_terms_status: "approved",
    terms_url: "https://www.ecb.europa.eu/rss/blog.html",
    terms_checked_at: "2026-07-28",
    acceptance_queue: "second",
    automated_ingestion: true,
    app_rate_limit: "One RSS request per scheduled run; metadata and short excerpt only.",
    production_access: "Use official ECB blog RSS for analytical context and qualitative investment insights.",
    trust_level: "primary",
    stores_full_text: false,
    notes: "Foreign insight source with ECB commentary for euro-area macro themes.",
  },
  {
    source_code: "bis_research",
    source_name: "BIS Research Hub",
    source_type: "regulator",
    base_url: "https://www.bis.org/",
    requires_token: false,
    default_terms_status: "approved",
    terms_url: "https://www.bis.org/rss/index.htm",
    terms_checked_at: "2026-07-28",
    acceptance_queue: "second",
    automated_ingestion: true,
    app_rate_limit: "One RSS request per scheduled run; research metadata and short excerpt only.",
    production_access: "Use BIS Research Hub RSS to discover central-bank research; store citation metadata and short excerpt.",
    trust_level: "reference",
    stores_full_text: false,
    notes: "Foreign insight source for central bank research themes, financial stability and liquidity risks.",
  },
  {
    source_code: "rbc_investments",
    source_name: "РБК Инвестиции",
    source_type: "editorial",
    base_url: "https://quote.rbc.ru/",
    requires_token: false,
    default_terms_status: "unchecked",
    terms_url: null,
    terms_checked_at: "2026-07-24",
    acceptance_queue: "second",
    automated_ingestion: false,
    app_rate_limit: "Disabled until editorial reuse terms are checked",
    production_access: "Second queue editorial context only after licensing/terms review.",
    trust_level: "editorial",
    stores_full_text: false,
    notes: "Editorial source candidate; not a primary fact source for issuer events.",
  },
  {
    source_code: "kommersant",
    source_name: "Коммерсантъ",
    source_type: "editorial",
    base_url: "https://www.kommersant.ru/",
    requires_token: false,
    default_terms_status: "unchecked",
    terms_url: null,
    terms_checked_at: "2026-07-24",
    acceptance_queue: "second",
    automated_ingestion: false,
    app_rate_limit: "Disabled until editorial reuse terms are checked",
    production_access: "Second queue editorial context only after licensing/terms review.",
    trust_level: "editorial",
    stores_full_text: false,
    notes: "Editorial source candidate; use citations and short excerpts only after review.",
  },
  {
    source_code: "issuer_ir",
    source_name: "Issuer IR pages",
    source_type: "issuer_ir",
    base_url: null,
    requires_token: false,
    default_terms_status: "unchecked",
    terms_url: null,
    terms_checked_at: "2026-07-24",
    acceptance_queue: "second",
    automated_ingestion: false,
    app_rate_limit: "Disabled until per-issuer robots/terms are checked",
    production_access: "Second queue for top portfolio positions with per-issuer allowlist.",
    trust_level: "primary",
    stores_full_text: false,
    notes: "Issuer-specific IR pages need per-domain access checks before ingestion.",
  },
];

export function firstAcceptanceSourceDefinitions(registry = stage7SourceRegistry) {
  return registry.filter((source) => source.acceptance_queue === "first");
}

export function secondQueueSourceDefinitions(registry = stage7SourceRegistry) {
  return registry.filter((source) => source.acceptance_queue === "second");
}

function trimToNull(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeTicker(value: string | null | undefined) {
  return trimToNull(value)?.toUpperCase() ?? null;
}

function normalizeIsin(value: string | null | undefined) {
  return trimToNull(value)?.replace(/\s+/g, "").toUpperCase() ?? null;
}

function normalizeLanguage(value: string | null | undefined) {
  const normalized = trimToNull(value)?.toLowerCase() ?? "ru";
  return /^[a-z]{2,8}(-[a-z]{2})?$/.test(normalized) ? normalized : "ru";
}

function normalizeDocumentType(value: string | null | undefined) {
  const normalized = trimToNull(value)?.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized && /^[a-z][a-z0-9_]{1,80}$/.test(normalized) ? normalized : "news";
}

export function sourceDefinitionByCode(sourceCode: string, registry = stage7SourceRegistry) {
  return registry.find((source) => source.source_code === sourceCode) ?? null;
}

export function buildSourceDocumentHash(input: {
  sourceCode: string;
  externalId?: string | null;
  url?: string | null;
  title: string;
  publishedAt?: string | null;
  rawExcerpt?: string | null;
}) {
  const stable = [
    input.sourceCode,
    trimToNull(input.externalId) ?? "",
    trimToNull(input.url)?.toLowerCase() ?? "",
    input.title.trim().replace(/\s+/g, " "),
    trimToNull(input.publishedAt) ?? "",
    trimToNull(input.rawExcerpt)?.replace(/\s+/g, " ").slice(0, 2000) ?? "",
  ].join("\n");

  return createHash("sha256").update(stable).digest("hex");
}

export function normalizeSourceDocumentCandidate(candidate: SourceDocumentCandidate, registry = stage7SourceRegistry): NormalizedSourceDocument {
  const source = sourceDefinitionByCode(candidate.sourceCode, registry);
  const title = candidate.title.trim().replace(/\s+/g, " ");
  const trustLevel = candidate.trustLevel ?? source?.trust_level ?? "manual";
  const normalized = {
    sourceCode: candidate.sourceCode,
    externalId: trimToNull(candidate.externalId),
    url: trimToNull(candidate.url),
    title,
    publishedAt: trimToNull(candidate.publishedAt),
    issuerName: trimToNull(candidate.issuerName),
    ticker: normalizeTicker(candidate.ticker),
    isin: normalizeIsin(candidate.isin),
    language: normalizeLanguage(candidate.language),
    documentType: normalizeDocumentType(candidate.documentType),
    trustLevel,
    rawExcerpt: trimToNull(candidate.rawExcerpt),
    contentHash: "",
    payload: candidate.payload ?? {},
  };

  return {
    ...normalized,
    contentHash: buildSourceDocumentHash({
      sourceCode: normalized.sourceCode,
      externalId: normalized.externalId,
      url: normalized.url,
      title: normalized.title,
      publishedAt: normalized.publishedAt,
      rawExcerpt: normalized.rawExcerpt,
    }),
  };
}

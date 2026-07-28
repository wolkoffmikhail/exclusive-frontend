import { normalizeSourceDocumentCandidate, type NormalizedSourceDocument, type SourceDocumentTrustLevel } from "../../portfolio/news-sources";
import type { SourceIngestionAdapter } from "./runner";

export type ForeignInsightSourceCode =
  | "sec_edgar"
  | "fed_press"
  | "fed_feds_notes"
  | "ecb_press"
  | "ecb_blog"
  | "bis_research";

type ForeignFeedDefinition = {
  sourceCode: ForeignInsightSourceCode;
  sourceName: string;
  feedUrl: string;
  documentType: string;
  trustLevel: SourceDocumentTrustLevel;
  userAgent?: string;
  mapDocument?: (document: ParsedFeedDocument) => ParsedFeedDocument;
};

type ParsedFeedDocument = {
  externalId: string;
  url: string | null;
  title: string;
  publishedAt: string | null;
  rawExcerpt: string | null;
  documentType: string;
  category: string | null;
  issuerName?: string | null;
};

export const defaultForeignInsightLimit = 10;
const defaultUserAgent = "investment-portfolio-stage7/1.0";

export const foreignInsightFeedDefinitions: ForeignFeedDefinition[] = [
  {
    sourceCode: "sec_edgar",
    sourceName: "SEC EDGAR",
    feedUrl: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&count=40&output=atom",
    documentType: "issuer_filing",
    trustLevel: "primary",
    mapDocument: (document) => ({
      ...document,
      documentType: document.category ? `sec_${document.category.toLowerCase().replace(/[^a-z0-9_]+/g, "_")}` : "issuer_filing",
      issuerName: issuerNameFromSecTitle(document.title),
    }),
  },
  {
    sourceCode: "fed_press",
    sourceName: "Federal Reserve",
    feedUrl: "https://www.federalreserve.gov/feeds/press_all.xml",
    documentType: "press_release",
    trustLevel: "primary",
  },
  {
    sourceCode: "fed_feds_notes",
    sourceName: "Federal Reserve FEDS Notes",
    feedUrl: "https://www.federalreserve.gov/feeds/feds_notes.xml",
    documentType: "research_note",
    trustLevel: "primary",
  },
  {
    sourceCode: "ecb_press",
    sourceName: "European Central Bank",
    feedUrl: "https://www.ecb.europa.eu/rss/press.html",
    documentType: "press_release",
    trustLevel: "primary",
  },
  {
    sourceCode: "ecb_blog",
    sourceName: "ECB Blog",
    feedUrl: "https://www.ecb.europa.eu/rss/blog.html",
    documentType: "insight",
    trustLevel: "primary",
  },
  {
    sourceCode: "bis_research",
    sourceName: "BIS Research Hub",
    feedUrl: "https://www.bis.org/doclist/reshub_papers.rss",
    documentType: "research_paper",
    trustLevel: "reference",
  },
];

function normalizeCharset(value: string | null) {
  const normalized = value?.trim().replace(/^["']|["']$/g, "").toLowerCase() ?? "";
  if (normalized === "windows-1251" || normalized === "cp1251") return "windows-1251";
  if (normalized === "iso-8859-1" || normalized === "latin1") return "iso-8859-1";
  if (normalized === "utf-8" || normalized === "utf8") return "utf-8";
  return null;
}

function charsetFromContentType(value: string | null) {
  const match = /charset\s*=\s*([^;\s]+)/i.exec(value ?? "");
  return normalizeCharset(match?.[1] ?? null);
}

function charsetFromXmlDeclaration(bytes: ArrayBuffer) {
  const prefix = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 512));
  const match = /<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(prefix);
  return normalizeCharset(match?.[1] ?? null);
}

async function decodeXmlResponse(response: Response) {
  const bytes = await response.arrayBuffer();
  const charset = charsetFromContentType(response.headers.get("content-type")) ?? charsetFromXmlDeclaration(bytes) ?? "utf-8";
  return new TextDecoder(charset).decode(bytes);
}

export function decodeFeedText(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&ndash;/gi, "-")
    .replace(/&mdash;/gi, "-")
    .replace(/&minus;/gi, "-")
    .replace(/&laquo;/gi, "\"")
    .replace(/&raquo;/gi, "\"")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textBetween(xml: string, tagName: string) {
  const match = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i").exec(xml);
  return match ? decodeFeedText(match[1]) : null;
}

function attribute(value: string, name: string) {
  const match = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(value);
  return match ? decodeFeedText(match[1]) : null;
}

function normalizeUrl(value: string | null, feedUrl: string) {
  if (!value) return null;
  try {
    return new URL(value, feedUrl).toString();
  } catch {
    return value;
  }
}

function normalizePubDate(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function externalIdForItem({ guid, link, publishedAt, title }: { guid: string | null; link: string | null; publishedAt: string | null; title: string }) {
  return guid || link || `${publishedAt ?? "undated"}:${title}`;
}

function categoryTerm(xml: string) {
  const categoryTag = /<category\b([^>]*)\/?>/i.exec(xml);
  const term = categoryTag ? attribute(categoryTag[1], "term") || attribute(categoryTag[1], "label") : null;
  return term || textBetween(xml, "category");
}

function atomLink(entry: string, feedUrl: string) {
  const links = Array.from(entry.matchAll(/<link\b([^>]*)\/?>/gi)).map((match) => match[1]);
  const alternate = links.find((link) => !attribute(link, "rel") || attribute(link, "rel") === "alternate") ?? links[0];
  return normalizeUrl(alternate ? attribute(alternate, "href") : null, feedUrl);
}

function parseRssItems(xml: string, definition: ForeignFeedDefinition, limit: number) {
  const items = Array.from(xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)).map((match) => match[1]);
  return items.slice(0, limit).map((item) => {
    const title = textBetween(item, "title");
    if (!title) return null;

    const link = normalizeUrl(textBetween(item, "link"), definition.feedUrl);
    const publishedAt = normalizePubDate(textBetween(item, "pubDate") ?? textBetween(item, "dc:date"));
    const category = categoryTerm(item);
    return {
      externalId: externalIdForItem({ guid: textBetween(item, "guid"), link, publishedAt, title }),
      url: link,
      title,
      publishedAt,
      rawExcerpt: textBetween(item, "description") ?? textBetween(item, "summary"),
      documentType: definition.documentType,
      category,
    };
  });
}

function parseAtomEntries(xml: string, definition: ForeignFeedDefinition, limit: number) {
  const entries = Array.from(xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)).map((match) => match[1]);
  return entries.slice(0, limit).map((entry) => {
    const title = textBetween(entry, "title");
    if (!title) return null;

    const link = atomLink(entry, definition.feedUrl);
    const publishedAt = normalizePubDate(textBetween(entry, "published") ?? textBetween(entry, "updated"));
    const category = categoryTerm(entry);
    return {
      externalId: externalIdForItem({ guid: textBetween(entry, "id"), link, publishedAt, title }),
      url: link,
      title,
      publishedAt,
      rawExcerpt: textBetween(entry, "summary") ?? textBetween(entry, "content"),
      documentType: definition.documentType,
      category,
    };
  });
}

function parseForeignFeed(xml: string, definition: ForeignFeedDefinition, limit: number) {
  const parsed = /<entry(?:\s[^>]*)?>/i.test(xml)
    ? parseAtomEntries(xml, definition, limit)
    : parseRssItems(xml, definition, limit);

  return parsed
    .filter((document): document is ParsedFeedDocument => Boolean(document))
    .map((document) => definition.mapDocument?.(document) ?? document)
    .map((document) => normalizeSourceDocumentCandidate({
      sourceCode: definition.sourceCode,
      externalId: document.externalId,
      url: document.url,
      title: document.title,
      publishedAt: document.publishedAt,
      issuerName: document.issuerName,
      language: "en",
      documentType: document.documentType,
      trustLevel: definition.trustLevel,
      rawExcerpt: document.rawExcerpt,
      payload: {
        provider: definition.sourceCode,
        feed_url: definition.feedUrl,
        source_name: definition.sourceName,
        category: document.category,
      },
    }));
}

function issuerNameFromSecTitle(title: string) {
  const match = /^[A-Z0-9/-]+\s+-\s+(.+?)\s+\(\d{7,10}\)/i.exec(title);
  return match?.[1]?.trim() ?? null;
}

export function parseForeignInsightFeed(xml: string, sourceCode: ForeignInsightSourceCode, limit = defaultForeignInsightLimit): NormalizedSourceDocument[] {
  const definition = foreignInsightFeedDefinitions.find((feed) => feed.sourceCode === sourceCode);
  if (!definition) throw new Error(`unknown_foreign_insight_source:${sourceCode}`);
  return parseForeignFeed(xml, definition, limit);
}

async function fetchForeignInsightFeed(definition: ForeignFeedDefinition, options: { fetchImpl: typeof fetch; limit: number; secUserAgent?: string }) {
  const response = await options.fetchImpl(definition.feedUrl, {
    headers: {
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
      "User-Agent": definition.sourceCode === "sec_edgar" ? options.secUserAgent || defaultUserAgent : definition.userAgent || defaultUserAgent,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`${definition.sourceCode}_feed_fetch_failed:${response.status}`);
  }

  const xml = await decodeXmlResponse(response);
  return parseForeignFeed(xml, definition, options.limit);
}

export function buildForeignInsightAdapters({
  fetchImpl = fetch,
  limit = defaultForeignInsightLimit,
  secUserAgent,
}: {
  fetchImpl?: typeof fetch;
  limit?: number;
  secUserAgent?: string;
} = {}): SourceIngestionAdapter[] {
  return foreignInsightFeedDefinitions.map((definition) => ({
    sourceCode: definition.sourceCode,
    fetchDocuments: () => fetchForeignInsightFeed(definition, { fetchImpl, limit, secUserAgent }),
  }));
}

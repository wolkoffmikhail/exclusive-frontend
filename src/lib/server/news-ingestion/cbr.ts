import { normalizeSourceDocumentCandidate, type NormalizedSourceDocument } from "../../portfolio/news-sources";

export const cbrRssPressUrl = "https://www.cbr.ru/rss/RssPress";
export const cbrSourceCode = "cbr";

type CbrRssParseOptions = {
  feedUrl?: string;
  limit?: number;
};

const cbrDefaultCharset = "windows-1251";

function normalizeCharset(value: string | null) {
  const normalized = value?.trim().replace(/^["']|["']$/g, "").toLowerCase() ?? "";
  if (normalized === "windows-1251" || normalized === "cp1251") return "windows-1251";
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

export async function decodeCbrRssResponse(response: Response) {
  const bytes = await response.arrayBuffer();
  const charset = charsetFromContentType(response.headers.get("content-type")) ?? charsetFromXmlDeclaration(bytes) ?? cbrDefaultCharset;
  return new TextDecoder(charset).decode(bytes);
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .trim();
}

function textBetween(xml: string, tagName: string) {
  const match = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i").exec(xml);
  return match ? decodeXmlEntities(match[1]).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : null;
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

export function parseCbrRssFeed(xml: string, options: CbrRssParseOptions = {}): NormalizedSourceDocument[] {
  const feedUrl = options.feedUrl ?? cbrRssPressUrl;
  const items = Array.from(xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)).map((match) => match[1]);
  const limitedItems = typeof options.limit === "number" ? items.slice(0, options.limit) : items;

  return limitedItems
    .map((item) => {
      const title = textBetween(item, "title");
      if (!title) return null;

      const link = normalizeUrl(textBetween(item, "link"), feedUrl);
      const guid = textBetween(item, "guid");
      const publishedAt = normalizePubDate(textBetween(item, "pubDate"));
      const description = textBetween(item, "description");

      return normalizeSourceDocumentCandidate({
        sourceCode: cbrSourceCode,
        externalId: externalIdForItem({ guid, link, publishedAt, title }),
        url: link,
        title,
        publishedAt,
        language: "ru",
        documentType: "press_release",
        trustLevel: "primary",
        rawExcerpt: description,
        payload: {
          provider: cbrSourceCode,
          feed_url: feedUrl,
          guid,
        },
      });
    })
    .filter((item): item is NormalizedSourceDocument => Boolean(item));
}

export async function fetchCbrRssFeed({ fetchImpl = fetch, limit }: { fetchImpl?: typeof fetch; limit?: number } = {}) {
  const response = await fetchImpl(cbrRssPressUrl, {
    headers: {
      Accept: "application/rss+xml, application/xml, text/xml",
      "User-Agent": "investment-portfolio-stage7/1.0",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`cbr_rss_fetch_failed:${response.status}`);
  }

  const xml = await decodeCbrRssResponse(response);
  return parseCbrRssFeed(xml, { feedUrl: cbrRssPressUrl, limit });
}

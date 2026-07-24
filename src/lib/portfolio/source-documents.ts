import { linkSourceDocumentToAssets, type IssuerAlias, type LinkableAsset, type SourceDocumentAssetLinkCandidate } from "./news-linking";
import { normalizeSourceDocumentCandidate, type NormalizedSourceDocument, type SourceDocumentCandidate } from "./news-sources";

export type ManualSourceDocumentImportInput = {
  familyId: string;
  title: string;
  url?: string | null;
  rawExcerpt?: string | null;
  publishedAt?: string | null;
  issuerName?: string | null;
  ticker?: string | null;
  isin?: string | null;
  externalId?: string | null;
  documentType?: string | null;
};

export type ManualSourceDocumentImportPlan = {
  sourceCode: "manual";
  document: NormalizedSourceDocument;
  links: SourceDocumentAssetLinkCandidate[];
};

function normalizePublishedAt(value: string | null | undefined) {
  const raw = value?.trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function buildLinkableDocument({
  document,
  familyId,
  sourceDocumentId,
}: {
  document: NormalizedSourceDocument;
  familyId: string;
  sourceDocumentId: string;
}) {
  return {
    id: sourceDocumentId,
    family_id: familyId,
    title: document.title,
    issuer_name: document.issuerName,
    ticker: document.ticker,
    isin: document.isin,
    raw_excerpt: document.rawExcerpt,
  };
}

export function buildManualSourceDocumentImportPlan({
  aliases = [],
  assets,
  input,
  sourceDocumentId = "pending-source-document",
}: {
  input: ManualSourceDocumentImportInput;
  assets: LinkableAsset[];
  aliases?: IssuerAlias[];
  sourceDocumentId?: string;
}): ManualSourceDocumentImportPlan {
  const candidate: SourceDocumentCandidate = {
    sourceCode: "manual",
    externalId: input.externalId,
    url: input.url,
    title: input.title,
    publishedAt: normalizePublishedAt(input.publishedAt),
    issuerName: input.issuerName,
    ticker: input.ticker,
    isin: input.isin,
    language: "ru",
    documentType: input.documentType,
    trustLevel: "manual",
    rawExcerpt: input.rawExcerpt,
    payload: {
      imported_by: "manual_stage_7",
    },
  };
  const document = normalizeSourceDocumentCandidate(candidate);
  const links = linkSourceDocumentToAssets({
    aliases,
    assets,
    document: buildLinkableDocument({
      document,
      familyId: input.familyId,
      sourceDocumentId,
    }),
  });

  return {
    sourceCode: "manual",
    document,
    links,
  };
}

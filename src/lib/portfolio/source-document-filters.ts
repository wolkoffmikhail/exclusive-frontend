import type { LlmAnalysis, SourceDocument, SourceDocumentLink } from "./data";

export type LinkedSourceDocument = {
  document: SourceDocument;
  links: SourceDocumentLink[];
  latestAnalysis: LlmAnalysis | null;
};

type SourceDocumentsForAssetInput = {
  assetId: string;
  documents: SourceDocument[];
  links: SourceDocumentLink[];
  analyses?: LlmAnalysis[];
  includeRejected?: boolean;
  limit?: number;
};

function timestamp(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function linkRank(link: SourceDocumentLink) {
  const statusRank = link.status === "confirmed" ? 2 : link.status === "suggested" ? 1 : 0;
  const confidence = Number(link.confidence);
  return statusRank * 10 + (Number.isFinite(confidence) ? confidence : 0);
}

export function sourceDocumentsForAsset({
  assetId,
  documents,
  links,
  analyses = [],
  includeRejected = false,
  limit,
}: SourceDocumentsForAssetInput): LinkedSourceDocument[] {
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  const linksByDocumentId = new Map<string, SourceDocumentLink[]>();

  for (const link of links) {
    if (link.asset_id !== assetId) continue;
    if (!includeRejected && link.status === "rejected") continue;
    if (!documentsById.has(link.source_document_id)) continue;

    const documentLinks = linksByDocumentId.get(link.source_document_id) ?? [];
    documentLinks.push(link);
    linksByDocumentId.set(link.source_document_id, documentLinks);
  }

  const latestAnalysisByDocumentId = new Map<string, LlmAnalysis>();
  for (const analysis of analyses) {
    if (!analysis.source_document_id) continue;
    const current = latestAnalysisByDocumentId.get(analysis.source_document_id);
    if (!current || timestamp(analysis.created_at) >= timestamp(current.created_at)) {
      latestAnalysisByDocumentId.set(analysis.source_document_id, analysis);
    }
  }

  const linkedDocuments = Array.from(linksByDocumentId.entries())
    .map(([documentId, documentLinks]) => {
      const document = documentsById.get(documentId);
      if (!document) return null;

      return {
        document,
        links: documentLinks.sort((left, right) => linkRank(right) - linkRank(left)),
        latestAnalysis: latestAnalysisByDocumentId.get(documentId) ?? null,
      };
    })
    .filter((item): item is LinkedSourceDocument => Boolean(item))
    .sort((left, right) => {
      const leftTime = timestamp(left.document.published_at ?? left.document.created_at);
      const rightTime = timestamp(right.document.published_at ?? right.document.created_at);
      return rightTime - leftTime || left.document.title.localeCompare(right.document.title);
    });

  return typeof limit === "number" ? linkedDocuments.slice(0, limit) : linkedDocuments;
}

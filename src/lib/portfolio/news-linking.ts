export type LinkableAsset = {
  id: string;
  family_id: string;
  name: string;
  ticker: string | null;
  isin: string | null;
  market?: string | null;
};

export type LinkableSourceDocument = {
  id: string;
  family_id: string;
  title: string;
  issuer_name: string | null;
  ticker: string | null;
  isin: string | null;
  raw_excerpt?: string | null;
};

export type IssuerAlias = {
  asset_id: string;
  alias: string;
  confidence: number | string;
  status: string;
};

export type SourceDocumentAssetLinkCandidate = {
  family_id: string;
  source_document_id: string;
  asset_id: string;
  link_type: "ticker" | "isin" | "issuer_alias";
  confidence: number;
  status: "suggested";
  evidence: {
    matched_value: string;
    matched_field: string;
    reason: string;
  };
};

export type SourceDocumentLinkStatus = "suggested" | "confirmed" | "rejected";

export type SourceDocumentLinkStatusUpdate = {
  status: SourceDocumentLinkStatus;
  updatedBy: string;
};

function normalizeToken(value: string | null | undefined) {
  return value?.trim().toUpperCase().replace(/\s+/g, "") ?? "";
}

function normalizeText(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase("ru").replace(/\s+/g, " ") ?? "";
}

function numericConfidence(value: number | string) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
}

function documentText(document: LinkableSourceDocument) {
  return normalizeText([
    document.title,
    document.issuer_name ?? "",
    document.raw_excerpt ?? "",
  ].join(" "));
}

function pushBestCandidate(
  candidates: Map<string, SourceDocumentAssetLinkCandidate>,
  candidate: SourceDocumentAssetLinkCandidate,
) {
  const existing = candidates.get(candidate.asset_id);
  if (!existing || candidate.confidence > existing.confidence) {
    candidates.set(candidate.asset_id, candidate);
  }
}

export function linkSourceDocumentToAssets({
  aliases = [],
  assets,
  document,
}: {
  document: LinkableSourceDocument;
  assets: LinkableAsset[];
  aliases?: IssuerAlias[];
}): SourceDocumentAssetLinkCandidate[] {
  const candidates = new Map<string, SourceDocumentAssetLinkCandidate>();
  const docTicker = normalizeToken(document.ticker);
  const docIsin = normalizeToken(document.isin);
  const text = documentText(document);

  for (const asset of assets.filter((item) => item.family_id === document.family_id)) {
    const assetTicker = normalizeToken(asset.ticker);
    const assetIsin = normalizeToken(asset.isin);

    if (docIsin && assetIsin && docIsin === assetIsin) {
      pushBestCandidate(candidates, {
        family_id: document.family_id,
        source_document_id: document.id,
        asset_id: asset.id,
        link_type: "isin",
        confidence: 0.98,
        status: "suggested",
        evidence: {
          matched_value: assetIsin,
          matched_field: "isin",
          reason: "document_isin_matches_asset_isin",
        },
      });
      continue;
    }

    if (docTicker && assetTicker && docTicker === assetTicker) {
      pushBestCandidate(candidates, {
        family_id: document.family_id,
        source_document_id: document.id,
        asset_id: asset.id,
        link_type: "ticker",
        confidence: 0.9,
        status: "suggested",
        evidence: {
          matched_value: assetTicker,
          matched_field: "ticker",
          reason: "document_ticker_matches_asset_ticker",
        },
      });
      continue;
    }

    if (assetTicker && new RegExp(`(^|[^A-Z0-9])${assetTicker}([^A-Z0-9]|$)`, "i").test(document.title)) {
      pushBestCandidate(candidates, {
        family_id: document.family_id,
        source_document_id: document.id,
        asset_id: asset.id,
        link_type: "ticker",
        confidence: 0.74,
        status: "suggested",
        evidence: {
          matched_value: assetTicker,
          matched_field: "title",
          reason: "ticker_found_in_document_title",
        },
      });
    }
  }

  for (const alias of aliases.filter((item) => item.status === "active")) {
    const asset = assets.find((item) => item.id === alias.asset_id && item.family_id === document.family_id);
    if (!asset) continue;

    const normalizedAlias = normalizeText(alias.alias);
    if (!normalizedAlias || !text.includes(normalizedAlias)) continue;

    pushBestCandidate(candidates, {
      family_id: document.family_id,
      source_document_id: document.id,
      asset_id: asset.id,
      link_type: "issuer_alias",
      confidence: Math.min(0.88, 0.55 + numericConfidence(alias.confidence) * 0.3),
      status: "suggested",
      evidence: {
        matched_value: alias.alias,
        matched_field: "title_or_excerpt",
        reason: "issuer_alias_found_in_document_text",
      },
    });
  }

  return Array.from(candidates.values()).sort((left, right) => right.confidence - left.confidence);
}

export function buildSourceDocumentLinkStatusUpdate({
  status,
  updatedBy,
}: {
  status: string;
  updatedBy: string;
}): SourceDocumentLinkStatusUpdate | null {
  if (status !== "confirmed" && status !== "rejected" && status !== "suggested") return null;
  if (!updatedBy) return null;

  return {
    status,
    updatedBy,
  };
}

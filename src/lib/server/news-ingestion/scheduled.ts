import type { SupabaseClient } from "@supabase/supabase-js";
import { sourceDefinitionByCode, type NormalizedSourceDocument } from "../../portfolio/news-sources";
import { buildMoexAliasRowsForAsset, fetchMoexSecurityReference, moexIssBaseUrl, type MoexSecurityReference } from "./moex";
import { cbrRssPressUrl, cbrSourceCode, fetchCbrRssFeed } from "./cbr";
import { runSourceIngestion, sourceIngestionErrorSummary } from "./runner";

export type ScheduledNewsSourceCode = "cbr" | "moex_iss";

type SourceDocumentDuplicate = {
  id: string;
  match: "content_hash" | "external_id";
};

export type ScheduledNewsIngestionStore = {
  listFamilies: (options: { limit: number }) => Promise<Array<{ id: string }>>;
  ensureNewsSource: (input: { familyId: string; sourceCode: ScheduledNewsSourceCode }) => Promise<string>;
  findSourceDocumentDuplicate: (input: {
    familyId: string;
    sourceId: string;
    externalId: string | null;
    contentHash: string | null;
  }) => Promise<SourceDocumentDuplicate | null>;
  insertSourceDocument: (input: {
    familyId: string;
    sourceId: string;
    document: NormalizedSourceDocument;
  }) => Promise<string>;
  updateSourceDocument: (input: {
    familyId: string;
    sourceId: string;
    documentId: string;
    document: NormalizedSourceDocument;
  }) => Promise<void>;
  updateNewsSourceRun: (input: {
    familyId: string;
    sourceId: string;
    status: "active" | "failed";
    lastSuccessAt: string | null;
    lastError: string | null;
  }) => Promise<void>;
  listAssetsForAliasSync: (input: { familyId: string; limit: number }) => Promise<Array<{
    id: string;
    ticker: string | null;
    isin: string | null;
    name: string;
  }>>;
  listExistingAliases: (input: { familyId: string; assetId: string }) => Promise<string[]>;
  insertIssuerAliases: (input: {
    familyId: string;
    rows: Array<{ asset_id: string; alias: string; source: "moex"; confidence: number; status: "active" }>;
  }) => Promise<void>;
  addAudit: (input: {
    familyId: string;
    action: string;
    entityTable: string;
    entityId: string | null;
    afterData: Record<string, unknown>;
  }) => Promise<void>;
};

export type ScheduledNewsIngestionOptions = {
  cbrLimit?: number;
  familyIds?: string[];
  familyLimit?: number;
  now?: Date;
  syncMoexAliases?: boolean;
  moexAssetLimit?: number;
  fetchCbrDocuments?: () => Promise<NormalizedSourceDocument[]>;
  fetchMoexReference?: (lookup: string) => Promise<MoexSecurityReference | null>;
};

export type ScheduledNewsIngestionFamilyResult = {
  familyId: string;
  cbr: {
    createdCount: number;
    updatedCount: number;
    skippedCount: number;
    fetchedCount: number;
    failedCount: number;
    error: string | null;
  };
  moexAliases: {
    enabled: boolean;
    assetsChecked: number;
    createdCount: number;
    skippedCount: number;
    errorCount: number;
  };
};

export type ScheduledNewsIngestionSummary = {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  familyCount: number;
  cbrFetchedCount: number;
  cbrFailedCount: number;
  results: ScheduledNewsIngestionFamilyResult[];
};

function cleanFamilyIds(familyIds: string[] | undefined) {
  return Array.from(new Set((familyIds ?? []).map((id) => id.trim()).filter(Boolean)));
}

function positiveInteger(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function sourcePayload(sourceCode: ScheduledNewsSourceCode) {
  const definition = sourceDefinitionByCode(sourceCode);

  if (sourceCode === "cbr") {
    return {
      source_code: "cbr",
      source_name: definition?.source_name ?? "Bank of Russia",
      source_type: "regulator",
      base_url: "https://www.cbr.ru/",
      requires_token: false,
      terms_status: definition?.default_terms_status ?? "approved",
      terms_checked_at: definition?.terms_checked_at ?? null,
    };
  }

  return {
    source_code: "moex_iss",
    source_name: definition?.source_name ?? "MOEX ISS",
    source_type: "exchange_reference",
    base_url: moexIssBaseUrl,
    requires_token: false,
    terms_status: definition?.default_terms_status ?? "restricted",
    terms_checked_at: definition?.terms_checked_at ?? null,
  };
}

export function createSupabaseScheduledNewsIngestionStore(supabase: SupabaseClient): ScheduledNewsIngestionStore {
  return {
    async listFamilies({ limit }) {
      const { data, error } = await supabase
        .from("families")
        .select("id")
        .order("created_at", { ascending: true })
        .limit(limit);

      if (error) throw new Error(`families lookup failed: ${error.message}`);
      return (Array.isArray(data) ? data : []).map((family) => ({ id: String(family.id) }));
    },

    async ensureNewsSource({ familyId, sourceCode }) {
      const { data: existing, error: lookupError } = await supabase
        .from("news_sources")
        .select("id")
        .eq("family_id", familyId)
        .eq("source_code", sourceCode)
        .maybeSingle();

      if (lookupError) throw new Error(`${sourceCode} source lookup failed: ${lookupError.message}`);
      if (existing?.id) return String(existing.id);

      const payload = sourcePayload(sourceCode);
      const { data: created, error } = await supabase
        .from("news_sources")
        .insert({
          family_id: familyId,
          ...payload,
          status: "active",
          created_by: null,
          updated_by: null,
        })
        .select("id")
        .single();

      if (error || !created?.id) throw new Error(`${sourceCode} source insert failed: ${error?.message ?? "unknown"}`);
      return String(created.id);
    },

    async findSourceDocumentDuplicate({ familyId, sourceId, externalId, contentHash }) {
      if (contentHash) {
        const { data, error } = await supabase
          .from("source_documents")
          .select("id")
          .eq("family_id", familyId)
          .eq("content_hash", contentHash)
          .maybeSingle();

        if (error) throw new Error(`source document hash lookup failed: ${error.message}`);
        if (data?.id) return { id: String(data.id), match: "content_hash" };
      }

      if (externalId) {
        const { data, error } = await supabase
          .from("source_documents")
          .select("id")
          .eq("family_id", familyId)
          .eq("source_id", sourceId)
          .eq("external_id", externalId)
          .maybeSingle();

        if (error) throw new Error(`source document external lookup failed: ${error.message}`);
        if (data?.id) return { id: String(data.id), match: "external_id" };
      }

      return null;
    },

    async insertSourceDocument({ familyId, sourceId, document }) {
      const { data, error } = await supabase
        .from("source_documents")
        .insert({
          family_id: familyId,
          source_id: sourceId,
          external_id: document.externalId,
          url: document.url,
          title: document.title,
          published_at: document.publishedAt,
          issuer_name: document.issuerName,
          ticker: document.ticker,
          isin: document.isin,
          language: document.language,
          document_type: document.documentType,
          trust_level: document.trustLevel,
          raw_excerpt: document.rawExcerpt,
          content_hash: document.contentHash,
          payload: document.payload,
        })
        .select("id")
        .single();

      if (error || !data?.id) throw new Error(`source document insert failed: ${error?.message ?? "unknown"}`);
      return String(data.id);
    },

    async updateSourceDocument({ familyId, sourceId, documentId, document }) {
      const { error } = await supabase
        .from("source_documents")
        .update({
          url: document.url,
          title: document.title,
          published_at: document.publishedAt,
          issuer_name: document.issuerName,
          ticker: document.ticker,
          isin: document.isin,
          language: document.language,
          document_type: document.documentType,
          trust_level: document.trustLevel,
          raw_excerpt: document.rawExcerpt,
          content_hash: document.contentHash,
          payload: document.payload,
        })
        .eq("family_id", familyId)
        .eq("source_id", sourceId)
        .eq("id", documentId);

      if (error) throw new Error(`source document update failed: ${error.message}`);
    },

    async updateNewsSourceRun({ familyId, sourceId, status, lastSuccessAt, lastError }) {
      const { error } = await supabase
        .from("news_sources")
        .update({
          status,
          last_success_at: lastSuccessAt,
          last_error: lastError,
          updated_by: null,
        })
        .eq("family_id", familyId)
        .eq("id", sourceId);

      if (error) throw new Error(`news source run update failed: ${error.message}`);
    },

    async listAssetsForAliasSync({ familyId, limit }) {
      const { data, error } = await supabase
        .from("assets")
        .select("id, ticker, isin, name")
        .eq("family_id", familyId)
        .neq("status", "archived")
        .limit(limit);

      if (error) throw new Error(`assets lookup failed: ${error.message}`);
      return (Array.isArray(data) ? data : []).map((asset) => ({
        id: String(asset.id),
        ticker: asset.ticker as string | null,
        isin: asset.isin as string | null,
        name: String(asset.name),
      }));
    },

    async listExistingAliases({ familyId, assetId }) {
      const { data, error } = await supabase
        .from("issuer_aliases")
        .select("alias")
        .eq("family_id", familyId)
        .eq("asset_id", assetId);

      if (error) throw new Error(`issuer aliases lookup failed: ${error.message}`);
      return (Array.isArray(data) ? data : []).map((row) => String(row.alias));
    },

    async insertIssuerAliases({ familyId, rows }) {
      if (rows.length === 0) return;

      const { error } = await supabase
        .from("issuer_aliases")
        .insert(rows.map((row) => ({
          family_id: familyId,
          asset_id: row.asset_id,
          alias: row.alias,
          source: row.source,
          confidence: row.confidence,
          status: row.status,
          created_by: null,
          updated_by: null,
        })));

      if (error) throw new Error(`issuer aliases insert failed: ${error.message}`);
    },

    async addAudit({ familyId, action, entityTable, entityId, afterData }) {
      const { error } = await supabase.from("audit_log").insert({
        family_id: familyId,
        actor_user_id: null,
        action,
        entity_table: entityTable,
        entity_id: entityId,
        after_data: afterData,
      });

      if (error) throw new Error(`audit insert failed: ${error.message}`);
    },
  };
}

async function syncMoexAliasesForFamily({
  familyId,
  fetchMoexReference,
  moexAssetLimit,
  now,
  store,
}: {
  familyId: string;
  fetchMoexReference: (lookup: string) => Promise<MoexSecurityReference | null>;
  moexAssetLimit: number;
  now: string;
  store: ScheduledNewsIngestionStore;
}) {
  const sourceId = await store.ensureNewsSource({ familyId, sourceCode: "moex_iss" });
  const assets = await store.listAssetsForAliasSync({ familyId, limit: moexAssetLimit });
  let createdCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const asset of assets) {
    const lookup = String(asset.ticker ?? asset.isin ?? "").trim();
    if (!lookup) continue;

    try {
      const reference = await fetchMoexReference(lookup);
      if (!reference) {
        skippedCount += 1;
        continue;
      }

      const existing = new Set((await store.listExistingAliases({ familyId, assetId: asset.id })).map((alias) => alias.toLocaleLowerCase("ru")));
      const rows = buildMoexAliasRowsForAsset({ assetId: asset.id, reference })
        .filter((row) => !existing.has(row.alias.toLocaleLowerCase("ru")));

      await store.insertIssuerAliases({ familyId, rows });
      createdCount += rows.length;
      skippedCount += reference.aliases.length - rows.length;
    } catch {
      errorCount += 1;
    }
  }

  await store.updateNewsSourceRun({
    familyId,
    sourceId,
    status: errorCount > 0 && createdCount === 0 ? "failed" : "active",
    lastSuccessAt: createdCount > 0 ? now : null,
    lastError: errorCount > 0 ? `moex_alias_sync_errors:${errorCount}` : null,
  });

  await store.addAudit({
    familyId,
    action: "scheduled_sync_moex_issuer_aliases",
    entityTable: "news_sources",
    entityId: sourceId,
    afterData: {
      base_url: moexIssBaseUrl,
      assets_checked: assets.length,
      created_count: createdCount,
      skipped_count: skippedCount,
      error_count: errorCount,
    },
  });

  return {
    enabled: true,
    assetsChecked: assets.length,
    createdCount,
    skippedCount,
    errorCount,
  };
}

export async function runScheduledNewsIngestion(
  store: ScheduledNewsIngestionStore,
  options: ScheduledNewsIngestionOptions = {},
): Promise<ScheduledNewsIngestionSummary> {
  const startedAt = (options.now ?? new Date()).toISOString();
  const familyIds = cleanFamilyIds(options.familyIds);
  const families = familyIds.length > 0
    ? familyIds.map((id) => ({ id }))
    : await store.listFamilies({ limit: positiveInteger(options.familyLimit, 25) });

  if (families.length === 0) {
    return {
      ok: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      familyCount: 0,
      cbrFetchedCount: 0,
      cbrFailedCount: 0,
      results: [],
    };
  }

  const cbrLimit = positiveInteger(options.cbrLimit, 20);
  const cbrIngestion = await runSourceIngestion([
    {
      sourceCode: cbrSourceCode,
      fetchDocuments: options.fetchCbrDocuments ?? (() => fetchCbrRssFeed({ limit: cbrLimit })),
    },
  ]);
  const documents = cbrIngestion.results.flatMap((result) => result.documents);
  const cbrError = sourceIngestionErrorSummary(cbrIngestion) || null;
  const results: ScheduledNewsIngestionFamilyResult[] = [];

  for (const family of families) {
    const cbrSourceId = await store.ensureNewsSource({ familyId: family.id, sourceCode: "cbr" });
    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (const document of documents) {
      const duplicateId = await store.findSourceDocumentDuplicate({
        familyId: family.id,
        sourceId: cbrSourceId,
        externalId: document.externalId,
        contentHash: document.contentHash,
      });

      if (duplicateId) {
        if (duplicateId.match === "external_id") {
          try {
            await store.updateSourceDocument({
              familyId: family.id,
              sourceId: cbrSourceId,
              documentId: duplicateId.id,
              document,
            });
            updatedCount += 1;
            continue;
          } catch {
            skippedCount += 1;
            continue;
          }
        }

        skippedCount += 1;
        continue;
      }

      try {
        await store.insertSourceDocument({ familyId: family.id, sourceId: cbrSourceId, document });
        createdCount += 1;
      } catch {
        skippedCount += 1;
      }
    }

    await store.updateNewsSourceRun({
      familyId: family.id,
      sourceId: cbrSourceId,
      status: cbrIngestion.failedCount > 0 && createdCount === 0 && skippedCount === 0 ? "failed" : "active",
      lastSuccessAt: createdCount > 0 || updatedCount > 0 || skippedCount > 0 ? startedAt : null,
      lastError: cbrError,
    });

    await store.addAudit({
      familyId: family.id,
      action: "scheduled_ingest_cbr_rss",
      entityTable: "news_sources",
      entityId: cbrSourceId,
      afterData: {
        feed_url: cbrRssPressUrl,
        created_count: createdCount,
        updated_count: updatedCount,
        skipped_count: skippedCount,
        fetched_count: cbrIngestion.fetchedCount,
        failed_sources: cbrIngestion.failedCount,
        ingestion_error: cbrError,
      },
    });

    const moexAliases = options.syncMoexAliases
      ? await syncMoexAliasesForFamily({
        familyId: family.id,
        fetchMoexReference: options.fetchMoexReference ?? ((lookup) => fetchMoexSecurityReference({ secidOrIsin: lookup })),
        moexAssetLimit: positiveInteger(options.moexAssetLimit, 30),
        now: startedAt,
        store,
      })
      : {
        enabled: false,
        assetsChecked: 0,
        createdCount: 0,
        skippedCount: 0,
        errorCount: 0,
      };

    results.push({
      familyId: family.id,
      cbr: {
        createdCount,
        updatedCount,
        skippedCount,
        fetchedCount: cbrIngestion.fetchedCount,
        failedCount: cbrIngestion.failedCount,
        error: cbrError,
      },
      moexAliases,
    });
  }

  return {
    ok: cbrIngestion.failedCount === 0,
    startedAt,
    finishedAt: new Date().toISOString(),
    familyCount: families.length,
    cbrFetchedCount: cbrIngestion.fetchedCount,
    cbrFailedCount: cbrIngestion.failedCount,
    results,
  };
}

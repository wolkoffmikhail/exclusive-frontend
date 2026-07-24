"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { buildManualSourceDocumentImportPlan } from "@/lib/portfolio/source-documents";
import { buildSourceDocumentLinkStatusUpdate } from "@/lib/portfolio/news-linking";
import { sourceDefinitionByCode } from "@/lib/portfolio/news-sources";
import { canEditFamilyData } from "@/lib/portfolio/permissions";
import { getActiveFamily, getPortfolioData } from "@/lib/portfolio/data";
import { buildRecommendationExplanation, buildSourceDocumentAnalysis } from "@/lib/server/llm/document-analysis";
import { buildAdvisorPortfolioAnswer } from "@/lib/server/llm/portfolio-advisor";
import { buildAdvisorAssistantMessageInsert, buildAdvisorQuestionAuditPayload, buildAdvisorThreadInsert, buildAdvisorUserMessageInsert, buildLlmAnalysisInsert } from "@/lib/server/llm/persistence";
import { cbrRssPressUrl, fetchCbrRssFeed } from "@/lib/server/news-ingestion/cbr";
import { buildMoexAliasRowsForAsset, fetchMoexSecurityReference, moexIssBaseUrl } from "@/lib/server/news-ingestion/moex";
import { runSourceIngestion, sourceIngestionErrorSummary } from "@/lib/server/news-ingestion/runner";
import { createClient } from "@/lib/supabase/server";

type Stage7ReturnTo = "/news" | "/dashboard" | "/recommendations" | "/advisor";

function textField(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function optionalTextField(formData: FormData, name: string) {
  const value = textField(formData, name);
  return value || null;
}

function safeReturnTo(value: string | null | undefined, fallback: Stage7ReturnTo): Stage7ReturnTo {
  return value === "/news" || value === "/dashboard" || value === "/recommendations" || value === "/advisor" ? value : fallback;
}

function redirectWithStage7Error(code: string, returnTo: Stage7ReturnTo): never {
  redirect(`${returnTo}?stage7_error=${encodeURIComponent(code)}`);
}

function redirectWithStage7Saved(code: string, returnTo: Stage7ReturnTo): never {
  redirect(`${returnTo}?stage7_saved=${encodeURIComponent(code)}`);
}

async function getStage7Context(returnTo: Stage7ReturnTo) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/login");

  const family = await getActiveFamily(supabase, userId);
  if (!family) redirectWithStage7Error("no-family", returnTo);
  if (!canEditFamilyData(family.role)) redirectWithStage7Error("forbidden", returnTo);

  return { family, supabase, userId };
}

async function getStage7MemberContext(returnTo: Stage7ReturnTo) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/login");

  const family = await getActiveFamily(supabase, userId);
  if (!family) redirectWithStage7Error("no-family", returnTo);

  return { family, supabase, userId };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseOptionalAmount(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim().replace(",", ".");
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseJsonObject(value: string | null) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function ensureRecommendationFromForm({
  formData,
  returnTo,
}: {
  formData: FormData;
  returnTo: Stage7ReturnTo;
}) {
  const { family, supabase, userId } = await getStage7Context(returnTo);
  const recommendationId = textField(formData, "recommendation_id");
  const href = optionalTextField(formData, "href");
  const linkedAssetId = optionalTextField(formData, "linked_asset_id");

  if (isUuid(recommendationId)) {
    const { data: recommendation } = await supabase
      .from("recommendations")
      .select("id, title, body, reason, priority, recommendation_type, source, confidence, metrics")
      .eq("family_id", family.id)
      .eq("id", recommendationId)
      .maybeSingle();

    if (!recommendation?.id) redirectWithStage7Error("recommendation-not-found", returnTo);

    return {
      family,
      recommendation: {
        id: String(recommendation.id),
        title: String(recommendation.title),
        body: recommendation.body as string | null,
        reason: recommendation.reason as string | null,
        priority: String(recommendation.priority),
        recommendation_type: String(recommendation.recommendation_type),
        source: String(recommendation.source),
        confidence: recommendation.confidence as number | string | null,
        metrics: parseJsonObject(JSON.stringify(recommendation.metrics ?? {})),
        href,
        linkedAssetId,
      },
      supabase,
      userId,
    };
  }

  const fingerprint = textField(formData, "fingerprint");
  const title = textField(formData, "title");
  const body = optionalTextField(formData, "body");
  const reason = optionalTextField(formData, "reason");
  const priority = textField(formData, "priority") || "normal";
  const recommendationType = textField(formData, "recommendation_type") || "manual";
  const confidence = parseOptionalAmount(formData.get("confidence"));
  const metrics = parseJsonObject(optionalTextField(formData, "metrics"));

  if (!fingerprint || !title) redirectWithStage7Error("recommendation-generated-invalid", returnTo);

  const { data: existing } = await supabase
    .from("recommendations")
    .select("id, title, body, reason, priority, recommendation_type, source, confidence, metrics")
    .eq("family_id", family.id)
    .eq("fingerprint", fingerprint)
    .in("status", ["draft", "open"])
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    return {
      family,
      recommendation: {
        id: String(existing.id),
        title: String(existing.title),
        body: existing.body as string | null,
        reason: existing.reason as string | null,
        priority: String(existing.priority),
        recommendation_type: String(existing.recommendation_type),
        source: String(existing.source),
        confidence: existing.confidence as number | string | null,
        metrics: parseJsonObject(JSON.stringify(existing.metrics ?? metrics)),
        href,
        linkedAssetId,
      },
      supabase,
      userId,
    };
  }

  const { data: inserted, error } = await supabase
    .from("recommendations")
    .insert({
      family_id: family.id,
      title,
      body,
      reason,
      priority,
      recommendation_type: recommendationType,
      source: "rule_based",
      confidence,
      metrics,
      fingerprint,
      last_generated_at: new Date().toISOString(),
      created_by: userId,
      updated_by: userId,
    })
    .select("id, title, body, reason, priority, recommendation_type, source, confidence, metrics")
    .single();

  if (error || !inserted?.id) throw new Error(`recommendation insert failed: ${error?.message ?? "unknown"}`);

  await addAudit({
    supabase,
    familyId: family.id,
    userId,
    action: "persist_generated_recommendation_for_explanation",
    entityTable: "recommendations",
    entityId: inserted.id as string,
    afterData: { title, fingerprint, recommendation_type: recommendationType },
  });

  return {
    family,
    recommendation: {
      id: String(inserted.id),
      title: String(inserted.title),
      body: inserted.body as string | null,
      reason: inserted.reason as string | null,
      priority: String(inserted.priority),
      recommendation_type: String(inserted.recommendation_type),
      source: String(inserted.source),
      confidence: inserted.confidence as number | string | null,
      metrics: parseJsonObject(JSON.stringify(inserted.metrics ?? metrics)),
      href,
      linkedAssetId,
    },
    supabase,
    userId,
  };
}

async function ensureManualSource({
  familyId,
  supabase,
  userId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  familyId: string;
  userId: string;
}) {
  const { data: existingSource } = await supabase
    .from("news_sources")
    .select("id")
    .eq("family_id", familyId)
    .eq("source_code", "manual")
    .maybeSingle();

  if (existingSource?.id) return existingSource.id as string;
  const definition = sourceDefinitionByCode("manual");

  const { data: createdSource, error } = await supabase
    .from("news_sources")
    .insert({
      family_id: familyId,
      source_code: "manual",
      source_name: "Ручной импорт",
      source_type: "manual",
      base_url: null,
      status: "active",
      requires_token: false,
      terms_status: definition?.default_terms_status ?? "approved",
      terms_checked_at: definition?.terms_checked_at ?? null,
      created_by: userId,
      updated_by: userId,
    })
    .select("id")
    .single();

  if (error || !createdSource?.id) throw new Error(`manual source insert failed: ${error?.message ?? "unknown"}`);
  return createdSource.id as string;
}

async function ensureCbrSource({
  familyId,
  supabase,
  userId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  familyId: string;
  userId: string;
}) {
  const { data: existingSource } = await supabase
    .from("news_sources")
    .select("id")
    .eq("family_id", familyId)
    .eq("source_code", "cbr")
    .maybeSingle();

  if (existingSource?.id) return existingSource.id as string;
  const definition = sourceDefinitionByCode("cbr");

  const { data: createdSource, error } = await supabase
    .from("news_sources")
    .insert({
      family_id: familyId,
      source_code: "cbr",
      source_name: "Банк России",
      source_type: "regulator",
      base_url: "https://www.cbr.ru/",
      status: "active",
      requires_token: false,
      terms_status: definition?.default_terms_status ?? "unchecked",
      terms_checked_at: definition?.terms_checked_at ?? null,
      created_by: userId,
      updated_by: userId,
    })
    .select("id")
    .single();

  if (error || !createdSource?.id) throw new Error(`cbr source insert failed: ${error?.message ?? "unknown"}`);
  return createdSource.id as string;
}

async function ensureMoexSource({
  familyId,
  supabase,
  userId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  familyId: string;
  userId: string;
}) {
  const { data: existingSource } = await supabase
    .from("news_sources")
    .select("id")
    .eq("family_id", familyId)
    .eq("source_code", "moex_iss")
    .maybeSingle();

  if (existingSource?.id) return existingSource.id as string;
  const definition = sourceDefinitionByCode("moex_iss");

  const { data: createdSource, error } = await supabase
    .from("news_sources")
    .insert({
      family_id: familyId,
      source_code: "moex_iss",
      source_name: "MOEX ISS",
      source_type: "exchange_reference",
      base_url: moexIssBaseUrl,
      status: "active",
      requires_token: false,
      terms_status: definition?.default_terms_status ?? "unchecked",
      terms_checked_at: definition?.terms_checked_at ?? null,
      created_by: userId,
      updated_by: userId,
    })
    .select("id")
    .single();

  if (error || !createdSource?.id) throw new Error(`moex source insert failed: ${error?.message ?? "unknown"}`);
  return createdSource.id as string;
}

async function addAudit({
  action,
  afterData,
  entityId,
  entityTable,
  familyId,
  supabase,
  userId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  familyId: string;
  userId: string;
  action: string;
  entityTable: string;
  entityId: string | null;
  afterData: Record<string, unknown>;
}) {
  await supabase.from("audit_log").insert({
    family_id: familyId,
    actor_user_id: userId,
    action,
    entity_table: entityTable,
    entity_id: entityId,
    after_data: afterData,
  });
}

export async function createManualSourceDocument(formData: FormData) {
  const returnTo = safeReturnTo(textField(formData, "return_to"), "/news");
  const { family, supabase, userId } = await getStage7Context(returnTo);
  const title = textField(formData, "title");
  const rawExcerpt = optionalTextField(formData, "raw_excerpt");
  const url = optionalTextField(formData, "url");

  if (!title) redirectWithStage7Error("source-document-title-required", returnTo);
  if (!rawExcerpt && !url) redirectWithStage7Error("source-document-content-required", returnTo);

  const [{ data: assets }, { data: aliases }] = await Promise.all([
    supabase
      .from("assets")
      .select("id, family_id, name, ticker, isin, market")
      .eq("family_id", family.id)
      .neq("status", "archived"),
    supabase
      .from("issuer_aliases")
      .select("asset_id, alias, confidence, status")
      .eq("family_id", family.id)
      .eq("status", "active"),
  ]);

  const manualSourceId = await ensureManualSource({
    familyId: family.id,
    supabase,
    userId,
  });
  const plan = buildManualSourceDocumentImportPlan({
    input: {
      familyId: family.id,
      title,
      url,
      rawExcerpt,
      publishedAt: optionalTextField(formData, "published_at"),
      issuerName: optionalTextField(formData, "issuer_name"),
      ticker: optionalTextField(formData, "ticker"),
      isin: optionalTextField(formData, "isin"),
      externalId: optionalTextField(formData, "external_id"),
      documentType: optionalTextField(formData, "document_type"),
    },
    assets: Array.isArray(assets) ? assets : [],
    aliases: Array.isArray(aliases) ? aliases : [],
  });

  const { data: duplicateDocument } = await supabase
    .from("source_documents")
    .select("id")
    .eq("family_id", family.id)
    .eq("content_hash", plan.document.contentHash)
    .maybeSingle();

  let sourceDocumentId = duplicateDocument?.id as string | undefined;
  let created = false;

  if (!sourceDocumentId) {
    const { data: sourceDocument, error } = await supabase
      .from("source_documents")
      .insert({
        family_id: family.id,
        source_id: manualSourceId,
        external_id: plan.document.externalId,
        url: plan.document.url,
        title: plan.document.title,
        published_at: plan.document.publishedAt,
        issuer_name: plan.document.issuerName,
        ticker: plan.document.ticker,
        isin: plan.document.isin,
        language: plan.document.language,
        document_type: plan.document.documentType,
        trust_level: plan.document.trustLevel,
        raw_excerpt: plan.document.rawExcerpt,
        content_hash: plan.document.contentHash,
        payload: plan.document.payload,
      })
      .select("id")
      .single();

    if (error || !sourceDocument?.id) throw new Error(`source document insert failed: ${error?.message ?? "unknown"}`);
    sourceDocumentId = sourceDocument.id as string;
    created = true;
  }

  if (sourceDocumentId) {
    const linkRows = plan.links.map((link) => ({
      family_id: family.id,
      source_document_id: sourceDocumentId,
      asset_id: link.asset_id,
      link_type: link.link_type,
      confidence: link.confidence,
      status: link.status,
      evidence: link.evidence,
      created_by: userId,
      updated_by: userId,
    }));

    if (linkRows.length > 0) {
      await supabase
        .from("source_document_links")
        .upsert(linkRows, {
          onConflict: "family_id,source_document_id,asset_id,link_type",
        });
    }

    await addAudit({
      supabase,
      familyId: family.id,
      userId,
      action: created ? "create_source_document" : "reuse_source_document",
      entityTable: "source_documents",
      entityId: sourceDocumentId,
      afterData: {
        title: plan.document.title,
        source_code: plan.sourceCode,
        content_hash: plan.document.contentHash,
        linked_assets: linkRows.length,
        created,
      },
    });
  }

  revalidatePath("/news");
  revalidatePath("/dashboard");
  redirectWithStage7Saved(created ? "source-document" : "source-document-duplicate", returnTo);
}

export async function updateSourceDocumentLinkStatus(formData: FormData) {
  const returnTo = safeReturnTo(textField(formData, "return_to"), "/news");
  const { family, supabase, userId } = await getStage7Context(returnTo);
  const linkId = textField(formData, "source_document_link_id");
  const status = textField(formData, "status");
  const update = buildSourceDocumentLinkStatusUpdate({ status, updatedBy: userId });

  if (!linkId) redirectWithStage7Error("source-document-link-required", returnTo);
  if (!update) redirectWithStage7Error("source-document-link-status-invalid", returnTo);

  const { data: existingLink } = await supabase
    .from("source_document_links")
    .select("id, source_document_id, asset_id, link_type, status, confidence")
    .eq("family_id", family.id)
    .eq("id", linkId)
    .maybeSingle();

  if (!existingLink?.id) redirectWithStage7Error("source-document-link-not-found", returnTo);

  const { error } = await supabase
    .from("source_document_links")
    .update({
      status: update.status,
      updated_by: update.updatedBy,
    })
    .eq("family_id", family.id)
    .eq("id", linkId);

  if (error) throw new Error(`source document link status update failed: ${error.message}`);

  await addAudit({
    supabase,
    familyId: family.id,
    userId,
    action: "update_source_document_link_status",
    entityTable: "source_document_links",
    entityId: existingLink.id as string,
    afterData: {
      source_document_id: existingLink.source_document_id,
      asset_id: existingLink.asset_id,
      link_type: existingLink.link_type,
      previous_status: existingLink.status,
      status: update.status,
      confidence: existingLink.confidence,
    },
  });

  revalidatePath("/news");
  revalidatePath("/dashboard");
  redirectWithStage7Saved(`source-document-link-${update.status}`, returnTo);
}

export async function analyzeSourceDocument(formData: FormData) {
  const returnTo = safeReturnTo(textField(formData, "return_to"), "/news");
  const { family, supabase, userId } = await getStage7Context(returnTo);
  const sourceDocumentId = textField(formData, "source_document_id");

  if (!sourceDocumentId) redirectWithStage7Error("source-document-required", returnTo);

  const { data: sourceDocument } = await supabase
    .from("source_documents")
    .select("id, title, url, document_type, issuer_name, ticker, isin, published_at, raw_excerpt")
    .eq("family_id", family.id)
    .eq("id", sourceDocumentId)
    .maybeSingle();

  if (!sourceDocument?.id) redirectWithStage7Error("source-document-not-found", returnTo);

  const { data: links } = await supabase
    .from("source_document_links")
    .select("asset_id, status, confidence")
    .eq("family_id", family.id)
    .eq("source_document_id", sourceDocumentId)
    .neq("status", "rejected");

  const assetIds = Array.from(new Set((Array.isArray(links) ? links : []).map((link) => String(link.asset_id))));
  const { data: assets } = assetIds.length > 0
    ? await supabase
      .from("assets")
      .select("id, name, ticker")
      .eq("family_id", family.id)
      .in("id", assetIds)
    : { data: [] };
  const assetById = new Map((Array.isArray(assets) ? assets : []).map((asset) => [String(asset.id), asset]));
  const analysis = await buildSourceDocumentAnalysis({
    document: {
      id: String(sourceDocument.id),
      title: String(sourceDocument.title),
      url: sourceDocument.url as string | null,
      document_type: String(sourceDocument.document_type),
      issuer_name: sourceDocument.issuer_name as string | null,
      ticker: sourceDocument.ticker as string | null,
      isin: sourceDocument.isin as string | null,
      published_at: sourceDocument.published_at as string | null,
      raw_excerpt: sourceDocument.raw_excerpt as string | null,
    },
    links: (Array.isArray(links) ? links : []).map((link) => {
      const asset = assetById.get(String(link.asset_id));
      return {
        asset_id: String(link.asset_id),
        label: String(asset?.name ?? link.asset_id),
        ticker: (asset?.ticker as string | null | undefined) ?? null,
        status: String(link.status),
        confidence: link.confidence as number | string,
      };
    }),
  });

  const { data: insertedAnalysis, error } = await supabase
    .from("llm_analyses")
    .insert(buildLlmAnalysisInsert({ analysis, familyId: family.id, sourceDocumentId, userId }))
    .select("id")
    .single();

  if (error || !insertedAnalysis?.id) throw new Error(`source document analysis insert failed: ${error?.message ?? "unknown"}`);

  await addAudit({
    supabase,
    familyId: family.id,
    userId,
    action: "analyze_source_document",
    entityTable: "llm_analyses",
    entityId: insertedAnalysis.id as string,
    afterData: {
      source_document_id: sourceDocumentId,
      model: analysis.model,
      prompt_version: analysis.prompt_version,
      status: analysis.status,
      impact_level: analysis.impact_level,
      confidence: analysis.confidence,
      safety_flags: analysis.safety_flags,
    },
  });

  revalidatePath("/news");
  revalidatePath("/dashboard");
  redirectWithStage7Saved(analysis.status === "ready" ? "source-document-analysis" : "source-document-analysis-failed", returnTo);
}

export async function explainRecommendation(formData: FormData) {
  const returnTo = safeReturnTo(textField(formData, "return_to"), "/recommendations");
  const { family, recommendation, supabase, userId } = await ensureRecommendationFromForm({ formData, returnTo });
  const linkedAssetId = recommendation.linkedAssetId && isUuid(recommendation.linkedAssetId) ? recommendation.linkedAssetId : null;
  const { data: asset } = linkedAssetId
    ? await supabase
      .from("assets")
      .select("id, name, ticker")
      .eq("family_id", family.id)
      .eq("id", linkedAssetId)
      .maybeSingle()
    : { data: null };

  const { data: sourceDocumentLinks } = linkedAssetId
    ? await supabase
      .from("source_document_links")
      .select("source_document_id")
      .eq("family_id", family.id)
      .eq("asset_id", linkedAssetId)
      .neq("status", "rejected")
      .order("updated_at", { ascending: false })
      .limit(8)
    : { data: [] };
  const sourceDocumentIds = Array.from(new Set((Array.isArray(sourceDocumentLinks) ? sourceDocumentLinks : []).map((link) => String(link.source_document_id))));
  const { data: sourceDocuments } = sourceDocumentIds.length > 0
    ? await supabase
      .from("source_documents")
      .select("id, title, url, document_type, published_at, raw_excerpt")
      .eq("family_id", family.id)
      .in("id", sourceDocumentIds)
      .limit(8)
    : { data: [] };
  const analysis = await buildRecommendationExplanation({
    recommendation,
    asset: asset?.id ? {
      id: String(asset.id),
      name: String(asset.name),
      ticker: (asset.ticker as string | null | undefined) ?? null,
    } : null,
    linkedDocuments: (Array.isArray(sourceDocuments) ? sourceDocuments : []).map((document) => ({
      id: String(document.id),
      title: String(document.title),
      url: document.url as string | null,
      document_type: String(document.document_type),
      published_at: document.published_at as string | null,
      raw_excerpt: document.raw_excerpt as string | null,
    })),
  });

  const { data: insertedAnalysis, error } = await supabase
    .from("llm_analyses")
    .insert(buildLlmAnalysisInsert({ analysis, familyId: family.id, sourceDocumentId: null, userId }))
    .select("id")
    .single();

  if (error || !insertedAnalysis?.id) throw new Error(`recommendation explanation insert failed: ${error?.message ?? "unknown"}`);

  await addAudit({
    supabase,
    familyId: family.id,
    userId,
    action: "explain_recommendation",
    entityTable: "llm_analyses",
    entityId: insertedAnalysis.id as string,
    afterData: {
      recommendation_id: recommendation.id,
      linked_asset_id: linkedAssetId,
      source_document_count: sourceDocumentIds.length,
      model: analysis.model,
      prompt_version: analysis.prompt_version,
      status: analysis.status,
      impact_level: analysis.impact_level,
      confidence: analysis.confidence,
      safety_flags: analysis.safety_flags,
    },
  });

  revalidatePath("/recommendations");
  revalidatePath("/dashboard");
  redirectWithStage7Saved(analysis.status === "ready" ? "recommendation-explanation" : "recommendation-explanation-failed", returnTo);
}

export async function ingestCbrRss(formData: FormData) {
  const returnTo = safeReturnTo(textField(formData, "return_to"), "/news");
  const { family, supabase, userId } = await getStage7Context(returnTo);
  const cbrSourceId = await ensureCbrSource({
    familyId: family.id,
    supabase,
    userId,
  });

  const ingestion = await runSourceIngestion([
    {
      sourceCode: "cbr",
      fetchDocuments: () => fetchCbrRssFeed({ limit: 20 }),
    },
  ]);
  const documents = ingestion.results.flatMap((result) => result.documents);
  const ingestionError = sourceIngestionErrorSummary(ingestion) || null;

  let createdCount = 0;
  let skippedCount = 0;

  for (const document of documents) {
    const { data: duplicateDocument } = await supabase
      .from("source_documents")
      .select("id")
      .eq("family_id", family.id)
      .eq("content_hash", document.contentHash)
      .maybeSingle();

    if (duplicateDocument?.id) {
      skippedCount += 1;
      continue;
    }

    const { error } = await supabase
      .from("source_documents")
      .insert({
        family_id: family.id,
        source_id: cbrSourceId,
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
      });

    if (error) {
      skippedCount += 1;
      continue;
    }

    createdCount += 1;
  }

  await supabase
    .from("news_sources")
    .update({
      status: ingestion.failedCount > 0 && createdCount === 0 ? "failed" : "active",
      last_success_at: createdCount > 0 || skippedCount > 0 ? new Date().toISOString() : null,
      last_error: ingestionError,
      updated_by: userId,
    })
    .eq("family_id", family.id)
    .eq("id", cbrSourceId);

  await addAudit({
    supabase,
    familyId: family.id,
    userId,
    action: "ingest_cbr_rss",
    entityTable: "news_sources",
    entityId: cbrSourceId,
    afterData: {
      feed_url: cbrRssPressUrl,
      created_count: createdCount,
      skipped_count: skippedCount,
      fetched_count: ingestion.fetchedCount,
      failed_sources: ingestion.failedCount,
      ingestion_error: ingestionError,
    },
  });

  if (ingestion.failedCount > 0 && createdCount === 0 && skippedCount === 0) {
    redirectWithStage7Error("cbr-rss-fetch-failed", returnTo);
  }

  revalidatePath("/news");
  revalidatePath("/dashboard");
  redirectWithStage7Saved("cbr-rss", returnTo);
}

export async function syncMoexIssuerAliases(formData: FormData) {
  const returnTo = safeReturnTo(textField(formData, "return_to"), "/news");
  const { family, supabase, userId } = await getStage7Context(returnTo);
  const moexSourceId = await ensureMoexSource({
    familyId: family.id,
    supabase,
    userId,
  });
  const { data: assets } = await supabase
    .from("assets")
    .select("id, ticker, isin, name")
    .eq("family_id", family.id)
    .neq("status", "archived");
  const activeAssets = (Array.isArray(assets) ? assets : []).filter((asset) => asset.ticker || asset.isin).slice(0, 30);
  let createdCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const asset of activeAssets) {
    const lookup = String(asset.ticker ?? asset.isin ?? "").trim();
    if (!lookup) continue;

    try {
      const reference = await fetchMoexSecurityReference({ secidOrIsin: lookup });
      if (!reference) {
        skippedCount += 1;
        continue;
      }

      const rows = buildMoexAliasRowsForAsset({
        assetId: String(asset.id),
        reference,
      });
      const { data: existingAliases } = await supabase
        .from("issuer_aliases")
        .select("alias")
        .eq("family_id", family.id)
        .eq("asset_id", asset.id);
      const existingAliasKeys = new Set((Array.isArray(existingAliases) ? existingAliases : []).map((row) => String(row.alias).toLocaleLowerCase("ru")));
      const newRows = rows.filter((row) => !existingAliasKeys.has(row.alias.toLocaleLowerCase("ru")));

      if (newRows.length === 0) {
        skippedCount += rows.length;
        continue;
      }

      const { error } = await supabase
        .from("issuer_aliases")
        .insert(newRows.map((row) => ({
          family_id: family.id,
          asset_id: row.asset_id,
          alias: row.alias,
          source: row.source,
          confidence: row.confidence,
          status: row.status,
          created_by: userId,
          updated_by: userId,
        })));

      if (error) {
        errorCount += 1;
        continue;
      }

      createdCount += newRows.length;
      skippedCount += rows.length - newRows.length;
    } catch {
      errorCount += 1;
    }
  }

  await supabase
    .from("news_sources")
    .update({
      status: errorCount > 0 && createdCount === 0 ? "failed" : "active",
      last_success_at: createdCount > 0 ? new Date().toISOString() : null,
      last_error: errorCount > 0 ? `moex_alias_sync_errors:${errorCount}` : null,
      updated_by: userId,
    })
    .eq("family_id", family.id)
    .eq("id", moexSourceId);

  await addAudit({
    supabase,
    familyId: family.id,
    userId,
    action: "sync_moex_issuer_aliases",
    entityTable: "news_sources",
    entityId: moexSourceId,
    afterData: {
      base_url: moexIssBaseUrl,
      assets_checked: activeAssets.length,
      created_count: createdCount,
      skipped_count: skippedCount,
      error_count: errorCount,
    },
  });

  revalidatePath("/news");
  revalidatePath("/dashboard");
  redirectWithStage7Saved("moex-aliases", returnTo);
}

export async function askAdvisor(formData: FormData) {
  const returnTo = safeReturnTo(textField(formData, "return_to"), "/advisor");
  const { family, supabase, userId } = await getStage7MemberContext(returnTo);
  const question = textField(formData, "question").slice(0, 4000);
  const sourceDocumentId = optionalTextField(formData, "source_document_id");
  const requestedThreadId = optionalTextField(formData, "advisor_thread_id");

  if (question.length < 3) redirectWithStage7Error("advisor-question-required", returnTo);
  if (sourceDocumentId && !isUuid(sourceDocumentId)) redirectWithStage7Error("source-document-not-found", returnTo);

  let threadId = requestedThreadId && isUuid(requestedThreadId) ? requestedThreadId : null;
  if (threadId) {
    const { data: existingThread } = await supabase
      .from("advisor_threads")
      .select("id")
      .eq("family_id", family.id)
      .eq("id", threadId)
      .maybeSingle();
    if (!existingThread?.id) redirectWithStage7Error("advisor-thread-not-found", returnTo);
  } else {
    const { data: createdThread, error } = await supabase
      .from("advisor_threads")
      .insert(buildAdvisorThreadInsert({ familyId: family.id, question, sourceDocumentId, userId }))
      .select("id")
      .single();

    if (error || !createdThread?.id) throw new Error(`advisor thread insert failed: ${error?.message ?? "unknown"}`);
    threadId = createdThread.id as string;
  }

  const { error: userMessageError } = await supabase
    .from("advisor_messages")
    .insert(buildAdvisorUserMessageInsert({ familyId: family.id, question, sourceDocumentId, threadId }));

  if (userMessageError) throw new Error(`advisor user message insert failed: ${userMessageError.message}`);

  const { data: threadMessages } = await supabase
    .from("advisor_messages")
    .select("role, content, created_at")
    .eq("family_id", family.id)
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(80);
  const portfolioData = await getPortfolioData(supabase, family);
  const answer = await buildAdvisorPortfolioAnswer({
    data: portfolioData,
    messages: Array.isArray(threadMessages) ? threadMessages.map((message) => ({
      role: String(message.role),
      content: String(message.content),
      created_at: String(message.created_at),
    })) : [],
    question,
    sourceDocumentId,
  });

  const { error: assistantMessageError } = await supabase
    .from("advisor_messages")
    .insert(buildAdvisorAssistantMessageInsert({ answer, familyId: family.id, threadId }));

  if (assistantMessageError) throw new Error(`advisor assistant message insert failed: ${assistantMessageError.message}`);

  const { error: threadUpdateError } = await supabase
    .from("advisor_threads")
    .update({
      context_scope: sourceDocumentId ? { source_document_id: sourceDocumentId } : {},
      updated_at: new Date().toISOString(),
    })
    .eq("family_id", family.id)
    .eq("id", threadId);

  if (threadUpdateError) throw new Error(`advisor thread update failed: ${threadUpdateError.message}`);

  await addAudit({
    supabase,
    familyId: family.id,
    userId,
    action: "ask_advisor",
    entityTable: "advisor_threads",
    entityId: threadId,
    afterData: buildAdvisorQuestionAuditPayload({ answer, question, sourceDocumentId }),
  });

  revalidatePath("/advisor");
  redirect(`/advisor?advisor_thread_id=${encodeURIComponent(threadId)}&stage7_saved=advisor-message`);
}

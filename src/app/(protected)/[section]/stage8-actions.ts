"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { buildScenarioDraftInsert, scenarioDraftHref } from "@/lib/portfolio/scenario-drafts";
import { getActiveFamily, getPortfolioData } from "@/lib/portfolio/data";
import { canEditFamilyData } from "@/lib/portfolio/permissions";
import { runWhatIfScenario } from "@/lib/portfolio/scenarios";
import { createClient } from "@/lib/supabase/server";

function textField(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function optionalTextField(formData: FormData, name: string) {
  const value = textField(formData, name);
  return value || null;
}

function redirectWithStage8Error(code: string): never {
  redirect(`/what-if?stage8_error=${encodeURIComponent(code)}`);
}

async function getStage8Context() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/login");

  const family = await getActiveFamily(supabase, userId);
  if (!family) redirectWithStage8Error("no-family");
  if (!canEditFamilyData(family.role)) redirectWithStage8Error("forbidden");

  return { family, supabase, userId };
}

async function addAudit({
  action,
  afterData,
  entityId,
  familyId,
  supabase,
  userId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  familyId: string;
  userId: string;
  action: string;
  entityId: string | null;
  afterData: Record<string, unknown>;
}) {
  await supabase.from("audit_log").insert({
    family_id: familyId,
    actor_user_id: userId,
    action,
    entity_table: "scenario_drafts",
    entity_id: entityId,
    after_data: afterData,
  });
}

export async function saveScenarioDraft(formData: FormData) {
  const { family, supabase, userId } = await getStage8Context();
  const portfolioData = await getPortfolioData(supabase, family);
  const scenarioType = textField(formData, "scenario_type") === "sell" ? "sell" : "buy";
  const accountId = textField(formData, "account_id");
  const assetId = textField(formData, "asset_id");
  const tradeDate = textField(formData, "trade_date");
  const quantity = textField(formData, "quantity");
  const price = textField(formData, "price");
  const currencyCode = textField(formData, "currency_code");
  const commission = textField(formData, "commission");
  const sourceRecommendationId = optionalTextField(formData, "source_recommendation_id");

  const result = runWhatIfScenario({
    scenarioType,
    familyId: family.id,
    accountId,
    assetId,
    tradeDate,
    quantity,
    price,
    currencyCode,
    commission,
    sourceRecommendationId,
  }, {
    familyId: family.id,
    accounts: portfolioData.accounts,
    assets: portfolioData.assets,
    operations: portfolioData.operations,
    positionSnapshots: portfolioData.positionSnapshots,
    positions: portfolioData.positions,
    cashBalances: portfolioData.cashBalances,
    limits: portfolioData.limits,
    baseCurrency: family.baseCurrency,
  });

  if (!result.ok) redirectWithStage8Error(result.diagnostics[0]?.code ?? "scenario-invalid");

  const buildResult = buildScenarioDraftInsert({
    title: textField(formData, "title"),
    scenarioType,
    familyId: family.id,
    accountId,
    assetId,
    tradeDate,
    quantity,
    price,
    currencyCode,
    commission,
    sourceRecommendationId,
  }, userId, result);

  if (!buildResult.ok) redirectWithStage8Error(buildResult.error);

  const { data: inserted, error } = await supabase
    .from("scenario_drafts")
    .insert(buildResult.draft)
    .select("id")
    .single();

  if (error || !inserted?.id) redirectWithStage8Error("save-failed");

  const draftId = String(inserted.id);
  await addAudit({
    action: "scenario_draft.saved",
    afterData: {
      title: buildResult.draft.title,
      scenarioType: buildResult.draft.scenario_type,
      assetId: buildResult.draft.asset_id,
      accountId: buildResult.draft.account_id,
    },
    entityId: draftId,
    familyId: family.id,
    supabase,
    userId,
  });

  revalidatePath("/what-if");
  const href = scenarioDraftHref({ id: draftId, ...buildResult.draft });
  redirect(`${href}&stage8_saved=scenario-draft`);
}

export async function archiveScenarioDraft(formData: FormData) {
  const { family, supabase, userId } = await getStage8Context();
  const draftId = textField(formData, "scenario_draft_id");
  if (!draftId) redirectWithStage8Error("draft-required");

  const { error } = await supabase
    .from("scenario_drafts")
    .update({ status: "archived", updated_by: userId })
    .eq("family_id", family.id)
    .eq("id", draftId);

  if (error) redirectWithStage8Error("archive-failed");

  await addAudit({
    action: "scenario_draft.archived",
    afterData: { status: "archived" },
    entityId: draftId,
    familyId: family.id,
    supabase,
    userId,
  });

  revalidatePath("/what-if");
  redirect("/what-if?stage8_saved=scenario-draft-archived");
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActiveFamily, getPortfolioData } from "@/lib/portfolio/data";
import { createClient } from "@/lib/supabase/server";

function redirectWithPriceError(code: string): never {
  redirect(`/assets?price_error=${encodeURIComponent(code)}`);
}

function toPositiveNumber(value: FormDataEntryValue | null) {
  const parsed = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export async function saveManualPositionPrice(formData: FormData) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/login");

  const family = await getActiveFamily(supabase, userId);
  if (!family) redirectWithPriceError("no-family");
  if (family.role === "viewer") redirectWithPriceError("forbidden");

  const accountId = String(formData.get("account_id") ?? "");
  const assetId = String(formData.get("asset_id") ?? "");
  const currencyCode = String(formData.get("currency_code") ?? family.baseCurrency).toUpperCase();
  const marketPrice = toPositiveNumber(formData.get("market_price"));
  const snapshotDate = String(formData.get("snapshot_date") ?? todayIsoDate());

  if (!accountId || !assetId) redirectWithPriceError("position-required");
  if (!marketPrice) redirectWithPriceError("price-required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) redirectWithPriceError("date-required");

  const data = await getPortfolioData(supabase, family);
  const position = data.positions.find((item) => (
    item.account_id === accountId
    && item.asset_id === assetId
    && item.currency_code === currencyCode
  ));

  if (!position?.asset_id) redirectWithPriceError("position-not-found");

  const marketValue = position.quantity * marketPrice;

  const { data: snapshot, error } = await supabase
    .from("position_snapshots")
    .upsert(
      {
        family_id: family.id,
        portfolio_id: position.portfolio_id,
        account_id: position.account_id,
        asset_id: position.asset_id,
        snapshot_date: snapshotDate,
        quantity: position.quantity,
        book_value_amount: position.book_value,
        market_value_amount: marketValue,
        currency_code: position.currency_code,
        source: "manual",
        created_by: userId,
      },
      {
        onConflict: "family_id,portfolio_id,account_id,asset_id,snapshot_date,source",
      },
    )
    .select("id")
    .single();

  if (error || !snapshot?.id) {
    throw new Error(`Position snapshot save failed: ${error?.message ?? "unknown error"}`);
  }

  await supabase.from("audit_log").insert({
    family_id: family.id,
    actor_user_id: userId,
    action: "save_manual_position_price",
    entity_table: "position_snapshots",
    entity_id: snapshot.id,
    after_data: {
      account_id: position.account_id,
      asset_id: position.asset_id,
      snapshot_date: snapshotDate,
      quantity: position.quantity,
      market_price: marketPrice,
      market_value: marketValue,
      currency_code: position.currency_code,
    },
  });

  revalidatePath("/assets");
  revalidatePath("/dashboard");
  redirect("/assets?priced=1");
}

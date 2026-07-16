"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActiveFamily } from "@/lib/portfolio/data";
import { canEditFamilyData } from "@/lib/portfolio/permissions";
import { createClient } from "@/lib/supabase/server";

function redirectWithSettingsError(code: string): never {
  redirect(`/settings?settings_error=${encodeURIComponent(code)}`);
}

function textField(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function optionalTextField(formData: FormData, name: string) {
  const value = textField(formData, name);
  return value || null;
}

function normalizeCode(value: string) {
  return value.trim().toUpperCase();
}

export async function createPortfolio(formData: FormData) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/login");

  const family = await getActiveFamily(supabase, userId);
  if (!family) redirectWithSettingsError("no-family");
  if (!canEditFamilyData(family.role)) redirectWithSettingsError("forbidden");

  const name = textField(formData, "name");
  const baseCurrency = normalizeCode(textField(formData, "base_currency") || family.baseCurrency);
  const description = optionalTextField(formData, "description");

  if (!name) redirectWithSettingsError("portfolio-name-required");
  if (!/^[A-Z]{3}$/.test(baseCurrency)) redirectWithSettingsError("currency-invalid");

  const { data: portfolio, error } = await supabase
    .from("portfolios")
    .insert({
      family_id: family.id,
      name,
      base_currency: baseCurrency,
      description,
      created_by: userId,
      updated_by: userId,
    })
    .select("id")
    .single();

  if (error || !portfolio?.id) {
    throw new Error(`Portfolio creation failed: ${error?.message ?? "unknown error"}`);
  }

  await supabase.from("audit_log").insert({
    family_id: family.id,
    actor_user_id: userId,
    action: "create_portfolio",
    entity_table: "portfolios",
    entity_id: portfolio.id,
    after_data: {
      name,
      base_currency: baseCurrency,
    },
  });

  revalidatePath("/settings");
  revalidatePath("/accounts");
  redirect("/settings?settings_saved=portfolio");
}

export async function createAccount(formData: FormData) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/login");

  const family = await getActiveFamily(supabase, userId);
  if (!family) redirectWithSettingsError("no-family");
  if (!canEditFamilyData(family.role)) redirectWithSettingsError("forbidden");

  const portfolioId = textField(formData, "portfolio_id");
  const name = textField(formData, "name");
  const accountTypeCode = textField(formData, "account_type_code") || "brokerage";
  const institutionName = optionalTextField(formData, "institution_name");
  const currencyCode = normalizeCode(textField(formData, "currency_code") || family.baseCurrency);

  if (!portfolioId) redirectWithSettingsError("portfolio-required");
  if (!name) redirectWithSettingsError("account-name-required");
  if (!/^[A-Z]{3}$/.test(currencyCode)) redirectWithSettingsError("currency-invalid");

  const { data: portfolio } = await supabase
    .from("portfolios")
    .select("id")
    .eq("family_id", family.id)
    .eq("id", portfolioId)
    .maybeSingle();

  if (!portfolio) redirectWithSettingsError("portfolio-not-found");

  const { data: account, error } = await supabase
    .from("accounts")
    .insert({
      family_id: family.id,
      portfolio_id: portfolioId,
      account_type_code: accountTypeCode,
      name,
      institution_name: institutionName,
      currency_code: currencyCode,
      created_by: userId,
      updated_by: userId,
    })
    .select("id")
    .single();

  if (error || !account?.id) {
    throw new Error(`Account creation failed: ${error?.message ?? "unknown error"}`);
  }

  await supabase.from("audit_log").insert({
    family_id: family.id,
    actor_user_id: userId,
    action: "create_account",
    entity_table: "accounts",
    entity_id: account.id,
    after_data: {
      portfolio_id: portfolioId,
      account_type_code: accountTypeCode,
      name,
      institution_name: institutionName,
      currency_code: currencyCode,
    },
  });

  revalidatePath("/settings");
  revalidatePath("/accounts");
  revalidatePath("/import");
  redirect("/settings?settings_saved=account");
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActiveFamily, getPortfolioData } from "@/lib/portfolio/data";
import {
  buildManualCashTransferRecords,
  buildManualFxOperationRecords,
  buildManualOperationRecord,
  canCancelManualOperation,
  normalizeCurrencyCode,
  parseOptionalPositiveDecimal,
  parsePositiveDecimal,
  type ManualOperationType,
} from "@/lib/portfolio/manual-operations";
import { canEditFamilyData, canManageFamily } from "@/lib/portfolio/permissions";
import { createClient } from "@/lib/supabase/server";

function safeReturnTo(value: string) {
  if (value === "/assets" || value === "/dashboard") return value;
  return "/accounts";
}

function redirectWithOperationError(code: string, returnTo = "/accounts"): never {
  redirect(`${safeReturnTo(returnTo)}?operation_error=${encodeURIComponent(code)}`);
}

function textField(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function optionalTextField(formData: FormData, name: string) {
  const value = textField(formData, name);
  return value || null;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

async function createManualOperation(formData: FormData, operationType: ManualOperationType) {
  const returnTo = safeReturnTo(textField(formData, "return_to"));
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/login");

  const family = await getActiveFamily(supabase, userId);
  if (!family) redirectWithOperationError("no-family", returnTo);
  if (!canEditFamilyData(family.role)) redirectWithOperationError("forbidden", returnTo);

  const accountId = textField(formData, "account_id");
  if (!accountId) redirectWithOperationError("account-required", returnTo);

  const { data: account } = await supabase
    .from("accounts")
    .select("id, portfolio_id, currency_code")
    .eq("family_id", family.id)
    .eq("id", accountId)
    .maybeSingle();

  if (!account) redirectWithOperationError("account-not-found", returnTo);

  const assetId = optionalTextField(formData, "asset_id");
  if ((operationType === "buy" || operationType === "sell") && !assetId) {
    redirectWithOperationError("asset-required", returnTo);
  }

  if (assetId) {
    const { data: asset } = await supabase
      .from("assets")
      .select("id")
      .eq("family_id", family.id)
      .eq("id", assetId)
      .maybeSingle();

    if (!asset) redirectWithOperationError("asset-not-found", returnTo);
  }

  const tradeDate = textField(formData, "trade_date") || todayIsoDate();
  const settleDate = optionalTextField(formData, "settle_date");
  const currencyCode = normalizeCurrencyCode(textField(formData, "currency_code") || account.currency_code || family.baseCurrency);
  const amount = parsePositiveDecimal(formData.get("amount"));
  const quantity = parsePositiveDecimal(formData.get("quantity"));
  const price = parsePositiveDecimal(formData.get("price"));
  const feeAmount = parseOptionalPositiveDecimal(formData.get("fee_amount"));
  const taxAmount = parseOptionalPositiveDecimal(formData.get("tax_amount"));

  if (feeAmount === null || taxAmount === null) redirectWithOperationError("costs-invalid", returnTo);

  const portfolioData = await getPortfolioData(supabase, family);
  const result = buildManualOperationRecord(
    {
      operationType,
      familyId: family.id,
      portfolioId: account.portfolio_id,
      accountId,
      assetId,
      tradeDate,
      settleDate,
      quantity,
      price,
      amount,
      feeAmount,
      taxAmount,
      currencyCode,
      notes: optionalTextField(formData, "notes"),
      userId,
    },
    {
      cashBalances: portfolioData.cashBalances,
      positions: portfolioData.positions,
    },
  );

  if (!result.ok) redirectWithOperationError(result.code, returnTo);

  const { data: operation, error } = await supabase
    .from("operations")
    .insert(result.record)
    .select("id")
    .single();

  if (error || !operation?.id) {
    throw new Error(`Manual operation creation failed: ${error?.message ?? "unknown error"}`);
  }

  await supabase.from("audit_log").insert({
    family_id: family.id,
    actor_user_id: userId,
    action: "create_manual_operation",
    entity_table: "operations",
    entity_id: operation.id,
    after_data: {
      family_id: result.record.family_id,
      portfolio_id: result.record.portfolio_id,
      account_id: result.record.account_id,
      asset_id: result.record.asset_id,
      operation_type_code: result.record.operation_type_code,
      trade_date: result.record.trade_date,
      settle_date: result.record.settle_date,
      quantity: result.record.quantity,
      price: result.record.price,
      gross_amount: result.record.gross_amount,
      fee_amount: result.record.fee_amount,
      tax_amount: result.record.tax_amount,
      net_amount: result.record.net_amount,
      currency_code: result.record.currency_code,
      source: result.record.source,
      notes: result.record.notes,
    },
  });

  revalidatePath("/accounts");
  revalidatePath("/assets");
  revalidatePath("/dashboard");
  redirect(`${returnTo}?operation_saved=${operationType}`);
}

export async function createDepositOperation(formData: FormData) {
  await createManualOperation(formData, "deposit");
}

export async function createWithdrawalOperation(formData: FormData) {
  await createManualOperation(formData, "withdrawal");
}

export async function createBuyOperation(formData: FormData) {
  await createManualOperation(formData, "buy");
}

export async function createSellOperation(formData: FormData) {
  await createManualOperation(formData, "sell");
}

async function insertManualOperationPair({
  action,
  formData,
}: {
  action: "fx" | "cash_transfer";
  formData: FormData;
}) {
  const returnTo = safeReturnTo(textField(formData, "return_to"));
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/login");

  const family = await getActiveFamily(supabase, userId);
  if (!family) redirectWithOperationError("no-family", returnTo);
  if (!canEditFamilyData(family.role)) redirectWithOperationError("forbidden", returnTo);

  const accountId = textField(formData, "account_id");
  if (!accountId) redirectWithOperationError("account-required", returnTo);

  const { data: account } = await supabase
    .from("accounts")
    .select("id, portfolio_id, currency_code")
    .eq("family_id", family.id)
    .eq("id", accountId)
    .maybeSingle();

  if (!account) redirectWithOperationError("account-not-found", returnTo);

  const portfolioData = await getPortfolioData(supabase, family);
  const operationGroupId = crypto.randomUUID();
  const tradeDate = textField(formData, "trade_date") || todayIsoDate();
  const notes = optionalTextField(formData, "notes");
  const feeAmount = parseOptionalPositiveDecimal(formData.get("fee_amount"));
  if (feeAmount === null) redirectWithOperationError("costs-invalid", returnTo);

  let targetAccount: { id: string; portfolio_id: string } | null = null;
  if (action === "cash_transfer") {
    const targetAccountId = textField(formData, "to_account_id");
    const { data } = await supabase
      .from("accounts")
      .select("id, portfolio_id")
      .eq("family_id", family.id)
      .eq("id", targetAccountId)
      .maybeSingle();

    if (!data) redirectWithOperationError("target-account-not-found", returnTo);
    targetAccount = data;
  }

  const result = action === "fx"
    ? buildManualFxOperationRecords(
        {
          familyId: family.id,
          portfolioId: account.portfolio_id,
          accountId,
          tradeDate,
          fromCurrencyCode: textField(formData, "from_currency_code"),
          fromAmount: parsePositiveDecimal(formData.get("from_amount")),
          toCurrencyCode: textField(formData, "to_currency_code"),
          toAmount: parsePositiveDecimal(formData.get("to_amount")),
          feeAmount,
          notes,
          userId,
          operationGroupId,
        },
        { cashBalances: portfolioData.cashBalances, positions: portfolioData.positions },
      )
    : buildManualCashTransferRecords(
        {
          familyId: family.id,
          fromPortfolioId: account.portfolio_id,
          toPortfolioId: targetAccount?.portfolio_id ?? "",
          fromAccountId: accountId,
          toAccountId: textField(formData, "to_account_id"),
          tradeDate,
          currencyCode: textField(formData, "currency_code"),
          amount: parsePositiveDecimal(formData.get("amount")),
          notes,
          userId,
          operationGroupId,
        },
        { cashBalances: portfolioData.cashBalances, positions: portfolioData.positions },
      );

  if (!result.ok) redirectWithOperationError(result.code, returnTo);

  const { data: operations, error } = await supabase
    .from("operations")
    .insert(result.records)
    .select("id");

  if (error || !operations || operations.length !== 2) {
    throw new Error(`Manual operation pair creation failed: ${error?.message ?? "unknown error"}`);
  }

  await supabase.from("audit_log").insert({
    family_id: family.id,
    actor_user_id: userId,
    action: action === "fx" ? "create_manual_fx_operation" : "create_manual_cash_transfer",
    entity_table: "operations",
    entity_id: operations[0].id,
    after_data: {
      operation_group_id: operationGroupId,
      operation_ids: operations.map((operation) => operation.id),
      action,
      records: result.records.map((record) => ({
        account_id: record.account_id,
        operation_type_code: record.operation_type_code,
        net_amount: record.net_amount,
        currency_code: record.currency_code,
        metadata: record.metadata,
      })),
    },
  });

  revalidatePath("/accounts");
  revalidatePath("/assets");
  revalidatePath("/dashboard");
  redirect(`${returnTo}?operation_saved=${action}`);
}

export async function createFxOperation(formData: FormData) {
  await insertManualOperationPair({ action: "fx", formData });
}

export async function createCashTransferOperation(formData: FormData) {
  await insertManualOperationPair({ action: "cash_transfer", formData });
}

export async function cancelManualOperation(formData: FormData) {
  const returnTo = safeReturnTo(textField(formData, "return_to"));
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/login");

  const family = await getActiveFamily(supabase, userId);
  if (!family) redirectWithOperationError("no-family", returnTo);
  if (!canManageFamily(family.role)) redirectWithOperationError("forbidden-cancel", returnTo);

  const operationId = textField(formData, "operation_id");
  if (!operationId) redirectWithOperationError("operation-required", returnTo);

  const { data: operation } = await supabase
    .from("operations")
    .select("id, family_id, account_id, asset_id, operation_type_code, trade_date, quantity, price, gross_amount, fee_amount, tax_amount, net_amount, currency_code, source, cancelled_at")
    .eq("family_id", family.id)
    .eq("id", operationId)
    .maybeSingle();

  if (!operation) redirectWithOperationError("operation-not-found", returnTo);
  if (!canCancelManualOperation(operation)) redirectWithOperationError("operation-not-cancellable", returnTo);

  const cancellationReason = optionalTextField(formData, "cancellation_reason") ?? "Отменено пользователем";
  const cancelledAt = new Date().toISOString();

  const { error } = await supabase
    .from("operations")
    .update({
      cancelled_at: cancelledAt,
      cancelled_by: userId,
      cancellation_reason: cancellationReason,
      updated_by: userId,
    })
    .eq("family_id", family.id)
    .eq("id", operationId);

  if (error) {
    throw new Error(`Manual operation cancellation failed: ${error.message}`);
  }

  await supabase.from("audit_log").insert({
    family_id: family.id,
    actor_user_id: userId,
    action: "cancel_manual_operation",
    entity_table: "operations",
    entity_id: operationId,
    before_data: operation,
    after_data: {
      cancelled_at: cancelledAt,
      cancelled_by: userId,
      cancellation_reason: cancellationReason,
    },
  });

  revalidatePath("/accounts");
  revalidatePath("/assets");
  revalidatePath("/dashboard");
  redirect(`${returnTo}?operation_cancelled=1`);
}

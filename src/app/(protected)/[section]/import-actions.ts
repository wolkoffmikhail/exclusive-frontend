"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActiveFamily } from "@/lib/portfolio/data";
import { parseBcsExcelReport } from "@/lib/server/broker-report-parsers/bcs-xls";
import {
  applyImportSummary,
  buildImportUploadRecord,
  canChangeImports,
  canPerformCriticalImportAction,
  emptyApplyOutcome,
  hasDuplicateImport,
  importRowsForParsedRows,
  parsedImportSummary,
} from "@/lib/server/import-workflow";
import { createClient } from "@/lib/supabase/server";

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

const allowedMimeTypes = new Set([
  "application/pdf",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const allowedExtensions = new Set(["pdf", "csv", "xls", "xlsx"]);

function cleanFileName(name: string) {
  return (
    name
      .normalize("NFKD")
      .replace(/[^\w.\-а-яА-ЯёЁ]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 180) || "broker-report"
  );
}

void cleanFileName;

function fileExtension(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  return extension && extension !== name.toLowerCase() ? extension : "";
}

function cleanStorageFileName(name: string) {
  const extension = fileExtension(name);
  const baseName = extension ? name.slice(0, -(extension.length + 1)) : name;
  const safeBaseName =
    baseName
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 140) || "broker-report";

  return extension ? `${safeBaseName}.${extension}` : safeBaseName;
}

void cleanStorageFileName;

function redirectWithError(code: string): never {
  redirect(`/import?error=${encodeURIComponent(code)}`);
}

function redirectWithParseError(code: string): never {
  redirect(`/import?parse_error=${encodeURIComponent(code)}`);
}

function redirectWithApplyError(code: string): never {
  redirect(`/import?apply_error=${encodeURIComponent(code)}`);
}

function redirectWithReconcileError(code: string): never {
  redirect(`/import?reconcile_error=${encodeURIComponent(code)}`);
}

function redirectWithDeleteError(code: string): never {
  redirect(`/import?delete_error=${encodeURIComponent(code)}`);
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);

  if (rows.length < 2) return { headers: [], records: [] };

  const headers = rows[0].map((header) => header.trim().toLowerCase());
  const records = rows.slice(1).map((values, index) => {
    const raw: Record<string, string> = {};
    headers.forEach((header, headerIndex) => {
      raw[header || `column_${headerIndex + 1}`] = values[headerIndex] ?? "";
    });

    return {
      rowNumber: index + 2,
      raw,
    };
  });

  return { headers, records };
}

function toOptionalNumber(value: string | undefined) {
  if (!value) return null;
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeImportRow(raw: Record<string, string>) {
  const tradeDate = raw.trade_date || raw.date || raw["дата"] || "";
  const settleDate = raw.settle_date || raw["дата_расчетов"] || "";
  const operationType = (raw.operation_type || raw.type || raw["операция"] || "").toLowerCase();
  const ticker = raw.ticker || raw.symbol || raw["тикер"] || "";
  const assetName = raw.asset_name || raw.asset || raw.name || raw["название"] || "";
  const market = raw.market || raw.exchange || raw["рынок"] || "";
  const quantity = toOptionalNumber(raw.quantity || raw.qty || raw["количество"]);
  const price = toOptionalNumber(raw.price || raw["цена"]);
  const amount = toOptionalNumber(raw.amount || raw.gross_amount || raw.sum || raw["сумма"]);
  const fee = toOptionalNumber(raw.fee || raw.fee_amount || raw.commission || raw["комиссия"]);
  const tax = toOptionalNumber(raw.tax || raw.tax_amount || raw["налог"]);
  const currency = (raw.currency || raw["валюта"] || "").toUpperCase();

  return {
    trade_date: tradeDate || null,
    settle_date: settleDate || null,
    operation_type: operationType || null,
    ticker: ticker || null,
    asset_name: assetName || null,
    market: market || null,
    quantity,
    price,
    gross_amount: amount,
    fee_amount: fee,
    tax_amount: tax,
    currency: currency || null,
  };
}

type NormalizedImportRow = {
  row_type?: unknown;
  trade_date?: unknown;
  settle_date?: unknown;
  operation_type?: unknown;
  ticker?: unknown;
  isin?: unknown;
  asset_type?: unknown;
  asset_name?: unknown;
  market?: unknown;
  quantity?: unknown;
  price?: unknown;
  gross_amount?: unknown;
  fee_amount?: unknown;
  tax_amount?: unknown;
  currency?: unknown;
  snapshot_date?: unknown;
  book_value_amount?: unknown;
  market_value_amount?: unknown;
  accrued_interest_amount?: unknown;
  security_identifier?: unknown;
  custody_place?: unknown;
  notes?: unknown;
  rate_date?: unknown;
  rate_to_rub?: unknown;
};

const supportedOperationTypes = new Set([
  "buy",
  "sell",
  "dividend",
  "coupon",
  "tax",
  "fee",
  "deposit",
  "withdrawal",
  "transfer_in",
  "transfer_out",
  "split",
  "price_snapshot",
  "other",
]);

const negativeCashOperationTypes = new Set(["buy", "fee", "tax", "withdrawal", "transfer_out"]);

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return toOptionalNumber(value) ?? null;
  return null;
}

function grossAmountFor(normalized: NormalizedImportRow) {
  const explicitAmount = numberValue(normalized.gross_amount);
  if (explicitAmount !== null) return Math.abs(explicitAmount);

  const quantity = numberValue(normalized.quantity);
  const price = numberValue(normalized.price);
  if (quantity !== null && price !== null) return Math.abs(quantity * price);

  return null;
}

function netAmountFor(operationType: string, grossAmount: number, feeAmount: number, taxAmount: number) {
  if (negativeCashOperationTypes.has(operationType)) {
    return -Math.abs(grossAmount + feeAmount + taxAmount);
  }

  return Math.abs(grossAmount - feeAmount - taxAmount);
}

async function findOrCreateAsset({
  assetType,
  currencyCode,
  familyId,
  isin,
  market,
  metadata,
  name,
  supabase,
  ticker,
  userId,
}: {
  assetType?: string | null;
  currencyCode: string;
  familyId: string;
  isin?: string | null;
  market: string | null;
  metadata?: Record<string, unknown>;
  name: string | null;
  supabase: Awaited<ReturnType<typeof createClient>>;
  ticker: string | null;
  userId: string;
}) {
  const normalizedTicker = ticker?.trim().toUpperCase() || null;
  const normalizedIsin = isin?.trim().toUpperCase() || null;
  if (!normalizedTicker && !normalizedIsin) return null;

  if (normalizedIsin) {
    const { data: existingAssetByIsin } = await supabase
      .from("assets")
      .select("id")
      .eq("family_id", familyId)
      .eq("isin", normalizedIsin)
      .maybeSingle();

    if (existingAssetByIsin?.id) return existingAssetByIsin.id as string;
  }

  if (normalizedTicker) {
    const { data: existingAsset } = await supabase
      .from("assets")
      .select("id, isin")
      .eq("family_id", familyId)
      .eq("ticker", normalizedTicker)
      .maybeSingle();

    if (existingAsset?.id) {
      const existingIsin = typeof existingAsset.isin === "string" ? existingAsset.isin.toUpperCase() : null;
      if (normalizedIsin && existingIsin !== normalizedIsin) return null;
      return existingAsset.id as string;
    }
  }

  const { data: insertedAsset, error: insertError } = await supabase
    .from("assets")
    .insert({
      family_id: familyId,
      asset_type_code: assetType || "stock",
      name: name || normalizedTicker || normalizedIsin,
      ticker: normalizedTicker,
      isin: normalizedIsin,
      market,
      currency_code: currencyCode,
      metadata: metadata ?? {},
      created_by: userId,
    })
    .select("id")
    .single();

  if (!insertError && insertedAsset?.id) return insertedAsset.id as string;

  const { data: fallbackAsset } = await supabase
    .from("assets")
    .select("id")
    .eq("family_id", familyId)
    .eq(normalizedIsin ? "isin" : "ticker", normalizedIsin || normalizedTicker)
    .maybeSingle();

  if (fallbackAsset?.id) return fallbackAsset.id as string;
  throw new Error(`Asset creation failed: ${insertError?.message ?? "unknown error"}`);
}

export async function uploadBrokerReport(formData: FormData) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/login");

  const family = await getActiveFamily(supabase, userId);
  if (!family) redirectWithError("no-family");
  if (!canChangeImports(family.role)) redirectWithError("forbidden");

  const accountId = String(formData.get("account_id") ?? "");
  if (!accountId) redirectWithError("account-required");

  const file = formData.get("report");
  if (!(file instanceof File) || file.size === 0) redirectWithError("file-required");
  if (file.size > MAX_FILE_SIZE_BYTES) redirectWithError("file-too-large");

  const extension = fileExtension(file.name);
  const mimeAllowed = file.type ? allowedMimeTypes.has(file.type) : false;
  if (!mimeAllowed && !allowedExtensions.has(extension)) redirectWithError("file-type");

  const { data: account } = await supabase
    .from("accounts")
    .select("id, family_id, portfolio_id")
    .eq("family_id", family.id)
    .eq("id", accountId)
    .maybeSingle();

  if (!account) redirectWithError("account-not-found");

  const bytes = Buffer.from(await file.arrayBuffer());
  const uploadRecord = buildImportUploadRecord({
    accountId: account.id,
    bytes,
    familyId: family.id,
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type,
    importId: crypto.randomUUID(),
    portfolioId: account.portfolio_id,
    userId,
  });

  const { data: existingImport } = await supabase
    .from("imports")
    .select("id")
    .eq("family_id", family.id)
    .eq("account_id", account.id)
    .eq("sha256", uploadRecord.sha256)
    .maybeSingle();

  if (hasDuplicateImport(existingImport)) redirectWithError("duplicate");

  const { error: uploadError } = await supabase.storage
    .from(uploadRecord.storageBucket)
    .upload(uploadRecord.storageObjectKey, bytes, {
      contentType: uploadRecord.contentType,
      upsert: false,
    });

  if (uploadError) {
    redirectWithError("storage-upload");
  }

  const { error: insertError } = await supabase.from("imports").insert(uploadRecord.importRecord);

  if (insertError) {
    throw new Error(`Import record creation failed: ${insertError.message}`);
  }

  await supabase.from("audit_log").insert({
    family_id: family.id,
    actor_user_id: userId,
    action: "upload_broker_report",
    entity_table: "imports",
    entity_id: uploadRecord.importRecord.id,
    after_data: uploadRecord.auditAfterData,
  });

  revalidatePath("/import");
  redirect("/import?uploaded=1");
}

export async function parseBrokerImport(formData: FormData) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/login");

  const family = await getActiveFamily(supabase, userId);
  if (!family) redirectWithParseError("no-family");
  if (!canChangeImports(family.role)) redirectWithParseError("forbidden");

  const importId = String(formData.get("import_id") ?? "");
  if (!importId) redirectWithParseError("import-required");

  const { data: importJob } = await supabase
    .from("imports")
    .select("id, family_id, original_file_name, storage_bucket, storage_object_key")
    .eq("family_id", family.id)
    .eq("id", importId)
    .maybeSingle();

  if (!importJob?.storage_object_key) redirectWithParseError("import-not-found");

  const extension = fileExtension(importJob.original_file_name);
  const canParse = extension === "csv" || extension === "xls" || extension === "xlsx";
  if (!canParse) {
    await supabase
      .from("imports")
      .update({
        status: "failed",
        error_message: `Unsupported file format for parsing: ${extension || "unknown"}`,
        finished_at: new Date().toISOString(),
      })
      .eq("family_id", family.id)
      .eq("id", importId);
    redirectWithParseError("unsupported-format");
  }

  await supabase
    .from("imports")
    .update({ status: "parsing", error_message: null, started_at: new Date().toISOString() })
    .eq("family_id", family.id)
    .eq("id", importId);

  const { data: fileBlob, error: downloadError } = await supabase.storage
    .from(importJob.storage_bucket || "broker-reports")
    .download(importJob.storage_object_key);

  if (downloadError || !fileBlob) {
    await supabase
      .from("imports")
      .update({ status: "failed", error_message: downloadError?.message ?? "Download failed" })
      .eq("family_id", family.id)
      .eq("id", importId);
    redirectWithParseError("download-failed");
  }

  const bytes = Buffer.from(await fileBlob.arrayBuffer());
  const parsedRows =
    extension === "csv"
      ? parseCsv(bytes.toString("utf8")).records.map(({ rowNumber, raw }) => {
          const normalized = normalizeImportRow(raw);
          const isValid = Boolean(normalized.trade_date && normalized.operation_type);

          return {
            rowNumber,
            raw,
            normalized,
            status: isValid ? ("normalized" as const) : ("failed" as const),
            errorMessage: isValid ? null : "Required fields are missing",
          };
        })
      : parseBcsExcelReport(bytes);

  if (parsedRows.length === 0) {
    await supabase
      .from("imports")
      .update({ status: "failed", error_message: "File has no supported data rows", finished_at: new Date().toISOString() })
      .eq("family_id", family.id)
      .eq("id", importId);
    redirectWithParseError("empty-file");
  }

  await supabase.from("import_rows").delete().eq("family_id", family.id).eq("import_id", importId);

  const rows = importRowsForParsedRows({ familyId: family.id, importId, parsedRows });

  const { error: insertError } = await supabase.from("import_rows").insert(rows);
  if (insertError) {
    await supabase
      .from("imports")
      .update({ status: "failed", error_message: insertError.message, finished_at: new Date().toISOString() })
      .eq("family_id", family.id)
      .eq("id", importId);
    throw new Error(`Import rows creation failed: ${insertError.message}`);
  }

  const summary = parsedImportSummary(rows);
  await supabase
    .from("imports")
    .update({
      status: summary.importStatus,
      error_message: summary.errorMessage,
      finished_at: new Date().toISOString(),
    })
    .eq("family_id", family.id)
    .eq("id", importId);

  await supabase.from("audit_log").insert({
    family_id: family.id,
    actor_user_id: userId,
    action: extension === "csv" ? "parse_broker_import_csv" : "parse_broker_import_excel",
    entity_table: "imports",
    entity_id: importId,
    after_data: {
      file_extension: extension,
      rows_total: rows.length,
      rows_failed: summary.failedRows,
      rows_skipped: summary.skippedRows,
    },
  });

  revalidatePath("/import");
  redirect(summary.failedRows > 0 ? "/import?parse_error=row-validation" : "/import?parsed=1");
}

export async function applyBrokerImport(formData: FormData) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/login");

  const family = await getActiveFamily(supabase, userId);
  if (!family) redirectWithApplyError("no-family");
  if (!canChangeImports(family.role)) redirectWithApplyError("forbidden");

  const importId = String(formData.get("import_id") ?? "");
  if (!importId) redirectWithApplyError("import-required");

  const { data: importJob } = await supabase
    .from("imports")
    .select("id, family_id, portfolio_id, account_id, status")
    .eq("family_id", family.id)
    .eq("id", importId)
    .maybeSingle();

  if (!importJob) redirectWithApplyError("import-not-found");
  if (!importJob.account_id) redirectWithApplyError("account-required");

  const { data: rowsToApply, error: rowsError } = await supabase
    .from("import_rows")
    .select("id, row_number, normalized_data, status")
    .eq("family_id", family.id)
    .eq("import_id", importId)
    .eq("status", "normalized")
    .order("row_number", { ascending: true });

  if (rowsError) throw new Error(`Import rows lookup failed: ${rowsError.message}`);

  if (!rowsToApply || rowsToApply.length === 0) {
    if (emptyApplyOutcome(importJob.status) === "already-applied") redirect("/import?applied=1");
    redirectWithApplyError("no-normalized-rows");
  }

  await supabase
    .from("imports")
    .update({ status: "applying", error_message: null, started_at: new Date().toISOString() })
    .eq("family_id", family.id)
    .eq("id", importId);

  let appliedRows = 0;
  let failedRows = 0;

  for (const row of rowsToApply) {
    const normalized = (row.normalized_data ?? {}) as NormalizedImportRow;
    const rowType = textValue(normalized.row_type).toLowerCase() || "operation";

    if (rowType === "fx_rate") {
      const rateDate = textValue(normalized.rate_date);
      const currencyCode = textValue(normalized.currency).toUpperCase();
      const rateToRub = numberValue(normalized.rate_to_rub);

      if (!rateDate || !currencyCode || rateToRub === null) {
        failedRows += 1;
        await supabase
          .from("import_rows")
          .update({
            status: "failed",
            error_message: "Cannot apply FX row: rate_date, currency or rate value is missing",
          })
          .eq("family_id", family.id)
          .eq("id", row.id);
        continue;
      }

      const { data: event, error: eventError } = await supabase
        .from("events")
        .insert({
          family_id: family.id,
          portfolio_id: importJob.portfolio_id,
          event_type: "fx_rate",
          title: `FX ${currencyCode}/RUB ${rateDate}`,
          event_date: rateDate,
          payload: {
            broker: "bcs",
            currency: currencyCode,
            base_currency: "RUB",
            rate_to_base: rateToRub,
            source_import_id: importId,
            source_import_row_id: row.id,
          },
          created_by: userId,
        })
        .select("id")
        .single();

      if (eventError || !event?.id) {
        failedRows += 1;
        await supabase
          .from("import_rows")
          .update({
            status: "failed",
            error_message: eventError?.message ?? "FX event creation failed",
          })
          .eq("family_id", family.id)
          .eq("id", row.id);
        continue;
      }

      appliedRows += 1;
      await supabase
        .from("import_rows")
        .update({
          status: "applied",
          error_message: null,
          created_entity_table: "events",
          created_entity_id: event.id,
        })
        .eq("family_id", family.id)
        .eq("id", row.id);
      continue;
    }

    if (rowType === "holding_snapshot") {
      const snapshotDate = textValue(normalized.snapshot_date);
      const ticker = textValue(normalized.ticker).toUpperCase() || null;
      const isin = textValue(normalized.isin).toUpperCase() || null;
      const assetName = textValue(normalized.asset_name) || ticker || isin;
      const assetType = textValue(normalized.asset_type).toLowerCase() || "other";
      const market = textValue(normalized.market).toUpperCase() || null;
      const currencyCode = textValue(normalized.currency).toUpperCase() || family.baseCurrency;
      const quantity = numberValue(normalized.quantity);
      const bookValueAmount = numberValue(normalized.book_value_amount);
      const marketValueAmount = numberValue(normalized.market_value_amount);

      if (!snapshotDate || quantity === null || marketValueAmount === null) {
        failedRows += 1;
        await supabase
          .from("import_rows")
          .update({
            status: "failed",
            error_message: "Cannot apply snapshot row: snapshot_date, quantity or market value is missing",
          })
          .eq("family_id", family.id)
          .eq("id", row.id);
        continue;
      }

      const assetId = await findOrCreateAsset({
        assetType,
        currencyCode,
        familyId: family.id,
        isin,
        market,
        metadata: {
          source: "bcs",
          security_identifier: textValue(normalized.security_identifier) || null,
          custody_place: textValue(normalized.custody_place) || null,
        },
        name: assetName,
        supabase,
        ticker,
        userId,
      });

      if (!assetId) {
        failedRows += 1;
        await supabase
          .from("import_rows")
          .update({
            status: "failed",
            error_message: "Cannot apply snapshot row: asset identity is missing",
          })
          .eq("family_id", family.id)
          .eq("id", row.id);
        continue;
      }

      const { data: snapshot, error: snapshotError } = await supabase
        .from("position_snapshots")
        .upsert(
          {
            family_id: family.id,
            portfolio_id: importJob.portfolio_id,
            account_id: importJob.account_id,
            asset_id: assetId,
            snapshot_date: snapshotDate,
            quantity,
            book_value_amount: bookValueAmount,
            market_value_amount: marketValueAmount,
            currency_code: currencyCode,
            source: "imported",
            created_by: userId,
          },
          {
            onConflict: "family_id,portfolio_id,account_id,asset_id,snapshot_date,source",
          },
        )
        .select("id")
        .single();

      if (snapshotError || !snapshot?.id) {
        failedRows += 1;
        await supabase
          .from("import_rows")
          .update({
            status: "failed",
            error_message: snapshotError?.message ?? "Position snapshot creation failed",
          })
          .eq("family_id", family.id)
          .eq("id", row.id);
        continue;
      }

      appliedRows += 1;
      await supabase
        .from("import_rows")
        .update({
          status: "applied",
          error_message: null,
          created_entity_table: "position_snapshots",
          created_entity_id: snapshot.id,
        })
        .eq("family_id", family.id)
        .eq("id", row.id);
      continue;
    }

    const operationType = textValue(normalized.operation_type).toLowerCase();
    const tradeDate = textValue(normalized.trade_date);
    const settleDate = textValue(normalized.settle_date) || null;
    const ticker = textValue(normalized.ticker).toUpperCase() || null;
    const isin = textValue(normalized.isin).toUpperCase() || null;
    const assetType = textValue(normalized.asset_type).toLowerCase() || "stock";
    const assetName = textValue(normalized.asset_name) || ticker;
    const market = textValue(normalized.market).toUpperCase() || null;
    const currencyCode = textValue(normalized.currency).toUpperCase() || family.baseCurrency;
    const quantity = numberValue(normalized.quantity);
    const price = numberValue(normalized.price);
    const grossAmount = grossAmountFor(normalized);
    const feeAmount = Math.abs(numberValue(normalized.fee_amount) ?? 0);
    const taxAmount = Math.abs(numberValue(normalized.tax_amount) ?? 0);

    if (!supportedOperationTypes.has(operationType) || !tradeDate || grossAmount === null) {
      failedRows += 1;
      await supabase
        .from("import_rows")
        .update({
          status: "failed",
          error_message: "Cannot apply row: operation_type, trade_date or amount is missing",
        })
        .eq("family_id", family.id)
        .eq("id", row.id);
      continue;
    }

    const assetId = await findOrCreateAsset({
      assetType,
      currencyCode,
      familyId: family.id,
      isin,
      market,
      name: assetName,
      supabase,
      ticker,
      userId,
    });

    const netAmount = netAmountFor(operationType, grossAmount, feeAmount, taxAmount);

    const { data: operation, error: operationError } = await supabase
      .from("operations")
      .insert({
        family_id: family.id,
        portfolio_id: importJob.portfolio_id,
        account_id: importJob.account_id,
        asset_id: assetId,
        operation_type_code: operationType,
        trade_date: tradeDate,
        settle_date: settleDate,
        quantity,
        price,
        gross_amount: grossAmount,
        fee_amount: feeAmount,
        tax_amount: taxAmount,
        net_amount: netAmount,
        currency_code: currencyCode,
        source: "import",
        source_import_id: importId,
        source_import_row_id: row.id,
        notes: textValue(normalized.notes) || `Created from import row ${row.row_number}`,
        occurred_at: `${tradeDate}T00:00:00.000Z`,
        created_by: userId,
      })
      .select("id")
      .single();

    if (operationError || !operation?.id) {
      failedRows += 1;
      await supabase
        .from("import_rows")
        .update({
          status: "failed",
          error_message: operationError?.message ?? "Operation creation failed",
        })
        .eq("family_id", family.id)
        .eq("id", row.id);
      continue;
    }

    appliedRows += 1;
    await supabase
      .from("import_rows")
      .update({
        status: "applied",
        error_message: null,
        created_entity_table: "operations",
        created_entity_id: operation.id,
        created_operation_id: operation.id,
      })
      .eq("family_id", family.id)
      .eq("id", row.id);
  }

  const completion = applyImportSummary(failedRows);
  await supabase
    .from("imports")
    .update({
      status: completion.importStatus,
      error_message: completion.errorMessage,
      finished_at: new Date().toISOString(),
    })
    .eq("family_id", family.id)
    .eq("id", importId);

  await supabase.from("audit_log").insert({
    family_id: family.id,
    actor_user_id: userId,
    action: "apply_broker_import",
    entity_table: "imports",
    entity_id: importId,
    after_data: {
      rows_applied: appliedRows,
      rows_failed: failedRows,
    },
  });

  revalidatePath("/import");
  revalidatePath("/dashboard");
  redirect(failedRows > 0 ? "/import?apply_error=row-apply" : "/import?applied=1");
}

export async function skipImportRow(formData: FormData) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/login");

  const family = await getActiveFamily(supabase, userId);
  if (!family) redirectWithReconcileError("no-family");
  if (!canChangeImports(family.role)) redirectWithReconcileError("forbidden");

  const rowId = String(formData.get("row_id") ?? "");
  if (!rowId) redirectWithReconcileError("row-required");

  const { data: row, error: rowError } = await supabase
    .from("import_rows")
    .select("id, import_id, row_number, status")
    .eq("family_id", family.id)
    .eq("id", rowId)
    .maybeSingle();

  if (rowError) throw new Error(`Import row lookup failed: ${rowError.message}`);
  if (!row) redirectWithReconcileError("row-not-found");
  if (row.status === "applied") redirectWithReconcileError("row-applied");

  const { error: updateError } = await supabase
    .from("import_rows")
    .update({ status: "skipped" })
    .eq("family_id", family.id)
    .eq("id", rowId);

  if (updateError) throw new Error(`Import row skip failed: ${updateError.message}`);

  await supabase.from("audit_log").insert({
    family_id: family.id,
    actor_user_id: userId,
    action: "skip_import_row",
    entity_table: "import_rows",
    entity_id: rowId,
    before_data: {
      import_id: row.import_id,
      row_number: row.row_number,
      status: row.status,
    },
    after_data: {
      status: "skipped",
    },
  });

  revalidatePath("/import");
  redirect("/import?reconciled=1");
}

export async function restoreImportRow(formData: FormData) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/login");

  const family = await getActiveFamily(supabase, userId);
  if (!family) redirectWithReconcileError("no-family");
  if (!canChangeImports(family.role)) redirectWithReconcileError("forbidden");

  const rowId = String(formData.get("row_id") ?? "");
  if (!rowId) redirectWithReconcileError("row-required");

  const { data: row, error: rowError } = await supabase
    .from("import_rows")
    .select("id, import_id, row_number, status, normalized_data")
    .eq("family_id", family.id)
    .eq("id", rowId)
    .maybeSingle();

  if (rowError) throw new Error(`Import row lookup failed: ${rowError.message}`);
  if (!row) redirectWithReconcileError("row-not-found");
  if (row.status !== "skipped") redirectWithReconcileError("row-not-skipped");

  const restoredStatus = row.normalized_data ? "normalized" : "failed";
  const { error: updateError } = await supabase
    .from("import_rows")
    .update({ status: restoredStatus })
    .eq("family_id", family.id)
    .eq("id", rowId);

  if (updateError) throw new Error(`Import row restore failed: ${updateError.message}`);

  await supabase.from("audit_log").insert({
    family_id: family.id,
    actor_user_id: userId,
    action: "restore_import_row",
    entity_table: "import_rows",
    entity_id: rowId,
    before_data: {
      import_id: row.import_id,
      row_number: row.row_number,
      status: row.status,
    },
    after_data: {
      status: restoredStatus,
    },
  });

  revalidatePath("/import");
  redirect("/import?reconciled=1");
}

export async function deleteFailedImport(formData: FormData) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/login");

  const family = await getActiveFamily(supabase, userId);
  if (!family) redirectWithDeleteError("no-family");
  if (!canPerformCriticalImportAction(family.role)) redirectWithDeleteError("forbidden");

  const importId = String(formData.get("import_id") ?? "");
  const confirmation = String(formData.get("confirm") ?? "").trim().toUpperCase();
  if (!importId) redirectWithDeleteError("import-required");
  if (confirmation !== "DELETE" && confirmation !== "УДАЛИТЬ") redirectWithDeleteError("confirm-required");

  const { data: importJob, error: importError } = await supabase
    .from("imports")
    .select("id, status, original_file_name, storage_bucket, storage_object_key")
    .eq("family_id", family.id)
    .eq("id", importId)
    .maybeSingle();

  if (importError) throw new Error(`Import lookup failed: ${importError.message}`);
  if (!importJob) redirectWithDeleteError("import-not-found");
  if (!["failed", "cancelled"].includes(importJob.status)) redirectWithDeleteError("status-not-deletable");

  if (importJob.storage_object_key) {
    const { error: storageError } = await supabase.storage
      .from(importJob.storage_bucket || "broker-reports")
      .remove([importJob.storage_object_key]);

    if (storageError) throw new Error(`Import file delete failed: ${storageError.message}`);
  }

  const { error: deleteError } = await supabase
    .from("imports")
    .delete()
    .eq("family_id", family.id)
    .eq("id", importId);

  if (deleteError) throw new Error(`Import delete failed: ${deleteError.message}`);

  await supabase.from("audit_log").insert({
    family_id: family.id,
    actor_user_id: userId,
    action: "delete_failed_import",
    entity_table: "imports",
    entity_id: importId,
    before_data: {
      original_file_name: importJob.original_file_name,
      status: importJob.status,
      storage_object_key: importJob.storage_object_key,
    },
  });

  revalidatePath("/import");
  revalidatePath("/dashboard");
  revalidatePath("/assets");
  revalidatePath("/accounts");
  redirect("/import?deleted=1");
}

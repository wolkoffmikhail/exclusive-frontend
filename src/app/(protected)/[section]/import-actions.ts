"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActiveFamily } from "@/lib/portfolio/data";
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

function fileExtension(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  return extension && extension !== name.toLowerCase() ? extension : "";
}

function redirectWithError(code: string): never {
  redirect(`/import?error=${encodeURIComponent(code)}`);
}

function redirectWithParseError(code: string): never {
  redirect(`/import?parse_error=${encodeURIComponent(code)}`);
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
  const operationType = (raw.operation_type || raw.type || raw["операция"] || "").toLowerCase();
  const ticker = raw.ticker || raw.symbol || raw["тикер"] || "";
  const quantity = toOptionalNumber(raw.quantity || raw.qty || raw["количество"]);
  const price = toOptionalNumber(raw.price || raw["цена"]);
  const currency = (raw.currency || raw["валюта"] || "").toUpperCase();

  return {
    trade_date: tradeDate || null,
    operation_type: operationType || null,
    ticker: ticker || null,
    quantity,
    price,
    currency: currency || null,
  };
}

export async function uploadBrokerReport(formData: FormData) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/login");

  const family = await getActiveFamily(supabase, userId);
  if (!family) redirectWithError("no-family");
  if (family.role === "viewer") redirectWithError("forbidden");

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
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const { data: existingImport } = await supabase
    .from("imports")
    .select("id")
    .eq("family_id", family.id)
    .eq("account_id", account.id)
    .eq("sha256", sha256)
    .maybeSingle();

  if (existingImport) redirectWithError("duplicate");

  const importId = crypto.randomUUID();
  const safeName = cleanFileName(file.name);
  const objectKey = `families/${family.id}/imports/${importId}/${safeName}`;
  const contentType = file.type || "application/octet-stream";

  const { error: uploadError } = await supabase.storage
    .from("broker-reports")
    .upload(objectKey, bytes, {
      contentType,
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  const { error: insertError } = await supabase.from("imports").insert({
    id: importId,
    family_id: family.id,
    portfolio_id: account.portfolio_id,
    account_id: account.id,
    original_file_name: file.name,
    storage_bucket: "broker-reports",
    storage_object_key: objectKey,
    file_mime_type: contentType,
    file_size_bytes: file.size,
    sha256,
    status: "uploaded",
    imported_by: userId,
  });

  if (insertError) {
    throw new Error(`Import record creation failed: ${insertError.message}`);
  }

  await supabase.from("audit_log").insert({
    family_id: family.id,
    actor_user_id: userId,
    action: "upload_broker_report",
    entity_table: "imports",
    entity_id: importId,
    after_data: {
      original_file_name: file.name,
      storage_object_key: objectKey,
      file_size_bytes: file.size,
      sha256,
    },
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
  if (family.role === "viewer") redirectWithParseError("forbidden");

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
  if (extension !== "csv") redirectWithParseError("csv-only");

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

  const text = await fileBlob.text();
  const { records } = parseCsv(text);
  if (records.length === 0) {
    await supabase
      .from("imports")
      .update({ status: "failed", error_message: "CSV has no data rows", finished_at: new Date().toISOString() })
      .eq("family_id", family.id)
      .eq("id", importId);
    redirectWithParseError("empty-csv");
  }

  await supabase.from("import_rows").delete().eq("family_id", family.id).eq("import_id", importId);

  const rows = records.map(({ rowNumber, raw }) => {
    const normalized = normalizeImportRow(raw);
    const isValid = Boolean(normalized.trade_date && normalized.operation_type);

    return {
      family_id: family.id,
      import_id: importId,
      row_number: rowNumber,
      raw_data: raw,
      normalized_data: normalized,
      status: isValid ? "normalized" : "failed",
      error_message: isValid ? null : "Required fields are missing",
    };
  });

  const { error: insertError } = await supabase.from("import_rows").insert(rows);
  if (insertError) {
    await supabase
      .from("imports")
      .update({ status: "failed", error_message: insertError.message, finished_at: new Date().toISOString() })
      .eq("family_id", family.id)
      .eq("id", importId);
    throw new Error(`Import rows creation failed: ${insertError.message}`);
  }

  const failedRows = rows.filter((row) => row.status === "failed").length;
  await supabase
    .from("imports")
    .update({
      status: failedRows > 0 ? "failed" : "parsed",
      error_message: failedRows > 0 ? `${failedRows} rows failed validation` : null,
      finished_at: new Date().toISOString(),
    })
    .eq("family_id", family.id)
    .eq("id", importId);

  await supabase.from("audit_log").insert({
    family_id: family.id,
    actor_user_id: userId,
    action: "parse_broker_import_csv",
    entity_table: "imports",
    entity_id: importId,
    after_data: {
      rows_total: rows.length,
      rows_failed: failedRows,
    },
  });

  revalidatePath("/import");
  redirect(failedRows > 0 ? "/import?parse_error=row-validation" : "/import?parsed=1");
}

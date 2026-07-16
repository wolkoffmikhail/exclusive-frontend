import { createHash } from "node:crypto";
import { canEditFamilyData, canManageFamily, type FamilyRole } from "../portfolio/permissions";
import type { ParsedBrokerImportRow } from "./broker-report-parsers/bcs-xls";

type BuildImportUploadRecordInput = {
  accountId: string;
  bytes: Buffer;
  familyId: string;
  fileName: string;
  fileSize: number;
  fileType?: string;
  importId: string;
  portfolioId: string;
  userId: string;
};

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

export function canChangeImports(role: FamilyRole | null | undefined) {
  return canEditFamilyData(role);
}

export function canPerformCriticalImportAction(role: FamilyRole | null | undefined) {
  return canManageFamily(role);
}

export function hasDuplicateImport(existingImport: { id: string } | null | undefined) {
  return Boolean(existingImport?.id);
}

export function buildImportUploadRecord({
  accountId,
  bytes,
  familyId,
  fileName,
  fileSize,
  fileType,
  importId,
  portfolioId,
  userId,
}: BuildImportUploadRecordInput) {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const storageBucket = "broker-reports";
  const storageObjectKey = `families/${familyId}/imports/${importId}/${cleanStorageFileName(fileName)}`;
  const contentType = fileType || "application/octet-stream";

  return {
    contentType,
    sha256,
    storageBucket,
    storageObjectKey,
    importRecord: {
      id: importId,
      family_id: familyId,
      portfolio_id: portfolioId,
      account_id: accountId,
      original_file_name: fileName,
      storage_bucket: storageBucket,
      storage_object_key: storageObjectKey,
      file_mime_type: contentType,
      file_size_bytes: fileSize,
      sha256,
      status: "uploaded",
      imported_by: userId,
    },
    auditAfterData: {
      original_file_name: fileName,
      storage_object_key: storageObjectKey,
      file_size_bytes: fileSize,
      sha256,
    },
  };
}

export function importRowsForParsedRows({
  familyId,
  importId,
  parsedRows,
}: {
  familyId: string;
  importId: string;
  parsedRows: ParsedBrokerImportRow[];
}) {
  return parsedRows.map(({ rowNumber, raw, normalized, status, errorMessage }) => ({
    family_id: familyId,
    import_id: importId,
    row_number: rowNumber,
    raw_data: raw,
    normalized_data: normalized,
    status,
    error_message: errorMessage,
  }));
}

export function parsedImportSummary(rows: Array<{ status: string }>) {
  const failedRows = rows.filter((row) => row.status === "failed").length;
  const skippedRows = rows.filter((row) => row.status === "skipped").length;

  return {
    failedRows,
    skippedRows,
    importStatus: failedRows > 0 ? "failed" : "parsed",
    errorMessage: failedRows > 0 ? `${failedRows} rows failed validation` : null,
  };
}

export function applyImportSummary(failedRows: number) {
  return {
    importStatus: failedRows > 0 ? "failed" : "applied",
    errorMessage: failedRows > 0 ? `${failedRows} rows failed applying` : null,
  };
}

export function emptyApplyOutcome(importStatus: string) {
  return importStatus === "applied" ? "already-applied" : "no-normalized-rows";
}

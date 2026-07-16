import { describe, expect, it } from "vitest";
import {
  applyImportSummary,
  buildImportUploadRecord,
  canChangeImports,
  canPerformCriticalImportAction,
  emptyApplyOutcome,
  hasDuplicateImport,
  importRowsForParsedRows,
  parsedImportSummary,
} from "./import-workflow";

describe("import workflow helpers", () => {
  it("creates an import job record with deterministic SHA-256 and storage key", () => {
    const plan = buildImportUploadRecord({
      accountId: "account-1",
      bytes: Buffer.from("broker report"),
      familyId: "family-1",
      fileName: "BCS report июль.xlsx",
      fileSize: 13,
      fileType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      importId: "import-1",
      portfolioId: "portfolio-1",
      userId: "user-1",
    });

    expect(plan.importRecord).toMatchObject({
      id: "import-1",
      family_id: "family-1",
      portfolio_id: "portfolio-1",
      account_id: "account-1",
      original_file_name: "BCS report июль.xlsx",
      storage_bucket: "broker-reports",
      storage_object_key: "families/family-1/imports/import-1/BCS_report.xlsx",
      status: "uploaded",
      imported_by: "user-1",
    });
    expect(plan.sha256).toBe("0b7d6329778ab1dcd1c4fc81f5d1abaec861e7968f3b4ff5c213ce3ea079c995");
    expect(plan.auditAfterData.sha256).toBe(plan.sha256);
  });

  it("detects SHA-256 duplicate lookup results", () => {
    expect(hasDuplicateImport({ id: "import-1" })).toBe(true);
    expect(hasDuplicateImport(null)).toBe(false);
    expect(hasDuplicateImport(undefined)).toBe(false);
  });

  it("maps parsed rows to import_rows and derives parse status", () => {
    const rows = importRowsForParsedRows({
      familyId: "family-1",
      importId: "import-1",
      parsedRows: [
        {
          rowNumber: 2,
          raw: { date: "2026-07-02" },
          normalized: { row_type: "cash_operation" },
          status: "normalized",
          errorMessage: null,
        },
        {
          rowNumber: 3,
          raw: { label: "subtotal" },
          normalized: { row_type: "skipped" },
          status: "skipped",
          errorMessage: null,
        },
        {
          rowNumber: 4,
          raw: { currency: "UNKNOWN" },
          normalized: { row_type: "holding_snapshot" },
          status: "failed",
          errorMessage: "Unknown report section currency",
        },
      ],
    });

    expect(rows).toMatchObject([
      { family_id: "family-1", import_id: "import-1", row_number: 2, status: "normalized" },
      { family_id: "family-1", import_id: "import-1", row_number: 3, status: "skipped" },
      { family_id: "family-1", import_id: "import-1", row_number: 4, status: "failed" },
    ]);
    expect(parsedImportSummary(rows)).toEqual({
      failedRows: 1,
      skippedRows: 1,
      importStatus: "failed",
      errorMessage: "1 rows failed validation",
    });
  });

  it("derives apply status for normalized rows", () => {
    expect(applyImportSummary(0)).toEqual({
      importStatus: "applied",
      errorMessage: null,
    });
    expect(applyImportSummary(2)).toEqual({
      importStatus: "failed",
      errorMessage: "2 rows failed applying",
    });
  });

  it("enforces import permissions by role", () => {
    expect(canChangeImports("viewer")).toBe(false);
    expect(canChangeImports("editor")).toBe(true);
    expect(canChangeImports("admin")).toBe(true);
    expect(canChangeImports("owner")).toBe(false);
    expect(canChangeImports(null)).toBe(false);

    expect(canPerformCriticalImportAction("viewer")).toBe(false);
    expect(canPerformCriticalImportAction("editor")).toBe(false);
    expect(canPerformCriticalImportAction("admin")).toBe(true);
    expect(canPerformCriticalImportAction("owner")).toBe(false);
    expect(canPerformCriticalImportAction(null)).toBe(false);
  });

  it("treats repeated apply on an already applied import as no-op success", () => {
    expect(emptyApplyOutcome("applied")).toBe("already-applied");
    expect(emptyApplyOutcome("parsed")).toBe("no-normalized-rows");
  });
});

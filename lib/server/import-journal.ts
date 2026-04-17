import { randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

export type ImportJournalDocument = {
  fileName: string
  fileHash?: string | null
  documentFamily: "card" | "osv" | "unknown"
  ledgerAccount: string | null
  importerCode: string | null
  validationStatus: "READY" | "WARNING" | "BLOCKED" | "INVALID" | "DUPLICATE"
  organizationName?: string | null
  periodFrom?: string | null
  periodTo?: string | null
}

export type ImportJournalJob = {
  importJobId: string
  status: "success" | "partial_success" | "failed"
  documentsCount: number
  filesCount: number
  message: string | null
  errorText: string | null
  importedSummaries: string[]
  pendingSummaries: string[]
  createdAt: string
  completedAt: string
  files: ImportJournalDocument[]
}

type RecordImportJobInput = {
  status: "success" | "partial_success" | "failed"
  documents: ImportJournalDocument[]
  filesCount: number
  message?: string | null
  errorText?: string | null
  importedSummaries?: string[]
  pendingSummaries?: string[]
}

function isMissingJournalTablesError(error: unknown) {
  if (!error || typeof error !== "object") return false
  const candidate = error as { code?: string; message?: string }
  return (
    candidate.code === "42P01" ||
    candidate.message?.includes("relation") === true ||
    candidate.message?.includes("import_job") === true
  )
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item))
}

export async function recordImportJob(
  client: SupabaseClient,
  input: RecordImportJobInput
) {
  const importJobId = randomUUID()

  try {
    const { error: jobError } = await client.from("import_job").insert({
      import_job_id: importJobId,
      status: input.status,
      documents_count: input.documents.length,
      files_count: input.filesCount,
      message: input.message ?? null,
      error_text: input.errorText ?? null,
      imported_summaries: input.importedSummaries ?? [],
      pending_summaries: input.pendingSummaries ?? [],
    })

    if (jobError) throw jobError

    if (input.documents.length > 0) {
      const fileRows = input.documents.map((document) => ({
        import_job_file_id: randomUUID(),
        import_job_id: importJobId,
        file_name: document.fileName,
        file_hash: document.fileHash ?? null,
        document_family: document.documentFamily,
        ledger_account: document.ledgerAccount,
        importer_code: document.importerCode,
        validation_status: document.validationStatus,
        organization_name: document.organizationName ?? null,
        period_from: document.periodFrom ?? null,
        period_to: document.periodTo ?? null,
      }))

      const { error: fileError } = await client.from("import_job_file").insert(fileRows)
      if (fileError) throw fileError
    }
  } catch (error) {
    if (!isMissingJournalTablesError(error)) {
      throw error
    }
  }
}

export async function listRecentImportJobs(client: SupabaseClient, limit = 10) {
  try {
    const { data: jobs, error: jobsError } = await client
      .from("import_job")
      .select(
        "import_job_id,status,documents_count,files_count,message,error_text,imported_summaries,pending_summaries,created_at,completed_at"
      )
      .order("created_at", { ascending: false })
      .limit(limit)

    if (jobsError) throw jobsError

    const typedJobs = (jobs ?? []) as Array<Record<string, unknown>>
    const jobIds = typedJobs.map((row) => String(row.import_job_id ?? "")).filter(Boolean)

    const filesByJobId = new Map<string, ImportJournalDocument[]>()

    if (jobIds.length > 0) {
      const { data: files, error: filesError } = await client
        .from("import_job_file")
        .select(
          "import_job_id,file_name,file_hash,document_family,ledger_account,importer_code,validation_status,organization_name,period_from,period_to"
        )
        .in("import_job_id", jobIds)
        .order("created_at", { ascending: true })

      if (filesError) throw filesError

      for (const row of ((files ?? []) as Array<Record<string, unknown>>)) {
        const jobId = String(row.import_job_id ?? "")
        const list = filesByJobId.get(jobId) ?? []
        list.push({
          fileName: String(row.file_name ?? ""),
          fileHash: row.file_hash ? String(row.file_hash) : null,
          documentFamily: (String(row.document_family ?? "unknown") as ImportJournalDocument["documentFamily"]),
          ledgerAccount: row.ledger_account ? String(row.ledger_account) : null,
          importerCode: row.importer_code ? String(row.importer_code) : null,
          validationStatus: String(
            row.validation_status ?? "INVALID"
          ) as ImportJournalDocument["validationStatus"],
          organizationName: row.organization_name ? String(row.organization_name) : null,
          periodFrom: row.period_from ? String(row.period_from) : null,
          periodTo: row.period_to ? String(row.period_to) : null,
        })
        filesByJobId.set(jobId, list)
      }
    }

    return typedJobs.map(
      (row): ImportJournalJob => ({
        importJobId: String(row.import_job_id ?? ""),
        status: String(row.status ?? "failed") as ImportJournalJob["status"],
        documentsCount: Number(row.documents_count ?? 0),
        filesCount: Number(row.files_count ?? 0),
        message: row.message ? String(row.message) : null,
        errorText: row.error_text ? String(row.error_text) : null,
        importedSummaries: normalizeStringArray(row.imported_summaries),
        pendingSummaries: normalizeStringArray(row.pending_summaries),
        createdAt: String(row.created_at ?? ""),
        completedAt: String(row.completed_at ?? ""),
        files: filesByJobId.get(String(row.import_job_id ?? "")) ?? [],
      })
    )
  } catch (error) {
    if (!isMissingJournalTablesError(error)) {
      throw error
    }
    return []
  }
}

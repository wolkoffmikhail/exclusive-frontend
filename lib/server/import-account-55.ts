import { randomUUID, createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  readWorkbookRows,
  normalizeWorkbookCellDate,
  normalizeWorkbookText,
  type SheetRow,
} from "@/lib/server/xlsx-inspector"

type ParsedDepositBalance = {
  snapshotDate: string
  balance: number
  accountCode: string
  sourceRowHash: string
}

type ImportResult = {
  imported: {
    balances: number
  }
  skipped: {
    balances: number
  }
}

const SOURCE_SYSTEM = "deposit_statement_1c_web"

function normalizeKey(text: string | null | undefined) {
  return normalizeWorkbookText(text).toUpperCase()
}

function convertCellDecimal(value: string | null | undefined) {
  const normalized = normalizeWorkbookText(value)
  if (!normalized) return null
  const candidate = normalized
    .replace(/ /g, "")
    .replace(/\u00A0/g, "")
    .replace(/,/g, ".")
    .replace(/[^0-9.\-]/g, "")
  const parsed = Number(candidate)
  return Number.isFinite(parsed) ? parsed : null
}

function getStableHash(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

function splitLines(text: string | null | undefined) {
  return (text ?? "")
    .split(/\r\n|\r|\n/g)
    .map((item) => normalizeWorkbookText(item))
    .filter(Boolean)
}

function get55AccountCode(row: SheetRow) {
  for (const candidate of [row.E, row.G, row.H, row.I]) {
    const value = normalizeWorkbookText(candidate)
    if (/^55(\.\d+)?$/.test(value)) return value
  }
  return null
}

function extractBankName(text: string | null | undefined) {
  const line = normalizeWorkbookText(text)
  const match = /(\d{20}),\s*(.+)$/.exec(line)
  return match ? normalizeWorkbookText(match[2]) : null
}

function getAccountProfile(ledgerCode: string) {
  switch (ledgerCode) {
    case "55.03":
      return {
        accountName: "Deposit 55.03",
        accountType: "deposit",
        includeInOperatingReports: false,
      }
    case "55.01":
      return {
        accountName: "Letter of credit 55.01",
        accountType: "deposit",
        includeInOperatingReports: false,
      }
    default:
      return {
        accountName: `Non-operating account ${ledgerCode}`,
        accountType: "deposit",
        includeInOperatingReports: false,
      }
  }
}

function parseAccount55Workbook(fileBuffer: Buffer) {
  const rows = readWorkbookRows(fileBuffer)
  const ownerName = normalizeWorkbookText(rows[0]?.A) || 'ООО "ЭКСКЛЮЗИВ СЕРВИС"'
  const openingRow = rows.find((row) => normalizeKey(row.A).startsWith("САЛЬДО НА НАЧАЛО"))
  const movementRows = rows.slice(7).filter((row) => Boolean(normalizeWorkbookCellDate(row.A ?? "")))
  const rows55 = movementRows.filter((row) => Boolean(get55AccountCode(row)))

  const seenAccounts = new Set<string>()
  const bankNames = new Set<string>()
  const dailyClosingByAccount = new Map<string, Map<string, number>>()

  for (const row of rows55) {
    const date = normalizeWorkbookCellDate(row.A ?? "")
    if (!date) continue

    for (const line of [...splitLines(row.C), ...splitLines(row.D), ...splitLines(row.B)]) {
      const bank = extractBankName(line)
      if (bank) bankNames.add(bank)
    }

    const accountCode = get55AccountCode(row)
    if (!accountCode) continue
    seenAccounts.add(accountCode)

    const rowBalance = convertCellDecimal(row.L) ?? convertCellDecimal(row.K) ?? convertCellDecimal(row.J)
    if (rowBalance === null) continue

    if (!dailyClosingByAccount.has(accountCode)) {
      dailyClosingByAccount.set(accountCode, new Map())
    }
    dailyClosingByAccount.get(accountCode)!.set(date, rowBalance)
  }

  const accountCodes = [...seenAccounts].sort()
  const balanceRows: ParsedDepositBalance[] = []
  const openingBalance = convertCellDecimal(openingRow?.L) ?? convertCellDecimal(openingRow?.K) ?? convertCellDecimal(openingRow?.J)
  const firstDate = normalizeWorkbookCellDate(rows55[0]?.A ?? "")

  if (openingBalance !== null && firstDate && accountCodes.length > 0) {
    const openingSnapshotDate = new Date(`${firstDate}T00:00:00.000Z`)
    openingSnapshotDate.setUTCDate(openingSnapshotDate.getUTCDate() - 1)
    const snapshotDate = openingSnapshotDate.toISOString().slice(0, 10)
    balanceRows.push({
      snapshotDate,
      balance: openingBalance,
      accountCode: accountCodes[0],
      sourceRowHash: getStableHash(["DEPOSIT_BALANCE_OPEN", snapshotDate, String(openingBalance), accountCodes[0]].join("|")),
    })
  }

  for (const accountCode of accountCodes) {
    const entries = dailyClosingByAccount.get(accountCode)
    if (!entries) continue
    for (const [date, balance] of [...entries.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      balanceRows.push({
        snapshotDate: date,
        balance,
        accountCode,
        sourceRowHash: getStableHash(["DEPOSIT_BALANCE_CLOSE", date, String(balance), accountCode].join("|")),
      })
    }
  }

  if (rows55.length > 0 && balanceRows.length === 0) {
    throw new Error("Account 55 importer detected movement rows but parsed zero balance snapshots.")
  }

  return {
    ownerName,
    bankName: [...bankNames].sort()[0] ?? "ПАО СБЕРБАНК",
    accountCodes,
    balanceRows,
  }
}

async function loadAllRows(client: SupabaseClient, table: string, select: string, filters: Record<string, string> = {}) {
  const pageSize = 1000
  const rows: Record<string, unknown>[] = []
  let offset = 0

  while (true) {
    let query = client.from(table).select(select).range(offset, offset + pageSize - 1)
    for (const [field, value] of Object.entries(filters)) {
      query = query.eq(field, value)
    }
    const { data, error } = await query
    if (error) throw error
    const page = ((data ?? []) as unknown[]) as Record<string, unknown>[]
    rows.push(...page)
    if (page.length < pageSize) break
    offset += pageSize
  }

  return rows
}

async function loadNameIdCache(client: SupabaseClient, table: string, idField: string, nameField: string) {
  const cache = new Map<string, string>()
  const rows = await loadAllRows(client, table, `${idField},${nameField}`)
  for (const row of rows) {
    const name = normalizeWorkbookText(String(row[nameField] ?? ""))
    const id = String(row[idField] ?? "")
    if (name && id) cache.set(normalizeKey(name), id)
  }
  return cache
}

async function ensureEntity(client: SupabaseClient, cache: Map<string, string>, name: string, role: string) {
  const normalizedName = normalizeWorkbookText(name)
  const key = normalizeKey(normalizedName)
  const existing = cache.get(key)
  if (existing) return existing
  const entityId = randomUUID()
  const { error } = await client.from("dim_entity").insert({
    entity_id: entityId,
    entity_name: normalizedName,
    entity_role: role,
    is_active: true,
  })
  if (error) throw error
  cache.set(key, entityId)
  return entityId
}

async function ensureBank(client: SupabaseClient, cache: Map<string, string>, name: string) {
  const normalizedName = normalizeWorkbookText(name)
  const key = normalizeKey(normalizedName)
  const existing = cache.get(key)
  if (existing) return existing
  const bankId = randomUUID()
  const { error } = await client.from("dim_bank").insert({
    bank_id: bankId,
    bank_name: normalizedName,
    is_active: true,
  })
  if (error) throw error
  cache.set(key, bankId)
  return bankId
}

async function ensureAccount(
  client: SupabaseClient,
  cache: Map<string, string>,
  params: {
    accountName: string
    bankId: string
    ownerEntityId: string
    accountType: string
    ledgerAccountCode: string
    includeInOperatingReports: boolean
  }
) {
  const key = normalizeKey(params.accountName)
  const existing = cache.get(key)
  if (existing) return existing

  const accountId = randomUUID()
  const { error } = await client.from("dim_account").insert({
    account_id: accountId,
    account_name: params.accountName,
    bank_id: params.bankId,
    owner_entity_id: params.ownerEntityId,
    currency_code: "RUB",
    is_active: true,
    account_type: params.accountType,
    ledger_account_code: params.ledgerAccountCode,
    include_in_operating_reports: params.includeInOperatingReports,
  })
  if (error) throw error
  cache.set(key, accountId)
  return accountId
}

function chunkArray<T>(items: T[], chunkSize: number) {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize))
  }
  return chunks
}

export async function importAccount55Card(
  client: SupabaseClient,
  sourceFile: string,
  fileBuffer: Buffer
): Promise<ImportResult> {
  const parsed = parseAccount55Workbook(fileBuffer)

  const entityCache = await loadNameIdCache(client, "dim_entity", "entity_id", "entity_name")
  const bankCache = await loadNameIdCache(client, "dim_bank", "bank_id", "bank_name")
  const accountCache = await loadNameIdCache(client, "dim_account", "account_id", "account_name")

  const ownerEntityId = await ensureEntity(client, entityCache, parsed.ownerName, "owner")
  const bankId = await ensureBank(client, bankCache, parsed.bankName)

  const accountIdByCode = new Map<string, string>()
  for (const accountCode of parsed.accountCodes) {
    const profile = getAccountProfile(accountCode)
    const accountId = await ensureAccount(client, accountCache, {
      accountName: profile.accountName,
      bankId,
      ownerEntityId,
      accountType: profile.accountType,
      ledgerAccountCode: accountCode,
      includeInOperatingReports: profile.includeInOperatingReports,
    })
    accountIdByCode.set(accountCode, accountId)
  }

  const existingHashes = new Set(
    (await loadAllRows(client, "fct_balance_snapshot", "source_row_hash", { source_file: sourceFile }))
      .map((row) => String(row.source_row_hash ?? ""))
      .filter(Boolean)
  )

  const existingSnapshots = new Set(
    (await loadAllRows(client, "fct_balance_snapshot", "snapshot_date,account_id"))
      .map((row) => `${String(row.snapshot_date ?? "")}|${String(row.account_id ?? "")}`)
      .filter((value) => value !== "|")
  )

  const balancesToInsert = parsed.balanceRows
    .filter((row) => {
      if (existingHashes.has(row.sourceRowHash)) return false
      const accountId = accountIdByCode.get(row.accountCode)
      if (!accountId) return false
      return !existingSnapshots.has(`${row.snapshotDate}|${accountId}`)
    })
    .map((row) => ({
      snapshot_id: randomUUID(),
      snapshot_date: row.snapshotDate,
      account_id: accountIdByCode.get(row.accountCode)!,
      balance: row.balance,
      currency_code: "RUB",
      source_system: SOURCE_SYSTEM,
      source_file: sourceFile,
      source_row_hash: row.sourceRowHash,
    }))

  for (const chunk of chunkArray(balancesToInsert, 500)) {
    const { error } = await client.from("fct_balance_snapshot").insert(chunk)
    if (error) throw error
  }

  return {
    imported: {
      balances: balancesToInsert.length,
    },
    skipped: {
      balances: parsed.balanceRows.length - balancesToInsert.length,
    },
  }
}

import { randomUUID, createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { importMapping } from "@/lib/server/import-mapping"
import {
  readWorkbookRows,
  normalizeWorkbookCellDate,
  normalizeWorkbookText,
  type SheetRow,
} from "@/lib/server/xlsx-inspector"

type ParsedCashRowIn = {
  incomeDate: string
  amount: number
  articleCode: string
  articleName: string
  payerName: string | null
  comment: string
  externalRef: string | null
  sourceRowHash: string
  accountCode: string
  includeInOperatingReports: boolean
}

type ParsedCashRowOut = {
  paymentDate: string
  amount: number
  expenseCode: string
  expenseName: string
  expenseGroup: string
  payeeName: string | null
  comment: string
  externalRef: string | null
  sourceRowHash: string
  accountCode: string
  includeInOperatingReports: boolean
}

type ParsedCashBalance = {
  snapshotDate: string
  balance: number
  sourceRowHash: string
  accountCode: string
}

type ImportResult = {
  imported: {
    cashIn: number
    cashOut: number
    balances: number
  }
  skipped: {
    cashIn: number
    cashOut: number
    balances: number
  }
}

const SOURCE_SYSTEM = "cash_statement_1c_web"
const CASH_BANK_NAME = "Касса (наличные)"

function normalizeKey(text: string | null | undefined) {
  return normalizeWorkbookText(text).toUpperCase()
}

function splitLines(text: string | null | undefined) {
  return (text ?? "")
    .split(/\r\n|\r|\n/g)
    .map((item) => normalizeWorkbookText(item))
    .filter(Boolean)
}

function getMeaningfulLines(text: string | null | undefined) {
  return splitLines(text).filter((line) => line !== "<...>")
}

function getArticleFromAnalytics(text: string | null | undefined) {
  return normalizeWorkbookText(text)
}

function looksLikeEntityName(text: string | null | undefined) {
  const value = normalizeWorkbookText(text)
  if (!value) return false
  if (/^\d/.test(value)) return false
  if (/Поступление наличных|Выдача наличных|Списание с расчетного счета|Реализация \(акт|Договор-оферт|парковка|Перевод собственных средств/i.test(value)) return false
  if (/ФИЗИЧЕСКОЕ ЛИЦО/i.test(value)) return true
  if (/ООО|ИП|АО|ПАО|ГУП|ФГКУ|ФНС|РОССИИ|[А-ЯЁ][а-яё]+ [А-ЯЁ][а-яё]+([ ]+[А-ЯЁ][а-яё]+)?/u.test(value)) return true
  return false
}

function extractBankFromAccountLine(text: string | null | undefined) {
  const line = normalizeWorkbookText(text)
  const match = /(\d{20}),\s*(.+)$/.exec(line)
  return match ? normalizeWorkbookText(match[2]) : null
}

function getDocumentRef(text: string | null | undefined) {
  const match = /00БП-\d+/.exec(normalizeWorkbookText(text))
  return match?.[0] ?? null
}

function convertCellDecimal(value: string | null | undefined) {
  const normalized = normalizeWorkbookText(value)
  if (!normalized) return null
  const candidate = normalized.replace(/ /g, "").replace(/\u00A0/g, "").replace(/,/g, ".").replace(/[^0-9.\-]/g, "")
  const parsed = Number(candidate)
  return Number.isFinite(parsed) ? parsed : null
}

function getStableHash(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

function matchRule<T extends { match: string }>(rawText: string, rules: T[], fallback: Omit<T, "match">) {
  const key = normalizeKey(rawText)
  const matched = rules.find((rule) => key.includes(normalizeKey(rule.match)))
  return matched ?? fallback
}

function resolveCashIncomeRule(rawText: string) {
  const articleKey = normalizeKey(rawText)
  if (articleKey.includes("ПАРКОВОЧ")) return { code: "PARKING", name: "Паркинг" }
  if (articleKey.includes("КОВОРКИНГ")) return { code: "COWORKING", name: "Коворкинг" }
  if (articleKey.includes("ЭКСПЛУАТ")) return { code: "OPERATION", name: "Эксплуатация" }
  if (articleKey.includes("АРЕНД") && articleKey.includes("ПЕРЕМЕН")) return { code: "RENT_VARIABLE", name: "Аренда: переменная часть" }
  if (articleKey.includes("АРЕНД")) return { code: "RENT_FIXED", name: "Аренда: постоянная часть" }
  return matchRule(rawText, importMapping.incomeRules, importMapping.incomeFallback)
}

function isInternalCashMovement(docText: string | null | undefined, articleText: string | null | undefined) {
  const docKey = normalizeKey(docText)
  const articleKey = normalizeKey(articleText)
  return (
    docKey.includes("ВНЕСЕНЫ НА РАСЧ.СЧЕТ ДЕНЕЖНЫЕ СРЕДСТВА") ||
    docKey.includes("СПИСАНИЕ С РАСЧЕТНОГО СЧЕТА") ||
    articleKey.includes("ПЕРЕВОД СОБСТВЕННЫХ СРЕДСТВ") ||
    articleKey.includes("ВОЗВРАТ НЕИЗРАСХОДОВАННЫХ ПОДОТЧЕТНЫХ СУММ") ||
    articleKey.includes("ВНЕСЕНИЕ ОСТАТКА НЕИСПОЛЬЗОВАННЫХ ПОДОТЧЕТНЫХ СРЕДСТВ")
  )
}

function getCashAccountCode(row: SheetRow) {
  const debit = normalizeWorkbookText(row.E)
  const credit = normalizeWorkbookText(row.G)
  if (/^50(\.\d+)?$/.test(debit)) return debit
  if (/^50(\.\d+)?$/.test(credit)) return credit
  return null
}

function parseAccount50Workbook(fileBuffer: Buffer) {
  const rows = readWorkbookRows(fileBuffer)
  const ownerName = normalizeWorkbookText(rows[0]?.A) || "OWNER"
  const movementRows = rows.slice(8).filter((row) => Boolean(normalizeWorkbookCellDate(row.A ?? "")))
  const openingRow = rows.find((row) => normalizeKey(row.A).startsWith("САЛЬДО НА НАЧАЛО"))

  const incomeRows: ParsedCashRowIn[] = []
  const expenseRows: ParsedCashRowOut[] = []
  const balanceRows: ParsedCashBalance[] = []
  const dailyClosingByAccount = new Map<string, Map<string, SheetRow>>()
  const seenAccounts = new Set<string>()

  for (const row of movementRows) {
    const date = normalizeWorkbookCellDate(row.A ?? "")
    if (!date) continue
    const cashAccountCode = getCashAccountCode(row)
    if (!cashAccountCode) continue
    seenAccounts.add(cashAccountCode)

    const rowBalance = convertCellDecimal(row.J)
    if (rowBalance !== null) {
      if (!dailyClosingByAccount.has(cashAccountCode)) {
        dailyClosingByAccount.set(cashAccountCode, new Map())
      }
      dailyClosingByAccount.get(cashAccountCode)!.set(date, row)
    }

    const debitAccount = normalizeWorkbookText(row.E)
    const creditAccount = normalizeWorkbookText(row.G)
    const debitAmount = convertCellDecimal(row.F)
    const creditAmount = convertCellDecimal(row.H)

    if (debitAccount === cashAccountCode && debitAmount !== null) {
      const rawArticle = getArticleFromAnalytics(row.C)
      let counterparty: string | null = null

      for (const line of getMeaningfulLines(row.D)) {
        if (/00БП-|^Договор|^Реализация/i.test(line)) continue
        if (looksLikeEntityName(line)) {
          counterparty = line
          break
        }
      }

      const internal = isInternalCashMovement(row.B, rawArticle)
      const rule = internal
        ? { code: "INTERNAL_CASH_IN", name: "Внутреннее перемещение денежных средств" }
        : resolveCashIncomeRule(rawArticle)

      const stable = ["CASH_IN", date, String(debitAmount), normalizeWorkbookText(row.B), normalizeWorkbookText(row.C), normalizeWorkbookText(row.D), cashAccountCode].join("|")
      incomeRows.push({
        incomeDate: date,
        amount: debitAmount,
        articleCode: rule.code,
        articleName: rule.name,
        payerName: counterparty,
        comment: normalizeWorkbookText(row.B),
        externalRef: getDocumentRef(row.B),
        sourceRowHash: getStableHash(stable),
        accountCode: cashAccountCode,
        includeInOperatingReports: !internal,
      })
      continue
    }

    if (creditAccount === cashAccountCode && creditAmount !== null) {
      const rawArticle = getArticleFromAnalytics(row.D)
      let counterparty: string | null = null
      for (const line of getMeaningfulLines(row.C)) {
        if (/^Договор|^Реализация/i.test(line)) continue
        if (looksLikeEntityName(line)) {
          counterparty = line
          break
        }
      }
      if (!counterparty) {
        for (const line of getMeaningfulLines(row.D)) {
          const bankFromLine = extractBankFromAccountLine(line)
          if (bankFromLine) {
            counterparty = bankFromLine
            break
          }
        }
      }

      const internal = isInternalCashMovement(row.B, rawArticle)
      const rule = internal
        ? {
            code: "EXP-INTERNAL-TRANSFER",
            name: "Внутреннее перемещение денежных средств",
            group: "Внутренние перемещения",
          }
        : matchRule(rawArticle, importMapping.expenseRules, importMapping.expenseFallback)

      const stable = ["CASH_OUT", date, String(creditAmount), normalizeWorkbookText(row.B), normalizeWorkbookText(row.C), normalizeWorkbookText(row.D), cashAccountCode].join("|")
      expenseRows.push({
        paymentDate: date,
        amount: creditAmount,
        expenseCode: rule.code,
        expenseName: rule.name,
        expenseGroup: "group" in rule ? rule.group : importMapping.expenseFallback.group,
        payeeName: counterparty,
        comment: normalizeWorkbookText(row.B),
        externalRef: getDocumentRef(row.B),
        sourceRowHash: getStableHash(stable),
        accountCode: cashAccountCode,
        includeInOperatingReports: !internal,
      })
    }
  }

  const seenAccountCodes = [...seenAccounts].sort()
  const openingBalance = convertCellDecimal(openingRow?.J)
  const firstDate = normalizeWorkbookCellDate(movementRows[0]?.A ?? "")
  if (openingBalance !== null && firstDate && seenAccountCodes.length > 0) {
    const openingSnapshotDate = new Date(`${firstDate}T00:00:00.000Z`)
    openingSnapshotDate.setUTCDate(openingSnapshotDate.getUTCDate() - 1)
    const snapshotDate = openingSnapshotDate.toISOString().slice(0, 10)
    balanceRows.push({
      snapshotDate,
      balance: openingBalance,
      sourceRowHash: getStableHash(["CASH_BALANCE_OPEN", snapshotDate, String(openingBalance), seenAccountCodes[0]].join("|")),
      accountCode: seenAccountCodes[0],
    })
  }

  for (const [accountCode, entries] of [...dailyClosingByAccount.entries()]) {
    for (const [date, row] of [...entries.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const balance = convertCellDecimal(row.J)
      if (balance === null) continue
      balanceRows.push({
        snapshotDate: date,
        balance,
        sourceRowHash: getStableHash(["CASH_BALANCE_CLOSE", date, String(balance), accountCode].join("|")),
        accountCode,
      })
    }
  }

  return {
    ownerName,
    seenAccountCodes,
    incomeRows,
    expenseRows,
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

async function ensureEntity(client: SupabaseClient, cache: Map<string, string>, name: string | null, role: string) {
  const normalizedName = normalizeWorkbookText(name)
  if (!normalizedName || normalizedName === "ФИЗИЧЕСКОЕ ЛИЦО") return null
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

async function ensureAccount(client: SupabaseClient, cache: Map<string, string>, accountName: string, bankId: string, ownerEntityId: string, ledgerCode: string) {
  const normalizedName = normalizeWorkbookText(accountName)
  const key = normalizeKey(normalizedName)
  const existing = cache.get(key)
  if (existing) return existing
  const accountId = randomUUID()
  const { error } = await client.from("dim_account").insert({
    account_id: accountId,
    account_name: normalizedName,
    bank_id: bankId,
    owner_entity_id: ownerEntityId,
    currency_code: "RUB",
    is_active: true,
    account_type: "cash",
    ledger_account_code: ledgerCode,
    include_in_operating_reports: true,
  })
  if (error) throw error
  cache.set(key, accountId)
  return accountId
}

async function ensureIncomeArticle(client: SupabaseClient, cache: Map<string, string>, name: string, code: string, includeInOperatingReports: boolean) {
  const key = normalizeKey(name)
  const existing = cache.get(key)
  if (existing) return existing
  const incomeArticleId = randomUUID()
  const { error } = await client.from("dim_income_article").insert({
    income_article_id: incomeArticleId,
    income_name: name,
    income_code: code,
    is_active: true,
    include_in_operating_reports: includeInOperatingReports,
  })
  if (error) throw error
  cache.set(key, incomeArticleId)
  return incomeArticleId
}

async function ensureExpenseCode(client: SupabaseClient, cache: Map<string, string>, code: string, name: string, group: string, includeInOperatingReports: boolean) {
  const key = normalizeKey(code)
  const existing = cache.get(key)
  if (existing) return existing
  const { error } = await client.from("dim_expense_code").insert({
    expense_code: code,
    expense_name: name,
    expense_group: group,
    is_active: true,
    include_in_operating_reports: includeInOperatingReports,
  })
  if (error) throw error
  cache.set(key, code)
  return code
}

async function insertInChunks(client: SupabaseClient, table: string, rows: Record<string, unknown>[]) {
  const chunkSize = 500
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize)
    const { error } = await client.from(table).insert(chunk)
    if (error) throw error
  }
}

export async function importAccount50Card(client: SupabaseClient, fileName: string, fileBuffer: Buffer): Promise<ImportResult> {
  const parsed = parseAccount50Workbook(fileBuffer)

  const entityCache = await loadNameIdCache(client, "dim_entity", "entity_id", "entity_name")
  const bankCache = await loadNameIdCache(client, "dim_bank", "bank_id", "bank_name")
  const accountCache = await loadNameIdCache(client, "dim_account", "account_id", "account_name")
  const incomeArticleCache = await loadNameIdCache(client, "dim_income_article", "income_article_id", "income_name")

  const expenseCodeCache = new Map<string, string>()
  const expenseRows = await loadAllRows(client, "dim_expense_code", "expense_code")
  for (const row of expenseRows) {
    const expenseCode = String(row.expense_code ?? "")
    if (expenseCode) expenseCodeCache.set(normalizeKey(expenseCode), expenseCode)
  }

  const ownerEntityId = await ensureEntity(client, entityCache, parsed.ownerName, "owner")
  if (!ownerEntityId) throw new Error("Owner entity could not be resolved")
  const cashBankId = await ensureBank(client, bankCache, CASH_BANK_NAME)
  const accountIdByCode = new Map<string, string>()
  for (const code of parsed.seenAccountCodes) {
    accountIdByCode.set(
      code,
      await ensureAccount(client, accountCache, `Касса ${code}`, cashBankId, ownerEntityId, code)
    )
  }

  for (const name of [...new Set([...parsed.incomeRows.map((row) => row.payerName), ...parsed.expenseRows.map((row) => row.payeeName)].filter(Boolean))]) {
    await ensureEntity(client, entityCache, name, "counterparty")
  }

  for (const row of parsed.incomeRows) {
    await ensureIncomeArticle(client, incomeArticleCache, row.articleName, row.articleCode, row.includeInOperatingReports)
  }
  for (const row of parsed.expenseRows) {
    await ensureExpenseCode(client, expenseCodeCache, row.expenseCode, row.expenseName, row.expenseGroup, row.includeInOperatingReports)
  }

  const existingIncomeHashes = new Set(
    (await loadAllRows(client, "fct_cash_in", "source_row_hash", { source_file: fileName }))
      .map((row) => String(row.source_row_hash ?? ""))
      .filter(Boolean)
  )
  const existingExpenseHashes = new Set(
    (await loadAllRows(client, "fct_cash_out", "source_row_hash", { source_file: fileName }))
      .map((row) => String(row.source_row_hash ?? ""))
      .filter(Boolean)
  )
  const existingBalanceHashes = new Set(
    (await loadAllRows(client, "fct_balance_snapshot", "source_row_hash", { source_file: fileName }))
      .map((row) => String(row.source_row_hash ?? ""))
      .filter(Boolean)
  )

  const cashInInsert = parsed.incomeRows
    .filter((row) => !existingIncomeHashes.has(row.sourceRowHash))
    .map((row) => ({
      cash_in_id: randomUUID(),
      income_date: row.incomeDate,
      amount: row.amount,
      currency_code: "RUB",
      income_article_id: incomeArticleCache.get(normalizeKey(row.articleName)),
      payer_entity_id: row.payerName ? entityCache.get(normalizeKey(row.payerName)) ?? null : null,
      recipient_entity_id: ownerEntityId,
      account_id: accountIdByCode.get(row.accountCode),
      comment: row.comment,
      external_ref: row.externalRef,
      source_system: SOURCE_SYSTEM,
      source_file: fileName,
      source_row_hash: row.sourceRowHash,
    }))

  const cashOutInsert = parsed.expenseRows
    .filter((row) => !existingExpenseHashes.has(row.sourceRowHash))
    .map((row) => ({
      cash_out_id: randomUUID(),
      payment_date: row.paymentDate,
      amount: row.amount,
      currency_code: "RUB",
      expense_code: row.expenseCode,
      payer_entity_id: ownerEntityId,
      payee_entity_id: row.payeeName ? entityCache.get(normalizeKey(row.payeeName)) ?? null : null,
      account_id: accountIdByCode.get(row.accountCode),
      comment: row.comment,
      external_ref: row.externalRef,
      source_system: SOURCE_SYSTEM,
      source_file: fileName,
      source_row_hash: row.sourceRowHash,
    }))

  const balanceInsert = parsed.balanceRows
    .filter((row) => !existingBalanceHashes.has(row.sourceRowHash))
    .map((row) => ({
      snapshot_id: randomUUID(),
      snapshot_date: row.snapshotDate,
      account_id: accountIdByCode.get(row.accountCode),
      balance: row.balance,
      currency_code: "RUB",
      source_system: SOURCE_SYSTEM,
      source_file: fileName,
      source_row_hash: row.sourceRowHash,
    }))

  if (cashInInsert.length > 0) await insertInChunks(client, "fct_cash_in", cashInInsert)
  if (cashOutInsert.length > 0) await insertInChunks(client, "fct_cash_out", cashOutInsert)
  if (balanceInsert.length > 0) await insertInChunks(client, "fct_balance_snapshot", balanceInsert)

  return {
    imported: {
      cashIn: cashInInsert.length,
      cashOut: cashOutInsert.length,
      balances: balanceInsert.length,
    },
    skipped: {
      cashIn: parsed.incomeRows.length - cashInInsert.length,
      cashOut: parsed.expenseRows.length - cashOutInsert.length,
      balances: parsed.balanceRows.length - balanceInsert.length,
    },
  }
}
